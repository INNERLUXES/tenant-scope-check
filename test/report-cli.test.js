import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NOTICE, USAGE, VERSION, escapeData, escapeProperty, parseArgs, toGithub, toJson, toText } from '../src/index.js';
import { SCHEMA, cli, queryReport, reportOf, run, withFiles } from './helpers.js';

const GOOD = { 'db/schema.sql': SCHEMA, 'db/q.sql': 'SELECT * FROM orders WHERE tenant_id = $1;\n' };
const BAD_SQL = 'SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1;\n';
const BAD = { 'db/schema.sql': SCHEMA, 'db/q.sql': BAD_SQL };

test('cli: exit 0 with no error, 1 with an error, and a warning alone does not fail the run', async () => {
  const good = await run(GOOD, ['db']);
  assert.equal(good.code, 0, good.err);
  assert.match(good.out, /^tenant-scope-check: db\ninput: db \(2 files, 4 statements: 1 select, 3 create table\)\nconfig: built-in defaults: tenant column tenant_id; tenant tables from the schema \(CREATE TABLE with tenant_id\); files \*\*\/\*\.sql; minimum severity notice\n/);
  assert.match(good.out, /RESULT: PASS - no error\n$/);
  assert.equal(good.err, '');
  const bad = await run(BAD, ['db']);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /RESULT: FAIL - 2 errors\n$/);
  const warning = await run({ ...GOOD, 'db/q.sql': 'SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.tenant_id = $1;\n' }, ['db']);
  assert.equal(warning.code, 0);
  assert.match(warning.out, /RESULT: PASS - no error \(1 warning\)\n$/);
  const raised = await run({ ...GOOD, 'db/q.sql': 'SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.tenant_id = $1;\n', 'c.json': '{"rules": {"unscopedJoin": "error"}}' }, ['db', '--config', 'c.json']);
  assert.equal(raised.code, 1);
});

