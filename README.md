# tenant-scope-check

Reads the SQL of a multi-tenant SaaS application that keeps every tenant in one shared database, the pool model, and reports the queries that could leak data from one tenant to another. Give it one SQL file, a folder, or the migrations and the query files together. From the CREATE TABLE statements, or from a configuration, it learns which tables hold tenant data and which column says whose a row is (`tenant_id` by default). Then it checks every SELECT, UPDATE, DELETE and INSERT for a condition on that column, every JOIN between tenant tables for a tie between their tenant columns, and every tenant table for the column and an index that starts with it. Each finding has the file and the line, and the tool exits with a code a pipeline can act on.

In the pool model all tenants share one database and its tables, and the only thing that keeps the rows of one customer from the next is a condition in each query (https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html). Microsoft's guide to multitenant database patterns puts it plainly: such a schema carries a tenant identifier column, and queries must never expose the data of more than one tenant (https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns). One forgotten `WHERE tenant_id = $1` is enough to show one customer the invoices of another, and it reads well in review because the query is otherwise right. This tool reads the SQL for those gaps on every change.

- **A tenant condition on every query.** A SELECT, UPDATE, DELETE, TRUNCATE or TABLE on a tenant table with no condition on its tenant column is an error. Only conditions every row must pass count: a part under OR, or a tenant condition in the ON of a LEFT JOIN on the side the join keeps whole, does not.
- **Joins tied by tenant.** A tenant table joined to a scoped one on a key alone (`c.id = o.customer_id`) is a warning: tie the tenant columns together, or give it a tenant condition of its own.
- **Every INSERT sets the tenant.** An INSERT into a tenant table that does not set the tenant column, or names no columns, is an error, unless the column has a DEFAULT in the schema.
- **The schema holds up.** A tenant table with no tenant column is an error, and a tenant column that leads no index is a warning.
- **Allowed with a reason.** A statement that has to read every tenant, such as a billing job, is marked with `-- tenant-scope: allow <reason>` and listed as allowed; a marker with no reason is an error, and a marker with nothing to allow is a notice.
- **Everything explained.** `--explain` shows the rule and the public sources behind each finding, and where a rule is the tool's own choice.
- Reports as text, JSON and GitHub workflow annotations, with an exit code for a pipeline: `0` no error, `1` an error, `2` usage or input error.
- Plain JavaScript, no dependencies.

```
npm test
```

```
tests 144
pass 141
fail 0
skipped 3
```

These are the summary lines that `npm test` prints at the end on Windows. The skipped tests are the ones that need a symbolic link, a device or file permissions (a file named through a symbolic link and links inside a folder, `/dev/zero` named as an input, and a file and a folder with no read access); they are guarded with `process.platform`, run on Linux and macOS, and none of them asserts a line. `npm run test:coverage` runs the same tests with coverage; their time limits are four times wider when coverage is on.

## Quick start

Requires Node 22 or newer. There is nothing to install.

```
git clone https://github.com/INNERLUXES/tenant-scope-check.git
cd tenant-scope-check
node bin/tenant-scope-check.js examples/leaky --config examples/config.json
```

Or without a clone, on your own SQL:

```
npx --yes github:INNERLUXES/tenant-scope-check db/migrations db/queries
```

`examples/` holds two made-up sets of migrations and queries. `examples/clean` is a project tracker in which every query is limited to one tenant and the one query that reads every tenant is allowed with a reason. `examples/leaky` is an invoicing service with one problem of most kinds. `examples/config.json` makes every table but `plans` and `tenants` a tenant table.

## Usage

```
tenant-scope-check <sql-file-or-folder>... [options]
```

```
--config <file>           a configuration file (strict JSON) that names the tenant columns, the tenant tables or
                          "all" of them, the global tables, the file patterns of a folder and the level of the
                          rules (default: the built-in configuration; --print-defaults shows it)
--format <name>           text, json or github (default: text); github writes workflow commands that GitHub shows
                          as annotations on the SQL files
--json                    the same as --format json
--min-severity <level>    the lowest level of a finding that is shown: notice, warning, error (default: minSeverity of
                          the configuration, else notice)
--explain                 show the rule and the public sources behind each finding
--print-defaults          print the built-in configuration as a configuration file and exit
--help                    show the usage
--version                 show the version
```

A file named on the command line is read whatever its name. A folder is walked, and the files whose path matches `**/*.sql` are read, in the order of their paths; `.git` and `node_modules` are not entered, and a symbolic link is skipped, not followed. Name the migrations and the queries together, so the queries are checked against the schema the migrations build. The path in the report is relative to the folder you run the command in, with forward slashes on every system, followed by the line of the finding.

