// The built-in configuration: the tenant column, where the tenant tables come from, the files read in a folder, the
// values that say nothing, and the level of every rule. docs/inputs.md describes every key, and --print-defaults writes
// all of this out as a configuration file.

// The column that says which tenant a row belongs to. A configuration may name several, such as tenant_id and
// account_id; a table then needs one of them.
export const DEFAULT_TENANT_COLUMNS = ['tenant_id'];

// Where the tenant tables come from: "schema" for every table whose CREATE TABLE has a tenant column, "all" for every
// table but the global ones, or a list of table names.
export const TENANT_TABLE_MODES = ['schema', 'all'];
export const DEFAULT_TENANT_TABLES = 'schema';

// Tables shared by every tenant, such as plans or countries, which are never tenant tables.
export const DEFAULT_GLOBAL_TABLES = [];

// The files read in a folder named on the command line, and the files left out. A pattern with no slash matches the
// file name in any folder.
export const DEFAULT_FILES = ['**/*.sql'];
export const DEFAULT_EXCLUDE = [];

// Folders a walk never enters.
export const SKIPPED_FOLDERS = ['.git', 'node_modules'];

// Reasons that give no reason, compared as whole lowercase words (src/words.js).
export const DEFAULT_EMPTY_VALUES = ['tbd', 'tba', 'todo', 'none', 'n a', 'na', 'unknown', 'reason', 'no reason', 'fixme'];

// The comment that marks a statement as allowed to cross tenants: the marker, then "allow", then the reason.
export const ALLOW_MARKER = 'tenant-scope:';

export const DEFAULT_RULES = {
  unscopedQuery: 'error',
  unscopedJoin: 'warning',
  insertWithoutTenant: 'error',
  missingTenantColumn: 'error',
  unindexedTenantColumn: 'warning',
  allowWithoutReason: 'error',
  unusedAllow: 'notice'
};

// The lowest level of a finding that is shown.
export const DEFAULT_MIN_SEVERITY = 'notice';
