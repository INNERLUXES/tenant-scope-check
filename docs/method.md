# Method

This document says exactly what the tool reads, how it works out which tables hold tenant data, which tables a query
limits to one tenant, and what each rule looks at and cannot see. The words named here are the defaults;
docs/inputs.md says how the configuration changes them.

## What is read

The input is one or more paths. A file is read whatever its name. A folder is walked: its files and subfolders in
the order of their names (compared by code unit, so the order does not depend on the locale), `.git` and
`node_modules` left out, symbolic links skipped and counted in a note, and the files whose path relative to the folder
matches a pattern of `files` (`**/*.sql`) and none of `exclude` are read. All the files of a run are read before any
check runs, in the order of the paths and then of the walk, so name the migrations before the queries when a query
depends on the schema the migrations build; the order of the checks does not depend on it.

Each file is read as UTF-8, with or without a byte order mark, with LF, CR LF or CR line ends. A file that is binary,
UTF-16 or not valid UTF-8, a path that is a symbolic link, a device or a pipe, a folder with no file that matches, and
a file over 2 MB stop the run with exit code `2`, so a run never passes because something could not be read.

## The tokenizer

The SQL reader is a tokenizer, not a parser. It splits the text into words, quoted identifiers, strings, numbers,
parameters, operators and semicolons, and keeps the comments apart, as PostgreSQL's lexical rules describe them:

- **Strings.** `'...'` with `''` for a quote; an escape string `E'...'`, in which a backslash escapes the next
  character; a dollar-quoted string `$$...$$` or `$tag$...$tag$`, which ends only at the same tag.
- **Quoted identifiers.** `"..."` with `""` for a quote, and MySQL's `` `...` ``. A quoted name keeps its case; a name
  that is not quoted is compared in lower case, as the database folds it.
- **Comments.** `--` to the end of the line, and `/* ... */`, which nest.
- **Parameters.** `$1`, `:name`, `:'name'`, `:"name"`, `?`, `@name`, and the placeholders `#{name}` and `${name}` that
  query mappers and templates write. Each is a value.

A string, a quoted identifier, a dollar quote or a block comment that is not closed stops the run with its line and
column. So does a parenthesis that is not matched, and parentheses nested more than 64 deep.

## Statements and comments

The tokens are split into statements at each semicolon. Inside a routine written with `BEGIN ATOMIC`, the split waits
for the `END` that closes it. A comment belongs to the statement it comes before, or sits inside; a comment that
starts on the line of a semicolon, after it, belongs to the statement that semicolon ends. A comment after the last
statement of a file belongs to none.

The statements are read in two passes. The first builds the schema from every file; the second checks every query
against the schema as the whole input leaves it.

## The schema

- **CREATE TABLE** gives a table its columns, with whether each has a DEFAULT, and the leading column of its primary
  key and unique constraints, written on a column or as a table constraint, and of MySQL `KEY` and `INDEX` lines.
  `LIKE other` copies the columns of a table read before it, and `PARTITION OF parent` the columns of its parent.
  CREATE TABLE ... AS and CREATE TABLE ... OF a type leave the columns unknown, and such a table is not judged on its
  columns.
- **ALTER TABLE** adds, drops and renames columns, sets and drops a DEFAULT, adds a primary key, a unique constraint
  or a MySQL index, and renames the table.
- **CREATE INDEX** gives its table a leading column: the first column of the list, unless the first entry is an
  expression such as `lower(email)`.
- **DROP TABLE** removes the table.

A table is known by its name alone: `app.orders` and `orders` are one table.

## Tenant tables

The tenant columns are `tenant_id` by default. Where the tenant tables come from is set by `tenantTables`:

- `"schema"` (the default): every table whose CREATE TABLE, with the ALTER TABLE statements after it, has a tenant
  column.
- `"all"`: every table, in the schema or named in a query, but the global ones.
- a list of names: those tables.

A table in `globalTables` is never a tenant table. The tenant column of a tenant table is the tenant column its schema
has; a tenant table with no CREATE TABLE in the input may use any tenant column of the configuration.

## Blocks and conditions

A query is read block by block: each SELECT (with each part of a UNION, INTERSECT or EXCEPT on its own), and the
target and the FROM or USING list of an UPDATE or a DELETE. WITH, EXPLAIN and PREPARE ... AS are read through to the
query they hold. The FROM list gives the table references, each with its alias and how it is joined: by a comma, an
inner join, a LEFT, RIGHT or FULL join, or a CROSS join, with its ON condition or USING list. A CTE, a subquery in
FROM and a table function are references too; a CTE is known by its name in the query that defines it.

