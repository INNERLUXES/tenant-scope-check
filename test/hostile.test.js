import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FILE_LIMITS, LIMITS, MAX_PROBLEMS, SqlError, readSql } from '../src/index.js';
import { SCHEMA, cli, queryReport, reportOf, rulesOf, run, withFiles } from './helpers.js';

// Hostile input: SQL built to exhaust the memory or the time, to make the tool follow a link, to rewrite the terminal,
// to start a second workflow command or to change how objects behave. Each heavy test also checks the time, because work
// that grows faster than the input is a failure even when the answer is right. Tests that need a symbolic link, a
// device or file permissions are guarded with process.platform, and none of them asserts a line: lines are asserted in
// the tests that run everywhere.

const LIMIT = { timeout: 180000 };
// Coverage counting slows every line of the tool several times over, so a run with --experimental-test-coverage gets a
// wider time limit. A plain `npm test` keeps the tight one, and that is the run that guards against slow growth.
// The runner sets NODE_V8_COVERAGE for its test processes only when coverage is on.
const COVERAGE = Boolean(process.env.NODE_V8_COVERAGE);
const fast = async (fn, ms = 5000) => {
  const limit = COVERAGE ? ms * 4 : ms;
  const start = Date.now();
  const result = await fn();
  assert.ok(Date.now() - start < limit, `took ${Date.now() - start} ms`);
  return result;
};

const GOOD = { 'q.sql': `${SCHEMA}SELECT * FROM orders WHERE tenant_id = $1;\n` };

test('hostile: a file or a configuration over its size limit is refused before it is read', LIMIT, async () => {
  const big = await fast(() => run({ 'q.sql': `SELECT '${'x'.repeat(FILE_LIMITS.maxFileBytes)}';` }, ['q.sql']));
  assert.equal(big.code, 2);
  assert.match(big.err, /q\.sql: [\d,]+ bytes is over the 2 MB limit/);
  const config = await run({ ...GOOD, 'c.json': ' '.repeat(FILE_LIMITS.maxConfigBytes + 1) }, ['q.sql', '--config', 'c.json']);
  assert.equal(config.code, 2);
  assert.match(config.err, /c\.json: [\d,]+ bytes is over the 1 MB limit/);
  const small = await run(GOOD, ['q.sql'], { maxFileBytes: 100 });
  assert.match(small.err, /over the 100 byte limit/);
  const total = await run({ 'db/a.sql': 'SELECT 1;\n'.repeat(20), 'db/b.sql': 'SELECT 1;\n'.repeat(20) }, ['db'], { maxTotalBytes: 300 });
  assert.equal(total.code, 2);
  assert.match(total.err, /db\/b\.sql: the files read so far hold more than 300 bytes, the limit of one run/);
});

test('hostile: tens of thousands of statements, and a join of hundreds of tables, are checked in seconds', LIMIT, async () => {
  const many = Array.from({ length: 20000 }, (_, i) => (i % 2 ? `SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.tenant_id = $${i};` : `UPDATE orders SET total = ${i} WHERE id = $1;`)).join('\n');
  const r = await fast(() => run({ 'q.sql': `${SCHEMA}${many}\n` }, ['q.sql', '--json']), 30000);
  const json = JSON.parse(r.out);
  assert.equal(json.summary.counts.statements, 20003);
  assert.equal(json.totals.findings, 20000);
  assert.equal(json.findings.filter((f) => f.rule === 'unscoped-query').length, LIMITS.maxFindingsPerRule, 'every rule lists at most its limit');
  assert.ok(json.notes.some((n) => /findings past the limit of 500 per rule are counted but not listed/.test(n)));
  const joins = Array.from({ length: 400 }, (_, i) => `JOIN customers c${i} ON c${i}.tenant_id = o.tenant_id AND c${i}.id = o.customer_id`).join(' ');
  assert.deepEqual(rulesOf(await fast(() => queryReport(`SELECT * FROM orders o ${joins} WHERE o.tenant_id = $1;`))), []);
  const chain = Array.from({ length: 400 }, (_, i) => `JOIN customers c${i + 1} ON c${i + 1}.id = c${i}.id`).join(' ');
  const reached = await fast(() => queryReport(`SELECT * FROM customers c0 ${chain} WHERE c0.tenant_id = $1;`));
  assert.equal(rulesOf(reached).length, 400);
  assert.ok(rulesOf(reached).every((x) => x === 'unscoped-join'));
});