The report of the leaky example starts with what was read and the counts, then the findings, errors first, then the statements allowed by a marker, then what was read:

```
tenant-scope-check: examples/leaky
input: examples/leaky (5 files, 20 statements: 6 select, 2 insert, 2 update, 1 delete, 7 create table, 1 alter table, 1 create index)
config: examples/config.json (Larkspur tenancy rules): tenant column tenant_id; every table is a tenant table but the global ones; global tables plans and tenants; files **/*.sql; minimum severity notice
rules: unscoped-query (error); unscoped-join (warning); insert-without-tenant (error); missing-tenant-column (error); unindexed-tenant-column (warning); allow-without-reason (error); unused-allow (notice)
findings: 13 (10 error, 2 warning, 1 notice); 1 allowed by a marker

Findings (13)

  ERROR    missing-tenant-column    examples/leaky/migrations/001_schema.sql:50
           attachments is a tenant table (every table but the global ones is a tenant table), but its CREATE TABLE has no tenant_id column, so its rows belong to no tenant

  ERROR    unscoped-query           examples/leaky/queries/customers.sql:3
           the SELECT reads customers with no condition on customers.tenant_id, so it can return the rows of every tenant

  ERROR    unscoped-query           examples/leaky/queries/customers.sql:8
           the SELECT reads customers (c) with no condition on c.tenant_id, so it can return the rows of every tenant

  ERROR    insert-without-tenant    examples/leaky/queries/customers.sql:13
           the INSERT into customers names no columns, so the tool cannot see that it sets tenant_id; name the columns

  ERROR    unscoped-query           examples/leaky/queries/invoices.sql:2
           the SELECT reads invoices with no condition on invoices.tenant_id, so it can return the rows of every tenant

  ERROR    unscoped-query           examples/leaky/queries/invoices.sql:14
           a subquery reads customers with no condition on customers.tenant_id, so it can return the rows of every tenant

  ERROR    unscoped-query           examples/leaky/queries/invoices.sql:17
           the UPDATE changes invoices with no condition on invoices.tenant_id, so it can change the rows of every tenant

  ERROR    insert-without-tenant    examples/leaky/queries/invoices.sql:20
           the INSERT into invoice_lines gives no value for tenant_id, so the new row belongs to no tenant

  ERROR    allow-without-reason     examples/leaky/queries/jobs.sql:8
           the marker "tenant-scope: allow" gives no reason ("TBD" says nothing), so it allows nothing; write why the statement may cross tenants after it

  ERROR    unscoped-query           examples/leaky/queries/jobs.sql:9
           the DELETE deletes from payments with no condition on payments.tenant_id, so it can delete the rows of every tenant

  WARNING  unindexed-tenant-column  examples/leaky/migrations/001_schema.sql:22
           the tenant column invoices.tenant_id leads no index, primary key or unique constraint, so every query scoped by tenant reads the whole table

  WARNING  unscoped-join            examples/leaky/queries/invoices.sql:7
           the SELECT reads customers (c) through c.id = i.customer_id from invoices (i) only: no condition ties c.tenant_id to the tenant of invoices (i) or compares it to a value, so a key that points into another tenant brings that tenant's rows in

  NOTICE   unused-allow             examples/leaky/queries/invoices.sql:24
           the marker "tenant-scope: allow" allows nothing: its statement has no finding, so the marker can go

Allowed by a marker (1)

  ALLOWED  unscoped-query           examples/leaky/queries/jobs.sql:4
           the SELECT reads invoices with no condition on invoices.tenant_id, so it can return the rows of every tenant
           reason (line 2): the dunning job reads the overdue invoices of every tenant, under its own database role

Read: examples/leaky

  tenant tables  5: customers (tenant_id), invoices (tenant_id), invoice_lines (tenant_id), payments (tenant_id) and attachments (no tenant column)
  global tables  2: plans and tenants
  queries        11 checked: 6 select, 2 insert, 2 update, 1 delete, 0 truncate
  schema         7 create table, 1 alter table, 1 create index, 0 drop table; 0 other statements not checked
  allow markers  3: 2 with a reason, 1 without, 1 with nothing to allow

This report reads the SQL text of the files it was given. It does not connect to a database or run a query, and it does not see SQL built at run time, queries made by an ORM, the body of a view or a function, or row-level security policies (docs/limits.md).

RESULT: FAIL - 10 errors (and 2 warnings, 1 notice)
```

