// The seven rules and the result. Each rule names the points of the public pages it rests on (src/data.js), and says
// where it is the tool's own choice; docs/method.md says exactly what each rule looks at and what it cannot see. A rule
// whose level is "off" is not reported. The checks themselves are in src/queries.js and src/analyse.js.

import { LEVELS } from './data.js';
import { plural } from './size.js';

const columns = (c) => c.tenantColumns.join(' or ');

export const RULES = [
  {
    id: 'unscoped-query',
    key: 'unscopedQuery',
    title: 'a query on a tenant table with no condition on the tenant column',
    basis: ['tenantColumn', 'checkEveryRequest', 'userKey'],
    own: 'a condition counts only when every row must pass it: a part under OR or NOT, or a condition in the ON of an outer join on the side the join keeps whole, does not count; a table reached through a key from a scoped tenant table is left to unscoped-join; TRUNCATE of a tenant table is reported here too',
    rule: (c) => `a SELECT, UPDATE, DELETE, TRUNCATE or TABLE that reads or changes a tenant table with no condition, joined by AND, that compares its ${columns(c)} to a value or ties it to the tenant column of a table that has one, and that does not reach it through a key from such a table`
  },
  {
    id: 'unscoped-join',
    key: 'unscopedJoin',
    title: 'a tenant table joined on a key alone',
    basis: ['tenantColumn', 'isolationFoundational'],
    own: 'a warning, not an error, because the joined rows are reached through the rows of a scoped tenant table and come from another tenant only when a key points across tenants; tying the tenant columns together, or a tenant condition on the joined table, clears it',
    rule: (c) => `a tenant table joined to a scoped tenant table through a key such as c.id = o.customer_id, with no condition that ties its ${columns(c)} to the other table or compares it to a value`
  },
  {
    id: 'insert-without-tenant',
    key: 'insertWithoutTenant',
    title: 'an INSERT into a tenant table that does not set the tenant column',
    basis: ['tenantColumn', 'tenantSelector'],
    own: 'an INSERT that names no columns is reported, because the tool cannot see which value goes into the tenant column; a tenant column with a DEFAULT in its CREATE TABLE or a later ALTER TABLE may be left out',
    rule: (c) => `an INSERT into a tenant table whose column list does not name its ${columns(c)}, or that names no columns, unless that column has a DEFAULT in the schema read`
  },
  {
    id: 'missing-tenant-column',
    key: 'missingTenantColumn',
    title: 'a tenant table with no tenant column',
    basis: ['tenantColumn', 'poolShared'],
    own: 'the rule can fire only when the configuration names the tenant tables or makes every table but the global ones a tenant table; with tenant tables taken from the schema, a table without the column is not a tenant table',
    rule: (c) => `a table the configuration makes a tenant table whose CREATE TABLE, with the ALTER TABLE statements after it, has no ${columns(c)} column`
  },
  {
    id: 'unindexed-tenant-column',
    key: 'unindexedTenantColumn',
    title: 'a tenant column that leads no index',
    basis: ['leadingColumns', 'tenantLeadingKey'],
    own: 'only the leading column of an index, a primary key or a unique constraint counts, and the rule runs only when the input holds at least one CREATE INDEX, so a set of query files alone is not reported',
    rule: () => 'a tenant table created in the input whose tenant column is not the first column of any index, primary key or unique constraint, when the input holds a CREATE INDEX'
  },
  {
    id: 'allow-without-reason',
    key: 'allowWithoutReason',
    title: 'an allow marker that gives no reason',
    basis: ['denyByDefault', 'checkEveryRequest'],
    own: 'the form of the marker, -- tenant-scope: allow followed by a reason, is the tool\'s own; a reason that is empty or says nothing, such as TBD, allows nothing',
    rule: () => 'a comment "tenant-scope: allow" with no reason after it, or with a reason that says nothing'
  },
  {
    id: 'unused-allow',
    key: 'unusedAllow',
    title: 'an allow marker with nothing to allow',
    basis: ['denyByDefault'],
    own: 'a marker on a statement with no finding is reported, so a stale marker does not stay in place to hide a later finding',
    rule: () => 'a comment "tenant-scope: allow" with a reason on a statement that has no finding, or after the last statement of a file'
  }
];

export const ruleById = (id) => RULES.find((r) => r.id === id);

// True when a level is at or above another.
export const atOrAbove = (level, min) => LEVELS.indexOf(level) >= LEVELS.indexOf(min);

// The result: the run fails when a finding is at the level error. { pass, errors, byLevel, text }.
export function decide(findings) {
  const byLevel = { error: 0, warning: 0, notice: 0 };
  for (const f of findings) byLevel[f.level] += 1;
  const below = ['warning', 'notice'].filter((l) => byLevel[l]).map((l) => plural(byLevel[l], l));
  const text = byLevel.error ? `FAIL - ${plural(byLevel.error, 'error')}${below.length ? ` (and ${below.join(', ')})` : ''}` : `PASS - no error${below.length ? ` (${below.join(', ')})` : ''}`;
  return { pass: byLevel.error === 0, errors: byLevel.error, byLevel, text };
}
