import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_LIMITS, ConfigError, DEFAULT_FILES, DEFAULT_RULES, KEYS, RULES, defaultConfig, defaultsAsConfig, distance, globMatch, globProblem, isIncluded, isObject, kindOf, readConfig, suggestion, validateConfig } from '../src/index.js';

// The configuration file: every key with a good value and a bad one, the list forms, the errors with their lines, and
// the file patterns.

const problemsOf = (text) => {
  try {
    readConfig(text, 'c.json');
  } catch (error) {
    assert.ok(error instanceof ConfigError, error.message);
    return error.problems;
  }
  assert.fail(`not refused: ${text}`);
};

test('config: the defaults, and the defaults written as a file read back to the same configuration', () => {
  const d = defaultConfig();
  assert.deepEqual(d.tenantColumns, ['tenant_id']);
  assert.equal(d.tenantTables, 'schema');
  assert.deepEqual(d.globalTables, []);
  assert.deepEqual(d.files, DEFAULT_FILES);
  assert.equal(d.minSeverity, 'notice');
  assert.deepEqual(Object.keys(d.rules), RULES.map((r) => r.key));
  assert.deepEqual(Object.keys(DEFAULT_RULES), RULES.map((r) => r.key));
  const back = readConfig(JSON.stringify(defaultsAsConfig()), 'd.json');
  assert.deepEqual({ ...back, file: null, name: null }, d);
  assert.equal(back.name, 'built-in defaults');
});

test('config: tenant columns, tenant tables in each form, global tables and file patterns', () => {
  assert.deepEqual(readConfig('{"tenantColumns": ["Tenant_ID", "account_id"]}', 'c.json').tenantColumns, ['tenant_id', 'account_id']);
  assert.deepEqual(readConfig('{"tenantColumns": {"add": ["org_id"]}}', 'c.json').tenantColumns, ['tenant_id', 'org_id']);
  assert.equal(readConfig('{"tenantTables": "all"}', 'c.json').tenantTables, 'all');
  assert.deepEqual(readConfig('{"tenantTables": ["Orders", "lines"]}', 'c.json').tenantTables, ['orders', 'lines']);
  assert.deepEqual(readConfig('{"globalTables": ["plans"], "tenantTables": "all"}', 'c.json').globalTables, ['plans']);
  assert.deepEqual(readConfig('{"files": {"add": ["db/**/*.pgsql"]}, "exclude": ["**/seed/*.sql"]}', 'c.json').files, ['**/*.sql', 'db/**/*.pgsql']);
  assert.deepEqual(readConfig('{"emptyValues": {"add": ["Ask Dana"]}}', 'c.json').emptyValues.at(-1), 'ask dana');
  assert.equal(readConfig('{"rules": {"unscopedJoin": "error"}, "minSeverity": "warning"}', 'c.json').rules.unscopedJoin, 'error');
});

test('config: every unknown key is an error with its line and a suggestion', () => {
  const p = problemsOf('{\n  "tenantColumn": [],\n  "rules": {\n    "unscopedQuey": "off"\n  },\n  "files": {"ad": ["x"]}\n}');
  assert.deepEqual(p, [
    'c.json: line 2: "tenantColumn" is not a key of the configuration; did you mean "tenantColumns"?',
    'c.json: line 4: "unscopedQuey" is not a key of rules; did you mean "unscopedQuery"?',
    'c.json: line 6: "ad" is not a key of files (replace, add, remove); did you mean "add"?'
  ]);
  assert.match(problemsOf('{"zzzzzz": 1}')[0], /"zzzzzz" is not a key of the configuration$/, 'no suggestion when nothing is close');
});