With `--explain`, each finding also shows the rule, the points of the public pages it rests on and, where there is one, the tool's own choice:

```
  WARNING  unscoped-join            examples/leaky/queries/invoices.sql:7
           the SELECT reads customers (c) through c.id = i.customer_id from invoices (i) only: no condition ties c.tenant_id to the tenant of invoices (i) or compares it to a value, so a key that points into another tenant brings that tenant's rows in
           rule: a tenant table joined to a scoped tenant table through a key such as c.id = o.customer_id, with no condition that ties its tenant_id to the other table or compares it to a value
           basis: in a database shared by many tenants every table of tenant data carries a tenant identifier column so that one tenant can be picked out, and queries must never expose the data of more than one tenant (Multitenant SaaS database tenancy patterns (Microsoft Learn, Azure SQL Database), https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns)
           basis: every multi-tenant system must keep each tenant from reaching the resources of another, and crossing that line can be an event a SaaS business does not recover from (Tenant isolation (AWS Well-Architected SaaS Lens), https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html)
           the tool's own choice: a warning, not an error, because the joined rows are reached through the rows of a scoped tenant table and come from another tenant only when a key points across tenants; tying the tenant columns together, or a tenant condition on the joined table, clears it
```

The clean example passes:

```
tenant-scope-check: examples/clean
input: examples/clean (4 files, 20 statements: 6 select, 2 insert, 1 update, 1 delete, 7 create table, 1 alter table, 2 create index)
config: examples/config.json (Larkspur tenancy rules): tenant column tenant_id; every table is a tenant table but the global ones; global tables plans and tenants; files **/*.sql; minimum severity notice
rules: unscoped-query (error); unscoped-join (warning); insert-without-tenant (error); missing-tenant-column (error); unindexed-tenant-column (warning); allow-without-reason (error); unused-allow (notice)
findings: 0; 1 allowed by a marker

Findings (0)

  none

Allowed by a marker (1)

  ALLOWED  unscoped-query           examples/clean/queries/changes.sql:17
           the SELECT reads tasks with no condition on tasks.tenant_id, so it can return the rows of every tenant
           reason (line 15): the billing job counts the tasks of every tenant, and runs only under the billing role

Read: examples/clean

  tenant tables  5: users (tenant_id), projects (tenant_id), tasks (tenant_id), comments (tenant_id) and audit_events (tenant_id)
  global tables  2: plans and tenants
  queries        10 checked: 6 select, 2 insert, 1 update, 1 delete, 0 truncate
  schema         7 create table, 1 alter table, 2 create index, 0 drop table; 0 other statements not checked
  allow markers  1: 1 with a reason, 0 without, 0 with nothing to allow

This report reads the SQL text of the files it was given. It does not connect to a database or run a query, and it does not see SQL built at run time, queries made by an ORM, the body of a view or a function, or row-level security policies (docs/limits.md).

RESULT: PASS - no error
```

## What it checks

| Rule | Key | Default level | Finds |
| --- | --- | --- | --- |
| `unscoped-query` | `rules.unscopedQuery` | error | a SELECT, UPDATE, DELETE, TRUNCATE or TABLE that reads or changes a tenant table with no condition on its tenant column, and that does not reach it through a key from a scoped tenant table |
| `unscoped-join` | `rules.unscopedJoin` | warning | a tenant table reached only through a key from a scoped tenant table, with no tie between their tenant columns and no tenant condition of its own |
| `insert-without-tenant` | `rules.insertWithoutTenant` | error | an INSERT into a tenant table that does not set the tenant column, or names no columns, unless the column has a DEFAULT |
| `missing-tenant-column` | `rules.missingTenantColumn` | error | a table the configuration makes a tenant table whose CREATE TABLE has no tenant column |
| `unindexed-tenant-column` | `rules.unindexedTenantColumn` | warning | a tenant column that is not the first column of any index, primary key or unique constraint, when the input holds a CREATE INDEX |
| `allow-without-reason` | `rules.allowWithoutReason` | error | a `tenant-scope: allow` marker with no reason, or with one that says nothing, such as TBD |
| `unused-allow` | `rules.unusedAllow` | notice | a `tenant-scope: allow` marker on a statement that has no finding |

[docs/method.md](docs/method.md) says exactly what each rule looks at and what it cannot see, and [docs/rules-and-sources.md](docs/rules-and-sources.md) gives the points of the public pages each rule rests on.

## Scoped, reached and neither

