// Runs the README examples, checks that they report what the README shows, and writes the reports of the two made-up
// SQL sets to examples/output. CI runs it and then fails if those files changed, so the example output in the
// repository is always the real output.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/index.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');

// The arguments of the examples; every path is relative to the root of the repository.
export const LEAKY = ['examples/leaky', '--config', 'examples/config.json'];
export const CLEAN = ['examples/clean', '--config', 'examples/config.json'];

// Runs the tool on files of the repository; the paths shown in the report are relative to the root of the repository.
export async function run(argv, base = root) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } }, undefined, base);
  return { code, out, err };
}

// What the README says of the leaky set: the counts, one finding of every rule, the allowed query and the result.
export const EXPECTED = [
  'input: examples/leaky (5 files, 20 statements: 6 select, 2 insert, 2 update, 1 delete, 7 create table, 1 alter table, 1 create index)',
  'findings: 13 (10 error, 2 warning, 1 notice); 1 allowed by a marker',
  'attachments is a tenant table (every table but the global ones is a tenant table), but its CREATE TABLE has no tenant_id column',
  'the SELECT reads invoices with no condition on invoices.tenant_id, so it can return the rows of every tenant',
  'the SELECT reads customers (c) through c.id = i.customer_id from invoices (i) only',
  'a subquery reads customers with no condition on customers.tenant_id',
  'the UPDATE changes invoices with no condition on invoices.tenant_id',
  'the INSERT into invoice_lines gives no value for tenant_id',
  'the INSERT into customers names no columns',
  'the marker "tenant-scope: allow" gives no reason ("TBD" says nothing)',
  'the DELETE deletes from payments with no condition on payments.tenant_id',
  'the tenant column invoices.tenant_id leads no index, primary key or unique constraint',
  'the marker "tenant-scope: allow" allows nothing: its statement has no finding',
  'reason (line 2): the dunning job reads the overdue invoices of every tenant, under its own database role',
  'RESULT: FAIL - 10 errors (and 2 warnings, 1 notice)'
];
export const UNWANTED = ['RESULT: PASS', 'plans with no condition', 'tenants with no condition', 'MarkPaid'];

const problems = [];
function expect(name, result, code, expected, unwanted) {
  const missing = expected.filter((e) => !result.out.includes(e));
  const wrong = unwanted.filter((e) => result.out.includes(e));
  if (result.code !== code || missing.length || wrong.length) {
    problems.push(`${name}: unexpected report (exit code ${result.code}, expected ${code}; missing: ${missing.join(' / ') || 'none'}; should not appear: ${wrong.join(' / ') || 'none'})${result.err ? `\n${result.err}` : ''}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const leaky = await run(LEAKY);
  process.stdout.write(leaky.out);
  expect('leaky set', leaky, 1, EXPECTED, UNWANTED);

  const clean = await run(CLEAN);
  expect('clean set', clean, 0, ['input: examples/clean (4 files, 20 statements:', 'findings: 0; 1 allowed by a marker', 'RESULT: PASS - no error'], ['  WARNING  ', '  ERROR  ', '  NOTICE  ', 'RESULT: FAIL']);

  // The clean set passes with the built-in configuration too. The leaky one still fails without the configuration, but
  // the table with no tenant column is then not a tenant table, so it is not reported.
  expect('clean, built-in configuration', await run(['examples/clean']), 0, ['config: built-in defaults:', 'findings: 0'], []);
  expect('leaky, built-in configuration', await run(['examples/leaky']), 1, ['config: built-in defaults:', 'findings: 12 (9 error, 2 warning, 1 notice)'], ['missing-tenant-column  ']);
  // The migrations and the queries can be named one by one.
  expect('leaky, two folders', await run(['examples/leaky/migrations', 'examples/leaky/queries', '--config', 'examples/config.json']), 1, ['tenant-scope-check: examples/leaky/migrations, examples/leaky/queries', 'findings: 13'], []);

  // Only the errors.
  expect('leaky, errors only', await run([...LEAKY, '--min-severity', 'error']), 1, ['findings: 10 (10 error); 1 allowed by a marker; 3 below error not shown'], ['WARNING', 'NOTICE']);

  // The README shows the whole report of the leaky set, the --explain lines of one finding, the GitHub annotations of
  // the first findings and the report of the clean set.
  const readme = (await readFile(resolve(root, 'README.md'), 'utf8')).split('\r\n').join('\n');
  if (!readme.includes(leaky.out)) problems.push('README: the sample output of the leaky set differs from a real run');
  if (!readme.includes(clean.out)) problems.push('README: the sample output of the clean set differs from a real run');

  await mkdir(resolve(root, 'examples/output'), { recursive: true });
  await writeFile(resolve(root, 'examples/output/leaky.txt'), leaky.out);
  await writeFile(resolve(root, 'examples/output/clean.txt'), clean.out);
  const explain = await run([...LEAKY, '--explain']);
  if (explain.code !== 1) problems.push(`explain: exit code ${explain.code}, expected 1`);
  const lines = explain.out.split('\n');
  const at = lines.findIndex((l) => l.includes('unscoped-join') && l.includes('invoices.sql:7'));
  const sample = lines.slice(at, at + 6).join('\n');
  if (at < 0 || !readme.includes(sample)) problems.push('README: the --explain sample of the join on a key differs from a real run');
  await writeFile(resolve(root, 'examples/output/leaky-explain.txt'), explain.out);
  const github = await run([...LEAKY, '--format', 'github']);
  if (github.code !== 1) problems.push(`github: exit code ${github.code}, expected 1`);
  for (const l of github.out.split('\n').filter((x) => x.includes('invoices.sql,line=2,') || x.includes('invoices.sql,line=7,'))) if (!readme.includes(l)) problems.push('README: the GitHub sample differs from a real run');
  await writeFile(resolve(root, 'examples/output/leaky-github.txt'), github.out);
  const json = await run([...LEAKY, '--json', '--explain']);
  if (json.code !== 1) problems.push(`json: exit code ${json.code}, expected 1`);
  await writeFile(resolve(root, 'examples/output/leaky.json'), json.out);
  const defaults = await run(['--print-defaults']);
  if (defaults.code !== 0) problems.push(`--print-defaults: exit code ${defaults.code}, expected 0`);
  await writeFile(resolve(root, 'examples/output/defaults.json'), defaults.out);

  if (problems.length) {
    for (const p of problems) console.error(`example: ${p}`);
    process.exit(1);
  }
}