test('config: wrong values are errors: types, levels, names, modes, patterns, repeats, and entries that are or are not on a list', () => {
  for (const [text, pattern] of [
    ['[]', /the configuration must be a JSON object, not a list/],
    ['{"name": 3}', /name must be a text of 1 to 120 characters/],
    ['{"minSeverity": "fatal"}', /minSeverity must be one of notice, warning, error/],
    ['{"rules": {"unscopedQuery": "loud"}}', /rules.unscopedQuery must be one of notice, warning, error, off, not "loud"/],
    ['{"rules": {"unscopedQuery": {"level": "off"}}}', /rules.unscopedQuery must be one of .*, not an object/],
    ['{"rules": []}', /rules must be an object, not a list/],
    ['{"tenantColumns": "tenant_id"}', /tenantColumns must be a list or an object with replace, add or remove, not a string/],
    ['{"tenantColumns": [3]}', /tenantColumns\[0\] must be a text, not a number/],
    ['{"tenantColumns": [""]}', /tenantColumns\[0\] must hold 1 to 120 characters/],
    ['{"tenantColumns": ["tenant id"]}', /tenantColumns\[0\]: "tenant id" is not a name/],
    ['{"tenantColumns": ["t.tenant_id"]}', /is not a name: .*with no schema in front/],
    ['{"tenantColumns": ["a", "A"]}', /tenantColumns names "a" twice/],
    ['{"tenantColumns": []}', /tenantColumns has no column left/],
    ['{"tenantColumns": {"add": ["tenant_id"]}}', /tenantColumns.add names "tenant_id", which is already on the list/],
    ['{"tenantColumns": {"remove": ["org_id"]}}', /tenantColumns.remove names "org_id", which is not on the list/],
    ['{"tenantTables": "some"}', /tenantTables must be "schema", "all" or a list of table names, not "some"/],
    ['{"tenantTables": "al"}', /did you mean "all"\?/],
    ['{"tenantTables": 3}', /tenantTables must be "schema", "all" or a list of table names, not a number/],
    ['{"tenantTables": []}', /tenantTables is an empty list/],
    ['{"tenantTables": {"add": ["x"]}}', /tenantTables must be "schema", "all" or a list of table names, not an object/],
    ['{"tenantTables": ["orders"], "globalTables": ["orders"]}', /"orders" is both in tenantTables and in globalTables/],
    ['{"files": []}', /files has no pattern left/],
    ['{"files": ["/abs/*.sql"]}', /files\[0\]: "\/abs\/\*\.sql" is not a file pattern/],
    ['{"exclude": ["../x.sql"]}', /exclude\[0\]: .* is not a file pattern/],
    ['{"exclude": ["a**/x.sql"]}', /is not a file pattern/],
    ['{"emptyValues": ["--"]}', /emptyValues\[0\] holds no letter or digit/],
    [`{"emptyValues": [${Array(CONFIG_LIMITS.maxEntries + 1).fill('"x"').join(',')}]}`, /holds more than 500 entries/],
    [`{"emptyValues": ["${'x'.repeat(121)}"]}`, /must hold 1 to 120 characters/]
  ]) assert.match(problemsOf(text).join('\n'), pattern, text.slice(0, 80));
});

test('config: JSON that is not valid, and a key named twice, are refused with the line and column', () => {
  assert.deepEqual(problemsOf('{"name": "a",}'), ['c.json: line 1, column 14: a comma before the closing brace; JSON has no trailing comma']);
  assert.match(problemsOf('{\n "rules": {},\n "rules": {}\n}')[0], /^c\.json: line 3, column 2: the name "rules" appears twice in one object/);
});

test('config: every problem of a file is listed at once, and __proto__ stays a key the configuration does not know', () => {
  const p = problemsOf('{"name": "", "minSeverity": 1, "__proto__": {"x": 1}}');
  assert.equal(p.length, 3);
  assert.equal({}.x, undefined);
  assert.throws(() => validateConfig('x'), /must be a JSON object, not a string/);
});

test('config: the keys of the file, and the small helpers', () => {
  assert.deepEqual(Object.keys(KEYS), ['name', 'tenantColumns', 'tenantTables', 'globalTables', 'files', 'exclude', 'emptyValues', 'rules', 'minSeverity']);
  assert.deepEqual(Object.keys(KEYS.rules), Object.keys(DEFAULT_RULES));
  assert.equal(distance('files', 'flies'), 1);
  assert.equal(distance('name', 'nmae'), 1);
  assert.equal(distance('kitten', 'sitting'), 3);
  assert.equal(distance('', 'abc'), 3);
  assert.equal(suggestion('exlude', ['files', 'exclude']), '; did you mean "exclude"?');
  assert.equal(suggestion('x'.repeat(4000), ['files']), '', 'a long name is not compared');
  assert.equal(kindOf(null), 'null');
  assert.equal(kindOf([]), 'a list');
  assert.equal(kindOf({}), 'an object');
  assert.equal(kindOf(1), 'a number');
  assert.equal(isObject([]), false);
  assert.equal(isObject({}), true);
});

test('patterns: *, ? and ** match by parts, a pattern with no slash matches the file name anywhere, and the rest is refused', () => {
  assert.equal(globMatch('**/*.sql', 'a.sql'), true);
  assert.equal(globMatch('**/*.sql', 'db/migrations/001_init.sql'), true);
  assert.equal(globMatch('**/*.sql', 'db/readme.md'), false);
  assert.equal(globMatch('db/*.sql', 'db/a.sql'), true);
  assert.equal(globMatch('db/*.sql', 'db/x/a.sql'), false);
  assert.equal(globMatch('db/**/q?.sql', 'db/x/y/q1.sql'), true);
  assert.equal(globMatch('db/**/q?.sql', 'db/q12.sql'), false);
  assert.equal(globMatch('*.sql', 'deep/down/a.sql'), true);
  assert.equal(globMatch('*seed*', 'db/seed_data.sql'), true);
  assert.equal(globMatch('a*b*c', 'aXbYbZc'), true);
  assert.equal(globMatch('a*b*c', 'aXbYbZ'), false);
  assert.equal(isIncluded('db/seed/a.sql', ['**/*.sql'], ['**/seed/*.sql']), false);
  assert.equal(isIncluded('db/a.sql', ['**/*.sql'], ['**/seed/*.sql']), true);
  for (const bad of ['', '/abs', 'a/../b', 'a//b', './a', '[ab].sql', '{a,b}.sql', '!a.sql', 'a\\b', 'a**', 'x'.repeat(201), `a${String.fromCharCode(1)}`]) assert.notEqual(globProblem(bad), null, bad);
  assert.equal(globProblem('db/**/*.sql'), null);
  assert.equal(globProblem(3), 'must hold 1 to 200 characters');
});
