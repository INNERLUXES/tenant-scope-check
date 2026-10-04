# Sources

The public pages the checks of this tool are based on, each with a short note in this project's own words on what the
page says and which checks lean on it. Nothing here is a copy of a page: read the page itself for its exact wording.
src/data.js holds the same pages and the points the reports show, and test/data.test.js checks that every page there
is listed here. Each page was fetched and read before it was listed.

## Silo, pool, and bridge models (AWS Well-Architected SaaS Lens)

https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html

The page names the three shapes a SaaS architecture takes. In the silo model a tenant gets resources of its own, such
as a database per tenant, while onboarding, identity and operations stay shared. In the pool model tenants share
resources, compute, storage and the rest, which the page calls the classic form of multi-tenancy, chosen for cost,
scale and ease of operation. The bridge model mixes the two, one service siloed and another pooled. This tool is for
the pooled database: one schema, the rows of every tenant in the same tables, told apart by a column
(`missing-tenant-column`).

## Tenant isolation (AWS Well-Architected SaaS Lens)

https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html

The page calls tenant isolation one of the foundational topics of SaaS. Moving to shared infrastructure for cost and
efficiency brings the task of making sure no tenant reaches the resources of another, and the page describes crossing
that boundary as a significant event a SaaS business may not recover from. How isolation is built differs from one
system to the next, but every system needs the means to enforce it. A join that can bring in the rows of another
tenant is a crack in that boundary even when the rest of the query is limited (`unscoped-join`).

## Multitenant SaaS database tenancy patterns (Microsoft Learn, Azure SQL Database)

https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns

A guide to the tenancy models of a SaaS database: an application per tenant, a database per tenant, and databases
that hold many tenants, with or without sharding. For a database of many tenants, the page says the schema carries one
or more tenant identifier columns so that the data of one tenant can be picked out, that such a database gives up
isolation, and that during development queries must never expose the data of more than one tenant; it names
row-level security as a way to enforce that a query returns one tenant's rows. For sharded tables it notes that the
tenant identifier is the leading part of the primary key, so the rows of one tenant are found quickly. This tool leans
on it for `unscoped-query`, `unscoped-join`, `insert-without-tenant` and `missing-tenant-column`, and for
`unindexed-tenant-column` on the leading key.

## Row security policies (PostgreSQL documentation)

https://www.postgresql.org/docs/current/ddl-rowsecurity.html

The PostgreSQL chapter on row-level security. A table with row security enabled limits, for each role, which rows a
query returns and which rows INSERT, UPDATE and DELETE may change, through policies; with security on and no policy,
nothing is visible or can be changed. Superusers and roles with the BYPASSRLS attribute always bypass the policies,
and the owner of a table does too unless the table is set to force row security. This is the stronger guard this tool
points to in docs/limits.md: a policy holds for every query of the roles it covers, while this tool checks only the
SQL it reads.

## Lexical structure (PostgreSQL documentation)

https://www.postgresql.org/docs/current/sql-syntax-lexical.html

The section of the PostgreSQL manual on tokens. A name that is not quoted is folded to lower case; a quoted name keeps
its case and doubles a double quote inside it. A string constant doubles a single quote inside it; an escape string,
written with an E before the quote, takes backslash escapes; a dollar-quoted string, with an optional tag between the
dollar signs, needs no escaping and ends only at the same tag. Comments start with two dashes and run to the end of
the line, or sit between slash-star and star-slash, and block comments nest. The tokenizer of this tool follows these
rules, so a semicolon, a quote or a keyword inside a string, a name or a comment never moves where a statement ends
(docs/method.md).

## Multicolumn indexes (PostgreSQL documentation)

https://www.postgresql.org/docs/current/indexes-multicolumn.html

The section on indexes over several columns. A B-tree index over several columns serves a query best when the query
has equality conditions on the leading, leftmost columns; conditions on later columns are still checked in the index
but do not narrow the part of it that is scanned as much. In a shared database almost every query has a condition on
the tenant column, so an index that starts with it serves them (`unindexed-tenant-column`).

## Authorization Cheat Sheet (OWASP Cheat Sheet Series)

https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

OWASP's guidance on access control. It asks for deny by default, so that access is refused unless a rule grants it,
and for a permission check on every request, for the specific object asked for: checking most requests is not
enough, and a user who may see some objects of a type may not see all of them. It treats insecure direct object
references, reaching a record by its identifier alone, as a failure of that check. A query that reads a record by its
id with no tenant condition is that failure in SQL (`unscoped-query`), and an allow marker without a reason is an
exception with nothing behind it (`allow-without-reason`, `unused-allow`).

## Multi-Tenant Application Security Cheat Sheet (OWASP Cheat Sheet Series)

https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html

OWASP's guidance for applications that serve many tenants. It compares the ways to separate tenants in a database,
from a database per tenant to shared tables guarded by row-level policies, and it treats a tenant identifier sent by
the client as a selector only, to be checked on the server against the tenants the signed-in user belongs to. For
PostgreSQL row-level security it advises setting the tenant per transaction, never serving tenant requests through a
superuser or a role that bypasses the policies, and keeping a list of every table that holds tenant data with its
policy. This tool leans on it for `insert-without-tenant` (the tenant of a new row is set on purpose) and for the
inventory of tenant tables that `tenantTables` and `globalTables` keep.

## CWE-639: Authorization Bypass Through User-Controlled Key (MITRE)

https://cwe.mitre.org/data/definitions/639.html

The weakness in which an application checks that a user is signed in but not that the record the user asks for
belongs to them, so changing the key in a request, a field or a link reaches the record of someone else. It is also
known as an insecure direct object reference. In a shared database the tenant condition is what ties a key to the
tenant of the user; a query by key without it is this weakness (`unscoped-query`).

## Workflow commands for GitHub Actions (GitHub Docs)

https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands

The page that describes the `::error`, `::warning` and `::notice` commands with their `file`, `line`, `col` and
`title` properties, which turn a line of output into an annotation on a file. `--format github` writes one such
command per finding, with the SQL file and the line of the finding.

## RFC 8259, The JSON Data Interchange Format

https://www.rfc-editor.org/rfc/rfc8259

The JSON standard. Its section on objects notes that when the names in an object are not unique, programs that read
it behave in different ways: some keep the last value, some fail, some keep every pair. The configuration reader
refuses a repeated name instead of keeping one of the values, so a result never depends on which value a library
would keep.
