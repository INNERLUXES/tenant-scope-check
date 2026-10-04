# Rules and sources

Every rule rests on points of public pages, written in this project's own words; this document lists them, with the
choices that are the tool's own. The same points are in src/data.js and are shown by `--explain`; research/sources.md
has a longer note on each page.

## Rules

### `unscoped-query`

- In a database shared by many tenants every table of tenant data carries a tenant identifier column so that one tenant can be picked out, and queries must never expose the data of more than one tenant. ([Multitenant SaaS database tenancy patterns (Microsoft Learn, Azure SQL Database)](https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns))
- Permissions are checked on every request for the specific object asked for, since checking most requests is not enough. ([Authorization Cheat Sheet (OWASP Cheat Sheet Series)](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html))
- Authorization fails when one user can reach the record of another by changing the key that names the record. ([CWE-639: Authorization Bypass Through User-Controlled Key (MITRE)](https://cwe.mitre.org/data/definitions/639.html))
- The tool's own choice: a condition counts only when every row must pass it: a part under OR or NOT, or a condition in the ON of an outer join on the side the join keeps whole, does not count; a table reached through a key from a scoped tenant table is left to unscoped-join; TRUNCATE of a tenant table is reported here too.

### `unscoped-join`

- In a database shared by many tenants every table of tenant data carries a tenant identifier column so that one tenant can be picked out, and queries must never expose the data of more than one tenant. ([Multitenant SaaS database tenancy patterns (Microsoft Learn, Azure SQL Database)](https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns))
- Every multi-tenant system must keep each tenant from reaching the resources of another, and crossing that line can be an event a SaaS business does not recover from. ([Tenant isolation (AWS Well-Architected SaaS Lens)](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html))
- The tool's own choice: a warning, not an error, because the joined rows are reached through the rows of a scoped tenant table and come from another tenant only when a key points across tenants; tying the tenant columns together, or a tenant condition on the joined table, clears it.

### `insert-without-tenant`

- In a database shared by many tenants every table of tenant data carries a tenant identifier column so that one tenant can be picked out, and queries must never expose the data of more than one tenant. ([Multitenant SaaS database tenancy patterns (Microsoft Learn, Azure SQL Database)](https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns))
- A tenant identifier from the client only selects a tenant and is checked on the server against the tenant of the signed-in user, and each tenant table in a shared database is listed and guarded. ([Multi-Tenant Application Security Cheat Sheet (OWASP Cheat Sheet Series)](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html))
- The tool's own choice: an INSERT that names no columns is reported, because the tool cannot see which value goes into the tenant column; a tenant column with a DEFAULT in its CREATE TABLE or a later ALTER TABLE may be left out.

### `missing-tenant-column`

- In a database shared by many tenants every table of tenant data carries a tenant identifier column so that one tenant can be picked out, and queries must never expose the data of more than one tenant. ([Multitenant SaaS database tenancy patterns (Microsoft Learn, Azure SQL Database)](https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns))
- In the pool model tenants share resources such as one database and its tables, which is the classic form of multi-tenancy, where the bridge model mixes pooled and siloed parts. ([Silo, pool, and bridge models (AWS Well-Architected SaaS Lens)](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html))
- The tool's own choice: the rule can fire only when the configuration names the tenant tables or makes every table but the global ones a tenant table; with tenant tables taken from the schema, a table without the column is not a tenant table.

### `unindexed-tenant-column`

- A multicolumn B-tree index is used best by equality conditions on its leading columns, so the column every query filters on belongs first. ([Multicolumn indexes (PostgreSQL documentation)](https://www.postgresql.org/docs/current/indexes-multicolumn.html))
- Where tenant data is split across databases the tenant identifier is the leading part of the primary key, so the rows of one tenant can be found quickly. ([Multitenant SaaS database tenancy patterns (Microsoft Learn, Azure SQL Database)](https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns))
- The tool's own choice: only the leading column of an index, a primary key or a unique constraint counts, and the rule runs only when the input holds at least one CREATE INDEX, so a set of query files alone is not reported.

### `allow-without-reason`

- Access is denied unless a rule allows it, rather than allowed unless a rule forbids it. ([Authorization Cheat Sheet (OWASP Cheat Sheet Series)](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html))
- Permissions are checked on every request for the specific object asked for, since checking most requests is not enough. ([Authorization Cheat Sheet (OWASP Cheat Sheet Series)](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html))
- The tool's own choice: the form of the marker, -- tenant-scope: allow followed by a reason, is the tool's own; a reason that is empty or says nothing, such as TBD, allows nothing.

### `unused-allow`

- Access is denied unless a rule allows it, rather than allowed unless a rule forbids it. ([Authorization Cheat Sheet (OWASP Cheat Sheet Series)](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html))
- The tool's own choice: a marker on a statement with no finding is reported, so a stale marker does not stay in place to hide a later finding.

## The reader, the stronger guard and the output

- A string constant doubles a quote inside it, an escape string takes backslashes, a dollar-quoted string needs no escape at all, a quoted identifier doubles its double quote, and block comments nest. ([Lexical structure (PostgreSQL documentation)](https://www.postgresql.org/docs/current/sql-syntax-lexical.html))
- Row security policies limit for each role which rows a query returns or a command changes, with no row visible when security is on and no policy exists, while superusers, roles with BYPASSRLS and normally the table owner skip them. ([Row security policies (PostgreSQL documentation)](https://www.postgresql.org/docs/current/ddl-rowsecurity.html))
- A line of output such as ::error file=...,line=...::message becomes an annotation on that file and line in the run. ([Workflow commands for GitHub Actions (GitHub Docs)](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands))
- When an object repeats a name the behaviour of the software that reads it cannot be predicted, so the configuration reader refuses a repeated name. ([RFC 8259, The JSON Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259))

## Pages

| Page | Address |
| --- | --- |
| Silo, pool, and bridge models (AWS Well-Architected SaaS Lens) | https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html |
| Tenant isolation (AWS Well-Architected SaaS Lens) | https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html |
| Multitenant SaaS database tenancy patterns (Microsoft Learn, Azure SQL Database) | https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns |
| Row security policies (PostgreSQL documentation) | https://www.postgresql.org/docs/current/ddl-rowsecurity.html |
| Lexical structure (PostgreSQL documentation) | https://www.postgresql.org/docs/current/sql-syntax-lexical.html |
| Multicolumn indexes (PostgreSQL documentation) | https://www.postgresql.org/docs/current/indexes-multicolumn.html |
| Authorization Cheat Sheet (OWASP Cheat Sheet Series) | https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html |
| Multi-Tenant Application Security Cheat Sheet (OWASP Cheat Sheet Series) | https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html |
| CWE-639: Authorization Bypass Through User-Controlled Key (MITRE) | https://cwe.mitre.org/data/definitions/639.html |
| Workflow commands for GitHub Actions (GitHub Docs) | https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands |
| RFC 8259, The JSON Data Interchange Format | https://www.rfc-editor.org/rfc/rfc8259 |

## What is the tool's own

The pages say why a shared database needs a tenant condition on every query, why access is checked for each object asked for, and how row security and indexes work; they do not say how to read a query for its tenant condition. The reading of conditions (only the parts joined by AND count, an outer join limits only one side, a global table passes nothing on), the split between a table with no tenant condition and one reached through a key, the allow marker with its reason, the reasons that say nothing, the rule that an index must start with the tenant column, and the level of every rule are the tool's own choices. The words and the levels can be changed in the configuration (docs/inputs.md), and docs/method.md says exactly how each is used.
