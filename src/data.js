// The public pages the checks rest on, and what each says, written in this project's own words. research/sources.md
// lists the same pages with a longer note on each, and test/data.test.js checks that every page here is listed there and
// that every rule names points that exist. The code in src/ uses these constants and never writes a reason of its own
// in a report.

export const SOURCES = [
  { id: 'awsModels', title: 'Silo, pool, and bridge models (AWS Well-Architected SaaS Lens)', url: 'https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html' },
  { id: 'awsIsolation', title: 'Tenant isolation (AWS Well-Architected SaaS Lens)', url: 'https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html' },
  { id: 'msPatterns', title: 'Multitenant SaaS database tenancy patterns (Microsoft Learn, Azure SQL Database)', url: 'https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns' },
  { id: 'pgRowSecurity', title: 'Row security policies (PostgreSQL documentation)', url: 'https://www.postgresql.org/docs/current/ddl-rowsecurity.html' },
  { id: 'pgLexical', title: 'Lexical structure (PostgreSQL documentation)', url: 'https://www.postgresql.org/docs/current/sql-syntax-lexical.html' },
  { id: 'pgMulticolumn', title: 'Multicolumn indexes (PostgreSQL documentation)', url: 'https://www.postgresql.org/docs/current/indexes-multicolumn.html' },
  { id: 'owaspAuthorization', title: 'Authorization Cheat Sheet (OWASP Cheat Sheet Series)', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html' },
  { id: 'owaspMultiTenant', title: 'Multi-Tenant Application Security Cheat Sheet (OWASP Cheat Sheet Series)', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html' },
  { id: 'cwe639', title: 'CWE-639: Authorization Bypass Through User-Controlled Key (MITRE)', url: 'https://cwe.mitre.org/data/definitions/639.html' },
  { id: 'githubCommands', title: 'Workflow commands for GitHub Actions (GitHub Docs)', url: 'https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands' },
  { id: 'rfc8259', title: 'RFC 8259, The JSON Data Interchange Format', url: 'https://www.rfc-editor.org/rfc/rfc8259' }
];

export const source = (id) => SOURCES.find((s) => s.id === id);

// What a page says, in this project's own words. Each point names its page.
export const POINTS = {
  poolShared: { source: 'awsModels', text: 'in the pool model tenants share resources such as one database and its tables, which is the classic form of multi-tenancy, where the bridge model mixes pooled and siloed parts' },
  isolationFoundational: { source: 'awsIsolation', text: 'every multi-tenant system must keep each tenant from reaching the resources of another, and crossing that line can be an event a SaaS business does not recover from' },
  tenantColumn: { source: 'msPatterns', text: 'in a database shared by many tenants every table of tenant data carries a tenant identifier column so that one tenant can be picked out, and queries must never expose the data of more than one tenant' },
  tenantLeadingKey: { source: 'msPatterns', text: 'where tenant data is split across databases the tenant identifier is the leading part of the primary key, so the rows of one tenant can be found quickly' },
  rowSecurity: { source: 'pgRowSecurity', text: 'row security policies limit for each role which rows a query returns or a command changes, with no row visible when security is on and no policy exists, while superusers, roles with BYPASSRLS and normally the table owner skip them' },
  lexical: { source: 'pgLexical', text: 'a string constant doubles a quote inside it, an escape string takes backslashes, a dollar-quoted string needs no escape at all, a quoted identifier doubles its double quote, and block comments nest' },
  leadingColumns: { source: 'pgMulticolumn', text: 'a multicolumn B-tree index is used best by equality conditions on its leading columns, so the column every query filters on belongs first' },
  checkEveryRequest: { source: 'owaspAuthorization', text: 'permissions are checked on every request for the specific object asked for, since checking most requests is not enough' },
  denyByDefault: { source: 'owaspAuthorization', text: 'access is denied unless a rule allows it, rather than allowed unless a rule forbids it' },
  tenantSelector: { source: 'owaspMultiTenant', text: 'a tenant identifier from the client only selects a tenant and is checked on the server against the tenant of the signed-in user, and each tenant table in a shared database is listed and guarded' },
  userKey: { source: 'cwe639', text: 'authorization fails when one user can reach the record of another by changing the key that names the record' },
  githubAnnotations: { source: 'githubCommands', text: 'a line of output such as ::error file=...,line=...::message becomes an annotation on that file and line in the run' },
  jsonRepeatedNames: { source: 'rfc8259', text: 'when an object repeats a name the behaviour of the software that reads it cannot be predicted, so the configuration reader refuses a repeated name' }
};

// The page of a point.
export const pointPage = (key) => source(POINTS[key].source);

// The levels of a finding, from the lowest. A finding at the level error makes the run fail.
export const LEVELS = ['notice', 'warning', 'error'];

// The sentence every report ends with, before the result.
export const NOTICE = 'This report reads the SQL text of the files it was given. It does not connect to a database or run a query, and it does not see SQL built at run time, queries made by an ORM, the body of a view or a function, or row-level security policies (docs/limits.md).';