In each SELECT block, and in the target and the FROM list of an UPDATE or a DELETE, the tool reads the conditions every row must pass: the parts of WHERE and of an inner join's ON joined by AND. A tenant table is **scoped** when one of them compares its tenant column to a value (a parameter such as `$1`, `:tenant` or `?`, a literal, a function call such as `current_setting('app.tenant_id')`, a subquery, or a column of an outer query), or ties it by equality to the tenant column of a scoped table. A tenant table that is not scoped but is **reached** through an equality with a scoped tenant table, such as `c.id = o.customer_id`, is `unscoped-join`: its rows come from another tenant only if a key points across tenants, which is why it is a warning. A tenant table that is **neither** is `unscoped-query`.

```sql
-- scoped: passes
SELECT * FROM orders o JOIN customers c ON c.tenant_id = o.tenant_id AND c.id = o.customer_id WHERE o.tenant_id = $1;
-- reached: unscoped-join on customers
SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.tenant_id = $1;
-- neither: unscoped-query on orders, because the OR lets every tenant through
SELECT * FROM orders WHERE tenant_id = $1 OR status = 'open';
```

A condition in the ON of an outer join counts only for the side the join does not keep whole, so `orders o LEFT JOIN plans p ON p.id = o.plan_id AND o.tenant_id = $1` still returns the orders of every tenant. A global table, such as `plans`, needs no condition and passes nothing on: a tenant table reached only through a global one is `unscoped-query`. CTEs, subqueries in FROM, in the select list and in WHERE, and every part of a UNION are checked on their own; a CTE or a subquery that is limited to one tenant counts as scoped where it is used.

## Allow markers

```sql
-- name: TasksPerTenant :many
-- tenant-scope: allow the billing job counts the tasks of every tenant, and runs only under the billing role
SELECT tenant_id, count(*) AS tasks FROM tasks GROUP BY tenant_id;
```

A comment that starts with `tenant-scope: allow` and gives a reason moves every finding of its statement to the allowed list, where the report shows it with the reason. The comment belongs to the statement it comes before, or to the statement whose semicolon is on its line; it may also sit inside the statement. A reason that is empty or says nothing (TBD, todo, none, n/a and the like) allows nothing and is `allow-without-reason`, an error. A marker on a statement with no finding is `unused-allow`, so stale markers do not stay in place to hide a later finding.

## The configuration file

```json
{
  "name": "Larkspur tenancy rules",
  "tenantTables": "all",
  "globalTables": ["plans", "tenants"]
}
```

Without a configuration, the tenant column is `tenant_id` and the tenant tables are the tables whose CREATE TABLE (or a later ALTER TABLE) gives them that column. A configuration can name other tenant columns (`"tenantColumns": ["tenant_id", "account_id"]`), name the tenant tables one by one, or make every table but the global ones a tenant table with `"tenantTables": "all"`, so that a new table without the column is `missing-tenant-column`. It also sets the file patterns of a folder (`files`, `exclude`), the reasons that say nothing, the level of every rule and the minimum severity. A list is a JSON array that replaces the built-in list, or an object with `replace`, `add` and `remove`. A key the tool does not know is an error with its line and a suggestion, and a key named twice is refused. [docs/inputs.md](docs/inputs.md) describes every key, and `--print-defaults` writes the whole default configuration out.

## Formats

- `text`: for a terminal: what was read, the counts, the findings with the file and line, the allowed statements with their reasons, the tenant and global tables, the notes, the notice and the result. With `--explain` also the rule, the points of the public pages and the tool's own choice behind each finding.
- `json` (or `--json`): the whole report: the input, the configuration, the tenant tables, the counts, every finding with its file and line, the allowed findings with their reasons, the totals, the result, the notes and the notice.
- `github`: one workflow command per finding, `::error`, `::warning` or `::notice` with the file and line, which GitHub shows as an annotation on the SQL file in the pull request, then a summary line. The characters a command gives a meaning to are escaped. Two findings of the leaky example:

```
::error file=examples/leaky/queries/invoices.sql,line=2,title=tenant-scope-check unscoped-query::the SELECT reads invoices with no condition on invoices.tenant_id, so it can return the rows of every tenant
::warning file=examples/leaky/queries/invoices.sql,line=7,title=tenant-scope-check unscoped-join::the SELECT reads customers (c) through c.id = i.customer_id from invoices (i) only: no condition ties c.tenant_id to the tenant of invoices (i) or compares it to a value, so a key that points into another tenant brings that tenant's rows in
```

## Exit codes