The conditions that count are those every row must pass: the parts of WHERE, and of the ON of an inner join, joined
by AND at the top. A part in parentheses that holds only AND parts is opened up. A part that has OR at its top, or that
starts with NOT, is left out, because a row can pass it without passing the tenant condition inside. BETWEEN x AND y
stays one part. In each part the tool looks for `a = b`, `a == b` or `a IN (...)` with a column on one side, after
casts (`::uuid`) and parentheses are taken away:

- a column of a table of the block, against a value: a parameter, a literal, a function call, a subquery, `ANY (...)`,
  or a column of an outer query. This compares the column to a value. `= NULL` compares it to nothing.
- a column of one table of the block, against a column of another: a tie.

A column with no table in front names the one tenant table of the block that has a column of that name; when two
tenant tables have it, it names none, as the database would refuse it as ambiguous.

## Scoped, reached and neither

- A tenant table is **scoped** when its tenant column is compared to a value, or tied to a column that is, along ties
  of any length. The columns of a CTE or a subquery in FROM that is itself limited to one tenant count as compared to
  a value, and so does the target of `WHERE CURRENT OF`.
- A tenant table that is not scoped is **reached** when a tie on any column links it to a scoped tenant table, or to a
  table reached in the same way, or to a CTE or subquery limited to one tenant. A global table passes nothing on: its
  rows belong to every tenant, so a table reached only through it is not reached.
- A tenant table that is **neither** is not limited to one tenant by anything in the block.

In the ON of a LEFT JOIN, only the joined table is limited: a value compared to one of its columns counts, a tie
passes from the other side to it, and a condition on the other side counts for nothing. RIGHT JOIN is the mirror of
it. The ON of a FULL JOIN limits neither side. `USING (tenant_id)` and NATURAL JOIN tie the tenant columns of the two
sides.

## Rules

### `unscoped-query`

A tenant table that is neither scoped nor reached in a SELECT, an UPDATE, a DELETE, a CTE or a subquery, reported on
the line of its name in the FROM list, the UPDATE or the DELETE. TRUNCATE of a tenant table, and `TABLE t`, which reads
every row, are reported here too. A tenant table with no tenant column can never be scoped and is reported here, as
well as by `missing-tenant-column`.

Cannot see: what a condition means. `tenant_id = $1` counts whatever the application passes as `$1`; whether that
value is the tenant of the signed-in user is the application's job.

### `unscoped-join`

A tenant table that is reached but not scoped, reported on the line of its name, with the tie it was reached through
and the table on the other side. It is a warning: the rows come from another tenant only when a key points across
tenants, which a foreign key that starts with the tenant column rules out. Tie the tenant columns
(`c.tenant_id = o.tenant_id`) or compare the joined table's tenant column to the same value.

### `insert-without-tenant`

An INSERT into a tenant table whose column list does not name its tenant column, or that names no columns (the
tool cannot see which value goes into which column), or `INSERT ... DEFAULT VALUES`. The MySQL form
`INSERT ... SET col = value` names its columns in SET. A tenant column with a DEFAULT in the schema may be left out:
a default such as `current_setting('app.tenant_id')` sets it. The SELECT of an `INSERT ... SELECT` is checked as a
query.

### `missing-tenant-column`

A table that the configuration makes a tenant table, with `"all"` or a list, whose CREATE TABLE, with the ALTER TABLE
statements after it, has no tenant column. Reported on the line of the CREATE TABLE. With tenant tables taken from the
schema, a table without the column is not a tenant table, so this rule cannot fire.

### `unindexed-tenant-column`

When the input holds at least one CREATE INDEX (or an ALTER TABLE ... ADD INDEX), a tenant table created in the input
whose tenant column is not the first column of any index, primary key or unique constraint. Reported on the line of
the CREATE TABLE. A set of query files alone holds no CREATE INDEX, so it is not judged.

Cannot see: an index made outside the files read, or by a tool that does not write SQL.

### `allow-without-reason`

A comment that starts with `tenant-scope:` followed by `allow` as a word, with no reason after it, or with a reason
that says nothing: empty, only marks, or one of `tbd`, `tba`, `todo`, `none`, `n/a`, `na`, `unknown`, `reason`,
`no reason`, `fixme`, compared as whole lowercase words. Reported on the line of the comment. It allows nothing, so the
findings of its statement stay.

### `unused-allow`

A comment `tenant-scope: allow` with a reason on a statement that has no finding, or after the last statement of a
file. Reported on the line of the comment, as a notice.

## Allow markers

The first marker with a reason in a statement moves every finding of that statement, of every rule but the two above,
to the allowed list, with the reason and the line of the marker. A marker on a CREATE TABLE allows the findings of the
schema rules on that table. An allowed finding does not count for the result.

## The output

Findings are sorted by level (errors first), then by the order of the files, then by line, then by the order of the
rules. A rule lists at most 500 findings; the rest are counted in a note and still count for the result. Every text
from the input goes through the same cleaning: control characters, line separators and direction controls become
spaces, and long texts are cut.