test('hostile: long runs of quotes, dollars, dashes, slashes, stars, backslashes and parentheses are read in one pass', LIMIT, async () => {
  for (const text of [
    `SELECT ${"''".repeat(500000)}`,
    `SELECT E'${'\\\''.repeat(300000)}'`,
    `SELECT ${'$a'.repeat(300000)}`,
    `SELECT ${'$$'.repeat(300000)}`,
    `${'-'.repeat(1000000)}`,
    `${'/*'.repeat(300000)}`,
    `${'*/'.repeat(300000)}`,
    `SELECT ${'"'.repeat(1000001)}`,
    `SELECT ${'('.repeat(60)}${'1,'.repeat(300000)}1${')'.repeat(60)}`,
    `SELECT 1 ${'AND '.repeat(200000)}`,
    `${'; '.repeat(500000)}`,
    `SELECT * FROM orders WHERE ${'tenant_id = $1 AND '.repeat(50000)}TRUE`,
    `SELECT ${':a'.repeat(300000)}`,
    `${'x '.repeat(500000)}`
  ]) {
    await fast(() => {
      try {
        reportOf(`${SCHEMA}${text}\n`);
      } catch (error) {
        assert.ok(error instanceof SqlError, error.message);
      }
    });
  }
  await fast(() => assert.throws(() => readSql(`SELECT ${'('.repeat(500000)}`), /nested more than 64 deep/));
});

test('hostile: a set with a hundred broken files lists twenty problems and a count', LIMIT, async () => {
  const files = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`db/f${String(i).padStart(3, '0')}.sql`, "SELECT 'x"]));
  const r = await fast(() => run(files, ['db']));
  assert.equal(r.code, 2);
  assert.match(r.err, /the input has problems:/);
  assert.match(r.err, /\n {2}and 80 more\n$/);
  assert.equal(r.err.split('\n').filter((l) => l.startsWith('  db/')).length, MAX_PROBLEMS);
});

test('hostile: CRLF, CR and a byte order mark give the same report as LF', async () => {
  const text = `${SCHEMA}-- tenant-scope: allow reads all\nSELECT * FROM orders;\nSELECT * FROM customers c JOIN orders o ON o.customer_id = c.id\nWHERE c.tenant_id = $1;\n`;
  const lf = await run({ 'q.sql': text }, ['q.sql', '--json']);
  assert.equal(lf.code, 0, lf.err);
  for (const eol of ['\r\n', '\r']) {
    const r = await run({ 'q.sql': `${String.fromCharCode(0xfeff)}${text.split('\n').join(eol)}` }, ['q.sql', '--json']);
    assert.equal(r.out, lf.out, JSON.stringify(eol));
  }
});

test('hostile: control, escape and direction characters in file names, names, reasons and comments never reach the reports', async () => {
  const esc = String.fromCharCode(27);
  const rlo = String.fromCharCode(0x202e);
  const ls = String.fromCharCode(0x2028);
  const sql = `${SCHEMA}CREATE TABLE "t${esc}[31m" (tenant_id int);\n-- tenant-scope: allow x${esc}[2J${rlo}\nSELECT * FROM orders;\nSELECT * FROM "t${esc}[31m"${ls};\nINSERT INTO "t${esc}[31m" (id) VALUES (1);\n`;
  const files = { [`q${rlo}.sql`]: sql, [`bad${rlo}.sql`]: `SELECT '${esc}` };
  for (const format of ['text', 'json', 'github']) {
    const r = await run(files, [`q${rlo}.sql`, '--format', format, '--explain'].filter((a) => format !== 'github' || a !== '--explain'));
    assert.equal(r.code, 1, r.err);
    for (const c of [esc, rlo, ls]) assert.ok(!r.out.includes(c) && !r.err.includes(c), `${format}: ${c.charCodeAt(0)}`);
  }
  const bad = await run(files, [`bad${rlo}.sql`]);
  assert.equal(bad.code, 2);
  assert.ok(!bad.err.includes(esc) && !bad.err.includes(rlo));
});