`0`: no finding at the level error. `1`: at least one finding at the level error; a rule can be raised to error or lowered to warning or notice in the configuration. `2`: a usage or input error: no path, an unknown option, an option given twice, a URL in place of a path, a file or folder that cannot be read, a symbolic link named on the command line, a folder with no file that matches, a file over its limit, a binary, UTF-16 or invalid UTF-8 file, a string, a quoted name, a dollar quote or a comment that is not closed, a parenthesis that is not matched, or a configuration with an unknown key, a key named twice or a value of the wrong kind. With exit code `2` the tool gives no result and prints the problems on standard error.

## Limits

The tool reads SQL text, not a database, and it is not a full SQL parser: a small tokenizer that knows strings, quoted names, comments and dollar quotes, and a reader of the parts of a query that decide which rows it touches. It does not see SQL built at run time, queries made by an ORM or a query builder, the body of a view, a function or a trigger, or row-level security policies, and it tells tables apart by name without their schema. Row-level security in the database is the stronger guard, because it holds for every query whoever wrote it; this tool is a check on the SQL you can see. [docs/limits.md](docs/limits.md) lists what it cannot see, with the size limits: 2 MB for a file, 32 MB and 5,000 files for a run, parentheses 64 deep, 500 findings listed per rule. [docs/threat-model.md](docs/threat-model.md) lists the risks of reading SQL written by many hands and their controls, and [docs/secure-defaults.md](docs/secure-defaults.md) the defaults and how to run the tool in a pipeline.

## Architecture

Plain ES modules in `src/`, with no dependencies.

| File | Job |
| --- | --- |
| `src/cli.js` | the command line, the usage and the exit codes |
| `src/check.js` | reads the configuration and the files, runs the checks and builds the report of the run |
| `src/files.js`, `src/glob.js` | the bounded reading of files and folders with no link followed, and the file patterns |
| `src/sql.js`, `src/items.js` | the tokenizer, the split into statements, the comments of each statement and the groups of parentheses |
| `src/schema.js` | the tables, columns, defaults and index columns that CREATE TABLE, ALTER TABLE, CREATE INDEX and DROP TABLE describe |
| `src/queries.js` | the checks of SELECT, INSERT, UPDATE, DELETE and TRUNCATE, with their joins, CTEs and subqueries |
| `src/analyse.js` | the tenant tables, the checks of the schema and the allow markers |
| `src/config.js`, `src/defaults.js`, `src/json.js` | the configuration file over the defaults, and its strict JSON reader |
| `src/rules.js` | the seven rules and the result |
| `src/report.js`, `src/text.js`, `src/size.js`, `src/words.js` | the text, JSON and GitHub output, the cleaning of text from the input, number formats, and words compared as words |
| `src/data.js` | the public pages and the points the checks rest on, in this project's own words |
| `tools/check.mjs`, `tools/example.mjs` | the repository checks, and the examples with their real output |

## Where the facts come from

| Fact | Source |
| --- | --- |
| In the pool model tenants share one database and its tables | AWS Well-Architected SaaS Lens, https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html |
| Keeping each tenant from the resources of another is foundational | AWS Well-Architected SaaS Lens, https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html |
| A shared schema carries a tenant identifier column, and queries must never expose more than one tenant | Microsoft Learn, https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns |
| Row security policies limit which rows each role sees, and who bypasses them | PostgreSQL documentation, https://www.postgresql.org/docs/current/ddl-rowsecurity.html |
| Strings, escape strings, dollar quotes, quoted identifiers and nested comments | PostgreSQL documentation, https://www.postgresql.org/docs/current/sql-syntax-lexical.html |
| A multicolumn index serves conditions on its leading columns best | PostgreSQL documentation, https://www.postgresql.org/docs/current/indexes-multicolumn.html |
| Check access on every request for the object asked for, and deny by default | OWASP Authorization Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html |
| A tenant identifier from the client only selects a tenant; guard every tenant table | OWASP Multi-Tenant Application Security Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html |
| Reaching another user's record by changing its key | CWE-639, https://cwe.mitre.org/data/definitions/639.html |
| Annotations from workflow commands | GitHub Docs, https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands |
| Repeated names in a JSON object | RFC 8259, https://www.rfc-editor.org/rfc/rfc8259 |

[research/sources.md](research/sources.md) has a note on each page, in this project's own words.

## Background

A shared database is the cheapest way to run many tenants and the easiest to get wrong, because the boundary between customers lives in every query rather than in the infrastructure. Checking the SQL on each pull request catches the forgotten condition before it reaches a customer; how a multi-tenant product is planned, from the tenancy model to the database design, is described on the page [SaaS Consulting Services](https://innerluxes.dev/software-development/saas/consulting).

## License

MIT
