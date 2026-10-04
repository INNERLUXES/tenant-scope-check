import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLEAN, EXPECTED, LEAKY, UNWANTED, run } from '../tools/example.mjs';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const saved = (name) => readFile(resolve(root, 'examples/output', name), 'utf8');

test('examples: the leaky set fails with the report that is saved in examples/output', async () => {
  const r = await run(LEAKY);
  assert.equal(r.code, 1);
  assert.equal(r.err, '');
  assert.equal(r.out, await saved('leaky.txt'));
  for (const e of EXPECTED) assert.ok(r.out.includes(e), e);
  for (const u of UNWANTED) assert.ok(!r.out.includes(u), u);
});

test('examples: the clean set passes with the report that is saved', async () => {
  const r = await run(CLEAN);
  assert.equal(r.code, 0);
  assert.equal(r.out, await saved('clean.txt'));
  assert.match(r.out, /findings: 0; 1 allowed by a marker\n/);
  assert.equal((await run(['examples/clean'])).code, 0, 'with the built-in configuration too');
});

test('examples: --explain, JSON, the GitHub commands and the defaults are the reports that are saved', async () => {
  assert.equal((await run([...LEAKY, '--explain'])).out, await saved('leaky-explain.txt'));
  assert.equal((await run([...LEAKY, '--json', '--explain'])).out, await saved('leaky.json'));
  assert.equal((await run([...LEAKY, '--format', 'github'])).out, await saved('leaky-github.txt'));
  assert.equal((await run(['--print-defaults'])).out, await saved('defaults.json'));
});

test('examples: the rules that fire on the leaky set, each on the line built for it', async () => {
  const report = JSON.parse((await run([...LEAKY, '--json'])).out);
  const byRule = {};
  for (const f of report.findings) (byRule[f.rule] ??= []).push(f.at);
  const text = async (rel) => (await readFile(resolve(root, 'examples/leaky', rel), 'utf8')).split('\n');
  // The place of the line that holds needle, at or after the first line that holds after.
  const at = async (rel, needle, after = '') => {
    const lines = await text(rel);
    const from = after ? lines.findIndex((l) => l.includes(after)) : 0;
    return `examples/leaky/${rel}:${lines.findIndex((l, i) => i >= from && l.includes(needle)) + 1}`;
  };
  assert.deepEqual(byRule, {
    'missing-tenant-column': [await at('migrations/001_schema.sql', 'CREATE TABLE attachments')],
    'unscoped-query': [
      await at('queries/customers.sql', 'FROM customers', 'FindCustomer'),
      await at('queries/customers.sql', 'FROM customers c', 'CustomerWithPlan'),
      await at('queries/invoices.sql', 'FROM invoices WHERE id'),
      await at('queries/invoices.sql', 'FROM customers WHERE email'),
      await at('queries/invoices.sql', 'UPDATE invoices'),
      await at('queries/jobs.sql', 'DELETE FROM payments')
    ],
    'insert-without-tenant': [await at('queries/customers.sql', 'INSERT INTO customers'), await at('queries/invoices.sql', 'INSERT INTO invoice_lines')],
    'allow-without-reason': [await at('queries/jobs.sql', 'allow TBD')],
    'unindexed-tenant-column': [await at('migrations/001_schema.sql', 'CREATE TABLE invoices')],
    'unscoped-join': [await at('queries/invoices.sql', 'JOIN customers c')],
    'unused-allow': [await at('queries/invoices.sql', 'allow payments')]
  });
  assert.deepEqual(report.allowed.map((f) => f.at), [await at('queries/jobs.sql', 'FROM invoices')]);
});

test('examples: the same files written with CRLF line ends give the same output', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'tenant-scope-check-crlf-'));
  try {
    await cp(resolve(root, 'examples'), resolve(dir, 'examples'), { recursive: true });
    for (const sub of ['examples/leaky/migrations', 'examples/leaky/queries', 'examples/clean/migrations', 'examples/clean/queries', 'examples']) {
      for (const f of (await readdir(resolve(dir, sub))).filter((n) => n.endsWith('.sql') || n.endsWith('.json'))) {
        const t = (await readFile(resolve(dir, sub, f), 'utf8')).split('\r\n').join('\n');
        await writeFile(resolve(dir, sub, f), t.split('\n').join('\r\n'));
      }
    }
    assert.equal((await run([...LEAKY, '--explain'], dir)).out, await saved('leaky-explain.txt'));
    assert.equal((await run(CLEAN, dir)).out, await saved('clean.txt'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
