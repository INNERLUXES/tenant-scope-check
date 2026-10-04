# Inputs

## The SQL

```
tenant-scope-check <sql-file-or-folder>... [options]
```

One or more paths, up to 100: SQL files, folders of them, or both. A file is read whatever its name; a folder is
walked and the files that match `files` and not `exclude` are read (docs/method.md). Each path may be named once.

The SQL may be in any dialect that keeps to the lexical rules of docs/method.md: PostgreSQL, MySQL with backtick
names, SQLite and the SQL files of query tools such as sqlc, with their `-- name:` comments. Migrations and queries may
sit in the same files or in different ones.

```sql
CREATE TABLE invoices (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  number text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- name: GetInvoice :one
SELECT * FROM invoices WHERE tenant_id = $1 AND id = $2;

-- name: AllInvoiceCounts :many
-- tenant-scope: allow the finance export counts invoices of every tenant under its own role
SELECT tenant_id, count(*) FROM invoices GROUP BY tenant_id;
```

An allow marker is a comment that starts with `tenant-scope:` and then `allow` as a word; the rest, after an optional
colon or dash, is the reason. It may be a line comment or a block comment, before the statement or inside it, or after
its semicolon on the same line.

## The configuration file

`--config <file>` names a configuration file: one JSON object, read strictly as RFC 8259 writes JSON, with no
comments and no trailing comma. A key named twice in one object is refused, and so is every key the tool does not know,
with its line and a suggestion. Every key is optional and changes one default.

```json
{
  "name": "Brightwater tenancy rules",
  "tenantColumns": ["tenant_id", "account_id"],
  "tenantTables": "all",
  "globalTables": ["plans", "tenants", "currencies"],
  "files": ["db/**/*.sql"],
  "exclude": ["**/seed/*.sql"],
  "emptyValues": { "add": ["ask the platform team"] },
  "rules": { "unscopedJoin": "error", "unusedAllow": "off" },
  "minSeverity": "notice"
}
```

A list is either a JSON array, which replaces the built-in list, or an object with `replace`, `add` and `remove`,
applied in that order. Removing an entry that is not on the list, or adding one that is, is an error.

| Key | Value | Default |
| --- | --- | --- |
| `name` | a text of 1 to 120 characters, shown in the report | none |
| `tenantColumns` | a list of column names; a tenant table needs one of them | `["tenant_id"]` |
| `tenantTables` | `"schema"`, `"all"` or a list of table names (an array only) | `"schema"` |
| `globalTables` | a list of table names that are never tenant tables | `[]` |
| `files` | a list of file patterns; a file in a folder named on the command line is read when its path matches one | `["**/*.sql"]` |
| `exclude` | a list of file patterns; a file that matches one is not read | `[]` |
| `emptyValues` | a list of phrases that give no reason, compared as whole lowercase words | `tbd`, `tba`, `todo`, `none`, `n a`, `na`, `unknown`, `reason`, `no reason`, `fixme` |
| `rules` | an object of rule keys, each `error`, `warning`, `notice` or `off` | see below |
| `minSeverity` | `notice`, `warning` or `error`; findings below it are not shown | `notice` |

The keys of `rules`, with their defaults:

| Key | Rule | Default |
| --- | --- | --- |
| `rules.unscopedQuery` | `unscoped-query` | `error` |
| `rules.unscopedJoin` | `unscoped-join` | `warning` |
| `rules.insertWithoutTenant` | `insert-without-tenant` | `error` |
| `rules.missingTenantColumn` | `missing-tenant-column` | `error` |
| `rules.unindexedTenantColumn` | `unindexed-tenant-column` | `warning` |
| `rules.allowWithoutReason` | `allow-without-reason` | `error` |
| `rules.unusedAllow` | `unused-allow` | `notice` |

### Names

A column or table name in the configuration is a letter or `_` followed by letters, digits, `_` and `$`, and is
compared in lower case, as the database folds a name that is not quoted. A name with a schema in front, such as
`app.orders`, is refused, because tables are told apart by their name alone. A table in both `tenantTables` and
`globalTables` is an error.

### File patterns

A pattern is a path relative to the folder named on the command line, with forward slashes on every system. `*`
matches any run of characters inside one name, `?` matches one character, and `**` as a whole part matches any number
of folders. A pattern with no slash matches the file name in any folder, so `*.sql` is the same as `**/*.sql`.
Character classes (`[...]`), braces, `!`, a backslash, `..`, `.`, an empty part and a leading slash are refused. A
pattern is matched by hand and never turned into a regular expression.

`--min-severity` on the command line wins over `minSeverity`. `--print-defaults` writes the built-in configuration as
a configuration file; read back with `--config`, it gives the same result as no configuration.