test('cli: several paths, files and folders, are read together in the order given', async () => {
  const r = await run({ 'm/schema.sql': SCHEMA, 'q/one.sql': 'SELECT 1;\n', 'extra.txt': 'SELECT * FROM orders;\n' }, ['m', 'q', 'extra.txt']);
  assert.equal(r.code, 1);
  assert.match(r.out, /^tenant-scope-check: m, q, extra\.txt\ninput: m, q, extra\.txt \(3 files,/);
  assert.match(r.out, /ERROR {4}unscoped-query {11}extra\.txt:1\n/);
});

test('cli: exit 2 for usage errors, with the usage and nothing on standard output', async () => {
  for (const [args, message] of [
    [[], /give the SQL to check: a \.sql file or a folder of them/],
    [['db', 'db'], /db is named twice/],
    [['db', '--bogus'], /unknown argument --bogus/],
    [['db', '--format', 'html'], /unknown format html \(text, json or github\)/],
    [['db', '--format', 'json', '--format', 'text'], /--format was given twice/],
    [['db', '--json', '--format', 'github'], /--json and --format github ask for two formats; give one/],
    [['db', '--min-severity', 'fatal'], /unknown level fatal/],
    [['db', '--min-severity', 'error', '--min-severity', 'error'], /--min-severity was given twice/],
    [['db', '--config'], /--config needs a value/],
    [['db', '--config', '--json'], /--config needs a value/],
    [['-'], /reading from standard input is not supported/],
    [['db', '--config', '-'], /reading from standard input is not supported/],
    [['https://example.com/q.sql'], /give a local path; the tool never fetches a URL/],
    [Array.from({ length: 101 }, (_, i) => `f${i}.sql`), /more than 100 paths/]
  ]) {
    const r = await run(GOOD, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, message);
    assert.ok(r.err.includes('Usage: tenant-scope-check'), args.join(' ').slice(0, 60));
    assert.equal(r.out, '');
  }
  assert.equal(parseArgs(['a.sql', '--json', '--format', 'json']).format, 'json');
});

test('cli: exit 2 for input errors, with every problem and no result', async () => {
  const missing = await run(GOOD, ['nowhere.sql']);
  assert.equal(missing.code, 2);
  assert.equal(missing.err, 'tenant-scope-check: no result, the input has a problem:\n  nowhere.sql: no such file\n');
  assert.equal(missing.out, '');
  assert.match((await run({ 'docs/a.md': 'x' }, ['docs'])).err, /docs: no file in this folder matches \*\*\/\*\.sql/);
  assert.match((await run({ ...GOOD, 'c.json': '{"tenantColums": ["x"]}' }, ['db', '--config', 'c.json'])).err, /c\.json: line 1: "tenantColums" is not a key of the configuration; did you mean "tenantColumns"\?/);
  assert.match((await run(GOOD, ['db', '--config', 'none.json'])).err, /none\.json: no such file/);
  assert.match((await run({ 'q.sql': Buffer.from([83, 32, 0, 1]) }, ['q.sql'])).err, /q\.sql: holds binary data \(a null byte\); only text is read/);
  const two = await run({ 'db/a.sql': "SELECT 'x;\n", 'db/b.sql': 'SELECT (1;\n' }, ['db']);
  assert.equal(two.code, 2);
  assert.equal(two.err, 'tenant-scope-check: no result, the input has problems:\n  db/a.sql: line 1, column 8: a string that is not closed\n  db/b.sql: line 1, column 8: a parenthesis that is not closed\n');
});

test('cli: --help, --version and --print-defaults exit 0 and need no input', async () => {
  const help = await run({}, ['--help']);
  assert.equal(help.code, 0);
  assert.equal(help.out, USAGE);
  for (const option of ['--config', '--format', '--json', '--min-severity', '--explain', '--print-defaults', '--help', '--version']) assert.ok(USAGE.includes(option), option);
  assert.equal((await run({}, ['--version'])).out, `${VERSION}\n`);
  const defaults = await run({}, ['--print-defaults']);
  assert.equal(defaults.code, 0);
  assert.equal(JSON.parse(defaults.out).name, 'built-in defaults');
  assert.equal((await run({ 'c.json': defaults.out, ...GOOD }, ['db', '--config', 'c.json'])).code, 0, 'the printed defaults read back as a configuration');
});

test('cli: --min-severity hides findings below it, and the command line wins over the configuration', async () => {
  const files = { ...GOOD, 'db/q.sql': `${BAD_SQL}-- tenant-scope: allow x\nSELECT 1;\n` };
  const all = await run(files, ['db']);
  assert.match(all.out, /findings: 3 \(2 error, 1 notice\)/);
  const errors = await run(files, ['db', '--min-severity', 'error']);
  assert.match(errors.out, /findings: 2 \(2 error\); 1 below error not shown/);
  assert.match(errors.out, /note: 1 finding below error is not shown/);
  assert.ok(!errors.out.includes('NOTICE '));
  const cfg = await run({ ...files, 'c.json': '{"minSeverity": "error"}' }, ['db', '--config', 'c.json', '--min-severity', 'notice']);
  assert.match(cfg.out, /findings: 3 \(2 error, 1 notice\)/);
});

test('text: the findings with their level, rule and place, the allowed ones with their reason, what was read, the notice and the result', () => {
  const r = reportOf({ 'schema.sql': SCHEMA, 'q.sql': `${BAD_SQL}-- tenant-scope: allow the export job reads every tenant\nSELECT * FROM customers;\n` });
  const out = toText(r);
  assert.match(out, /\n {2}ERROR {4}unscoped-query {11}q\.sql:1\n {11}the SELECT reads orders \(o\) with no condition on o\.tenant_id/);
  assert.match(out, /\nAllowed by a marker \(1\)\n\n {2}ALLOWED {2}unscoped-query {11}q\.sql:3\n {11}the SELECT reads customers with no condition on customers\.tenant_id, so it can return the rows of every tenant\n {11}reason \(line 2\): the export job reads every tenant\n/);
  assert.match(out, /\nRead: schema\.sql, q\.sql\n\n {2}tenant tables {2}2: customers \(tenant_id\) and orders \(tenant_id\)\n {2}global tables {2}0\n {2}queries {8}2 checked: 2 select, 0 insert, 0 update, 0 delete, 0 truncate\n {2}schema {9}3 create table, 0 alter table, 0 create index, 0 drop table; 0 other statements not checked\n {2}allow markers {2}1: 1 with a reason, 0 without, 0 with nothing to allow\n/);
  assert.ok(out.includes(`\n${NOTICE}\n\nRESULT: FAIL - 2 errors\n`));
  const explained = toText(r, { explain: true });
  assert.match(explained, /\n {11}rule: a SELECT, UPDATE, DELETE, TRUNCATE or TABLE that reads or changes a tenant table/);
  assert.match(explained, /\n {11}basis: authorization fails when one user can reach the record of another .* \(CWE-639: Authorization Bypass Through User-Controlled Key \(MITRE\), https:\/\/cwe\.mitre\.org\/data\/definitions\/639\.html\)\n/);
  assert.match(explained, /\n {11}the tool's own choice: a condition counts only when every row must pass it/);
  const listed = toText(reportOf('SELECT * FROM t;\n', { tenantTables: ['t'], globalTables: ['g'], exclude: ['x/*.sql'] }));
  assert.match(listed, /config: config\.json: tenant column tenant_id; tenant tables t; global tables g; files \*\*\/\*\.sql except x\/\*\.sql;/);
  assert.match(listed, /tenant tables {2}1: t\n/);
  assert.match(toText(reportOf('SELECT 1;\n', { tenantTables: 'all', name: 'Rules' })), /config: config\.json \(Rules\): tenant column tenant_id; every table is a tenant table but the global ones;/);
});

test('json: the whole report, with the basis of each finding only when asked', () => {
  const r = queryReport(BAD_SQL);
  const plain = JSON.parse(toJson(r));
  assert.equal(plain.tool, 'tenant-scope-check');
  assert.deepEqual(Object.keys(plain), ['tool', 'version', 'input', 'config', 'summary', 'findings', 'allowed', 'totals', 'result', 'notes', 'notice']);
  assert.deepEqual(Object.keys(plain.findings[0]), ['rule', 'level', 'file', 'line', 'column', 'at', 'found']);
  assert.equal(plain.findings[0].rule, 'unscoped-query');
  assert.deepEqual(plain.result, { pass: false, errors: 2, byLevel: { error: 2, warning: 0, notice: 0 }, text: 'FAIL - 2 errors' });
  assert.equal(plain.config.rules.length, 7);
  assert.deepEqual(plain.summary.tenantTables.map((t) => t.name), ['customers', 'orders']);
  const explained = JSON.parse(toJson(r, { explain: true }));
  assert.equal(explained.findings[0].basis[0].url, 'https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns');
  assert.match(explained.findings[0].own, /^a condition counts only when every row must pass it/);
});

test('github: one workflow command per finding at its level, with the file and line, then a summary line', () => {
  const lines = toGithub(queryReport(BAD_SQL)).trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^::error file=schema\.sql,line=\d+,title=tenant-scope-check unscoped-query::the SELECT reads orders \(o\)/);
  assert.equal(lines[2], 'tenant-scope-check: schema.sql: 2 findings, 0 allowed by a marker; RESULT: FAIL - 2 errors');
  assert.equal(toGithub(queryReport('SELECT 1;')), 'tenant-scope-check: schema.sql: 0 findings, 0 allowed by a marker; RESULT: PASS - no error\n');
  assert.match(toGithub(queryReport('-- tenant-scope: allow x\nSELECT 1;')), /^::notice file=schema\.sql,line=\d+,title=tenant-scope-check unused-allow::/);
});

test('github: the characters a workflow command gives a meaning to are escaped, so a finding cannot start another command', () => {
  assert.equal(escapeData('a%b\r\nc'), 'a%25b%0D%0Ac');
  assert.equal(escapeProperty('dir/a,b:c.sql'), 'dir/a%2Cb%3Ac.sql');
  const r = reportOf({ 'a,b:c.sql': `${SCHEMA}-- tenant-scope: allow 100% TBD\nSELECT * FROM orders;\n` }, { emptyValues: { add: ['100% tbd'] } });
  const out = toGithub(r);
  assert.match(out, /^::error file=a%2Cb%3Ac\.sql,line=\d+,title=tenant-scope-check allow-without-reason::the marker "tenant-scope: allow" gives no reason \("100%25 TBD" says nothing\)/m);
  assert.equal(out.split('\n').filter((l) => l.startsWith('::')).length, 2);
});

test('cli: a run reads its inputs and writes nothing to the folder', async () => {
  await withFiles(GOOD, async (dir) => {
    for (const args of [['--format', 'text'], ['--format', 'json'], ['--format', 'github'], ['--explain']]) assert.equal((await cli(['db', ...args], dir)).code, 0);
    assert.deepEqual(await readdir(dir), ['db']);
    assert.deepEqual((await readdir(resolve(dir, 'db'))).sort(), ['q.sql', 'schema.sql']);
  });
});
