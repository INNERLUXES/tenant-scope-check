# Changes

## 1.0.0

First release.

- Reads the SQL of a multi-tenant application that keeps every tenant in one shared database, from one file, a folder, or the migrations and the query files together, and reports the queries that could leak data from one tenant to another.
- Seven rules: `unscoped-query`, `unscoped-join`, `insert-without-tenant`, `missing-tenant-column`, `unindexed-tenant-column`, `allow-without-reason` and `unused-allow`, each with a level of its own (`error`, `warning`, `notice` or `off`) and the points of the public pages it rests on.
- Tenant tables from the schema (every CREATE TABLE with the tenant column), from a list, or every table but the global ones, with one tenant column or several. The schema follows CREATE TABLE, ALTER TABLE, CREATE INDEX and DROP TABLE in the order of the files.
- Only conditions every row must pass count: the parts of WHERE and of an inner join joined by AND; a part under OR or NOT, or a condition on the side an outer join keeps whole, does not. A tenant table joined to a scoped one on a key alone is a warning of its own, and a global table passes nothing on. CTEs, subqueries, derived tables, set operations, UPDATE ... FROM, DELETE ... USING, INSERT ... SELECT, TRUNCATE, EXPLAIN and PREPARE are read.
- A small tokenizer that knows strings, escape strings, dollar quotes, quoted identifiers, nested comments and parameters, and splits statements at semicolons and around BEGIN ATOMIC; text it cannot place stops the run with its line.
- Allow markers, `-- tenant-scope: allow <reason>`, list a statement as allowed with its reason; a marker with no reason is an error and a marker with nothing to allow is a notice.
- A configuration file in strict JSON over documented defaults: the tenant columns, the tenant and global tables, the file patterns of a folder, the reasons that say nothing, the level of every rule and the minimum severity; a key the tool does not know is an error with its line and a suggestion, and a key named twice is refused.
- Reports as text, JSON and GitHub workflow commands (`--format github`) that show each finding as an annotation on the SQL file and line, `--min-severity` to hide the findings below a level, and `--explain` to show the rule and the sources behind each finding. Exit code `0` when no finding is at the level error, `1` when one is, `2` for a usage or input error, with no result.
- Reads no clock, follows no symbolic link, fetches nothing, connects to no database, writes nothing to disk, and refuses binary, UTF-16 and invalid UTF-8 input; every input has a size limit.
- Release packages come with a CycloneDX SBOM, SHA-256 checksums and a build provenance attestation, after the SSDF gate of the repository.
