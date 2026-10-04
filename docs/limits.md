# Limits

The tool reads SQL text and checks what it says: which tables hold tenant data, and which conditions limit each query
to one tenant. It does not connect to a database and it does not run a query. A run with no finding means the SQL it
was given has a tenant condition where it looked; it does not mean the application keeps tenants apart. Every report
ends with a sentence that says so.

## What it cannot see

- **SQL it is not given.** Queries built at run time from strings, queries made by an ORM or a query builder
  (ActiveRecord, Django, Hibernate, Prisma, Sequelize, SQLAlchemy and the rest), and SQL kept in application code
  rather than in `.sql` files are not read. A team that keeps its queries in code can export them, or keep the tenant
  condition in one place that the ORM adds to every query.
- **Views, functions, procedures and triggers.** The body of a view, a function, a procedure or a trigger is not
  checked, and a query on a view does not see the tables behind it. A view can be listed in `tenantTables`, so a query
  on it needs a tenant condition.
- **Row-level security.** A table with a row security policy may be safe with no condition in the query, and the tool
  does not read policies. Row-level security is the stronger guard: PostgreSQL applies the policy to every query of
  the roles it covers, whoever wrote the query, and with security on and no policy no row is visible at all. It does
  not cover superusers, roles with BYPASSRLS, or, unless the table forces it, the owner of the table, so the
  application must connect with a role that is subject to it. Use this tool beside it, as a check on the SQL you can
  see, and allow with a marker a query that relies on a policy.
- **What a value is.** `tenant_id = $1` counts whatever `$1` turns out to be. Whether the value is the tenant of the
  signed-in user, and not a value the client sent, is the application's job.
- **A full SQL grammar.** The reader is a tokenizer with a reader of FROM lists and conditions, not a parser. It does
  not check that the SQL is valid, and an unusual form can be read as something it is not. MERGE, COPY, DECLARE ...
  CURSOR, CREATE TABLE ... AS SELECT and statements of procedural languages are not checked. MySQL's `#` comments and
  `DELIMITER` lines are not read as such, and SQL Server's `[name]` is read as an operator and a name.
- **Schemas.** Tables are told apart by their name alone, so `app.orders` and `audit.orders` are one table, and a
  table in a schema per tenant is outside what this tool is for.
- **Conditions under OR and NOT.** A tenant condition that every branch of an OR repeats is not read, so
  `(tenant_id = $1 AND a) OR (tenant_id = $1 AND b)` is reported; write the tenant condition once, outside the OR.
- **Ties through global tables and expressions.** A tenant column compared to an expression of another column
  (`o.tenant_id = c.tenant_id + 0`) counts as compared to a value, and a condition on another column of a global table
  limits nothing.
- **Index use.** `unindexed-tenant-column` looks for the tenant column first in an index; whether the database uses
  that index for a query is not judged, and an index made outside the files read is not seen.
- **Dates.** An allow marker has no end; a marker stays until it is removed
  ([decision 1](decisions/0001-read-no-clock-and-keep-dates-out-of-the-repository.md)).

## Size limits

Past a limit, the input is refused with exit code `2` and no result, or, where the limit is on the work and not the
input, the report says so in a note.

| What | Limit |
| --- | --- |
| a SQL file | 2 MB |
| all the files of a run | 32 MB |
| files read in a run | 5,000 |
| files and folders looked at in a walk | 100,000 |
| folders nested in a walk | 32 deep |
| paths on the command line | 100 |
| tokens of one file | 1,000,000 |
| parentheses | nested 64 deep |
| configuration file | 1 MB; 500 entries in a list; 120 characters for an entry; 200 for a file pattern |
| JSON of the configuration | nesting 32 deep, 100,000 values, 4,096 characters in a string |
| findings of one rule | 500 listed; the rest are counted in a note and still count for the result |
| problems of the input | 20 listed; the rest are counted |

The tests read twenty thousand statements in one file, joins of four hundred tables, runs of a million quotes, dollar
signs, dashes, comment marks and parentheses, and a hundred broken files, each with a time check.