test('hostile: constructor, toString and __proto__ as table, column and alias names are only data', async () => {
  const sql = 'CREATE TABLE "__proto__" (tenant_id int, "constructor" int);\nCREATE TABLE "toString" (tenant_id int);\nSELECT * FROM "__proto__" "hasOwnProperty" JOIN "toString" "valueOf" ON "valueOf".tenant_id = "hasOwnProperty".tenant_id WHERE "hasOwnProperty".tenant_id = $1;\nSELECT * FROM "toString";\n';
  const r = reportOf(sql);
  assert.deepEqual(rulesOf(r), ['unscoped-query']);
  assert.match(r.findings[0].found, /reads "toString" with no condition on toString.tenant_id/);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.equal({}.tenant_id, undefined);
  const config = await run({ ...GOOD, 'c.json': '{"__proto__": {"rules": {}}}' }, ['q.sql', '--config', 'c.json']);
  assert.equal(config.code, 2);
  assert.match(config.err, /"__proto__" is not a key of the configuration/);
});

test('hostile: an empty file, only comments, only semicolons and a folder of empty files are read without a crash', async () => {
  for (const content of ['', '-- nothing\n', ';;;\n', '/* x */']) {
    const r = await run({ 'q.sql': content }, ['q.sql']);
    assert.equal(r.code, 0, `${JSON.stringify(content)}: ${r.err}`);
    assert.match(r.out, /\(1 file, 0 statements\)/);
  }
});

test('hostile: a file named through a symbolic link is refused, and a link inside a folder is skipped, not followed', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows needs extra rights to make a symbolic link');
    return;
  }
  await withFiles({ 'db/q.sql': 'SELECT 1;\n', 'secret/s.sql': 'SELECT * FROM orders;\n' }, async (dir) => {
    await symlink(resolve(dir, 'db/q.sql'), resolve(dir, 'linked.sql'));
    await symlink(resolve(dir, 'secret'), resolve(dir, 'db/inside'));
    await symlink(resolve(dir, 'secret/s.sql'), resolve(dir, 'db/s.sql'));
    const r = await cli(['linked.sql'], dir);
    assert.equal(r.code, 2);
    assert.match(r.err, /linked\.sql: is a symbolic link, which is not followed/);
    const c = await cli(['db', '--config', 'linked.sql'], dir);
    assert.equal(c.code, 2);
    assert.match(c.err, /is a symbolic link/);
    const walk = await cli(['db'], dir);
    assert.equal(walk.code, 0, walk.err);
    assert.match(walk.out, /\(1 file, 1 statement/);
    assert.match(walk.out, /note: 2 symbolic links inside the folders were skipped, not followed/);
  });
});

test('hostile: a device named as a SQL file or the configuration is refused', LIMIT, async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows has no /dev/zero to name as an input');
    return;
  }
  await withFiles(GOOD, async (dir) => {
    const config = await fast(() => cli(['q.sql', '--config', '/dev/zero'], dir));
    assert.equal(config.code, 2);
    assert.match(config.err, /is not a regular file/);
    const input = await fast(() => cli(['/dev/zero'], dir));
    assert.equal(input.code, 2);
    assert.match(input.err, /is not a regular file/);
  });
});

test('hostile: a file or a folder that cannot be opened stops the run with its reason, and is never passed over', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows does not take away read access with chmod');
    return;
  }
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('the root user can read a file without read access');
    return;
  }
  await withFiles({ ...GOOD, 'db/a.sql': 'SELECT 1;\n', 'db/locked/b.sql': 'SELECT 1;\n' }, async (dir) => {
    await chmod(resolve(dir, 'q.sql'), 0o000);
    await chmod(resolve(dir, 'db/locked'), 0o000);
    try {
      const r = await cli(['q.sql'], dir);
      assert.equal(r.code, 2);
      assert.match(r.err, /q\.sql: cannot be read \(EACCES\)/);
      const folder = await cli(['db'], dir);
      assert.equal(folder.code, 2);
      assert.match(folder.err, /db\/locked: cannot be read \(EACCES\)/);
    } finally {
      await chmod(resolve(dir, 'q.sql'), 0o644);
      await chmod(resolve(dir, 'db/locked'), 0o755);
    }
  });
});
