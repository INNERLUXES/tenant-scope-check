# Secure defaults

The default run is the safe run. Nothing in the first section needs a flag, and none of it can be switched off. The rest
of the document is about what the tool cannot do for you: where the SQL comes from, where the output goes, and who may
change the configuration.

## How the tool behaves by default

- **Reads, never follows.** The tool reads the files and folders it is given and the configuration named with
  `--config`. It follows no symbolic link, fetches no web address, refuses an argument that looks like an address,
  connects to no database, starts no program and writes nothing to disk.
- **Every rule on from the first run.** Without a configuration, a query with no tenant condition, an INSERT that
  does not set the tenant, a tenant table with no tenant column and a marker with no reason are errors; a join on a
  key alone and a tenant column that leads no index are warnings; a marker with nothing to allow is a notice.
- **Only conditions every row must pass.** A tenant condition under OR or NOT, or in the ON of an outer join on the
  side the join keeps whole, does not count, and a global table passes nothing on.
- **Unknown keys are errors.** A key in the configuration that the tool does not know stops the run, with its line and
  a suggestion, so a typo such as `tenantColumn` for `tenantColumns` cannot leave a default in place. A key named
  twice stops the run.
- **Fail closed on what it cannot read.** An input that cannot be read stops the run with exit code `2` and no result:
  a missing file, a link, a folder with no SQL file, a file over its limit, a binary file, UTF-16, bytes that are not
  UTF-8, a string, a quoted name, a dollar quote or a comment that is not closed, a parenthesis that is not matched.
- **Empty is not a reason.** An allow marker whose reason is empty or says nothing (TBD, todo, none) allows nothing
  and is an error.
- **No regular expression from the input.** No pattern is built from the SQL or the configuration; file patterns are
  matched by hand, and the tokenizer reads each character once.
- **No prototype tricks.** Objects are built with own properties, and tables, columns and aliases are looked up in
  `Map` and arrays, so `__proto__` is only a name.
- **Clean output.** Text from the input, file names included, has control characters, line separators and direction
  controls removed and its length capped before it reaches a report or an error message. The GitHub format escapes
  `%`, CR and LF in a message and also `:` and `,` in a property, so a text cannot end a workflow command early or
  start another one.
- **The same SQL gives the same output.** The tool reads no clock, no time zone, no locale and no random number
  ([decision 1](decisions/0001-read-no-clock-and-keep-dates-out-of-the-repository.md)); folders are walked in the
  order of their names by code unit, and case is changed for the letters A to Z only.
- **No dependencies.** Node 22 or newer and nothing else.

## Settings that make the check stricter

- **`"tenantTables": "all"` with `globalTables`.** Every table is a tenant table but the ones you name, so a new table
  without the tenant column fails the run (`missing-tenant-column`) and a query on a table that no migration in the
  input creates still needs a tenant condition.
- **`"rules": { "unscopedJoin": "error" }`.** A tenant table joined on a key alone fails the run.
- **`"rules": { "unindexedTenantColumn": "error" }`.** Every tenant column must lead an index.
- **`"rules": { "unusedAllow": "error" }`.** A stale allow marker fails the run.

## Running it in a pipeline

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
    with:
      node-version: 22
  - name: Tenant scope check
    run: npx --yes github:INNERLUXES/tenant-scope-check db/migrations db/queries --config db/tenancy.json --format github
```

- Give the job read access to the contents and nothing more. The tool needs no secret and no database.
- Pin every action to a full commit, as above, and pin the tool to a release commit or a tag you have read, because
  `npx` runs what it downloads.
- Do not hide the exit code with a trailing `|| true`.
- Findings name tables and quote conditions of your SQL. Post the output only where the people who may read the SQL
  read it.

## Protecting the SQL and the configuration

The configuration decides which tables hold tenant data, and an allow marker lets a query read every tenant. Keep the
configuration in the repository, put its path and the folders of SQL in `CODEOWNERS` with the people who own the data
model, and require their review in branch protection. Review a change that adds an allow marker, adds a table to
`globalTables`, removes one from `tenantTables`, adds a pattern to `exclude`, sets a rule to off or lower, or adds a
phrase to `emptyValues` like a change to code: each of them can let a leaky query pass.

Pair the check with row-level security in the database where you can (docs/limits.md): the tool sees the SQL in the
repository, and a policy guards every query that reaches the database.

## SSDF

The repository is checked against NIST SP 800-218 (SSDF) in its own pipeline and before every release, with
`ssdf-repo-check` pinned to its release commit. The evidence it looks for is in these files:

| Practice | Evidence in this repository |
| --- | --- |
| PO.1 Define security requirements | CONTRIBUTING.md, docs/secure-defaults.md |
| PO.2 Roles and responsibilities | .github/CODEOWNERS |
| PO.3 Toolchain | .github/workflows/ci.yml, codeql.yml, release.yml |
| PO.4 Criteria for security checks | CodeQL with the security-extended queries, the SSDF gate in ci.yml and release.yml |
| PO.5 Secure environments | a `permissions:` block in every workflow, actions pinned to commits |
| PS.1 Protect the code | .gitignore for keys and `.env`, `npm run check` for committed secrets |
| PS.2 Integrity of releases | SHA-256 checksums and a build provenance attestation in release.yml |
| PS.3 Archive and provenance | a CycloneDX SBOM and the CHANGELOG with every release |
| PW.1 Design for security | docs/threat-model.md |
| PW.2 Review the design | docs/decisions |
| PW.4 Reuse secure components | no runtime dependencies, a lock file, Dependabot |
| PW.5 Secure coding | CONTRIBUTING.md, `npm run check` |
| PW.6 Build settings | `npm ci` from the lock file |
| PW.7 Code review | the pull request template and CODEOWNERS |
| PW.8 Testing | `npm test` on Linux, Windows and macOS with Node 22 and 24, `npm run test:coverage`, hostile input tests |
| PW.9 Secure defaults | this document |
| RV.1 Find vulnerabilities | SECURITY.md, Dependabot |
| RV.2 Respond to vulnerabilities | SECURITY.md |
