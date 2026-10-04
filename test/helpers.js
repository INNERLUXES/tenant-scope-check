// Shared test helpers: SQL and configurations built inline, checked in memory or written into a temporary folder that
// is removed after the test. Paths are built with resolve() from forward-slash names, so the same test runs on Linux,
// macOS and Windows. The line a test expects is found with lineOf(), which counts lines the way the tool does, so a
// test never holds a line number worked out by hand for one system only. No test reads the clock, the time zone or the
// locale.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { buildReport, defaultConfig, lineStarts, main, positionOf, readConfig, readSql } from '../src/index.js';

export async function withFiles(files, fn) {
  const dir = await mkdtemp(resolve(tmpdir(), 'tenant-scope-check-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(resolve(dir, rel)), { recursive: true });
      await writeFile(resolve(dir, rel), content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function offsetOf(text, needle, n) {
  let at = -1;
  for (let i = 0; i < n; i += 1) {
    at = text.indexOf(needle, at + 1);
    if (at < 0) throw new Error(`${needle} is not in the text ${n} times`);
  }
  return at;
}

// The line (from 1) of the n-th place where needle starts in text.
export const lineOf = (text, needle, n = 1) => positionOf(lineStarts(text), offsetOf(text, needle, n)).line;

// The configuration of a configuration object, through the real reader, or the defaults.
export const configOf = (object) => (object ? readConfig(JSON.stringify(object), 'config.json') : defaultConfig());

// A small schema of a shared database: orders and customers carry tenant_id and start their primary key with it,
// plans is shared by every tenant.
export const SCHEMA = [
  'CREATE TABLE plans (id int PRIMARY KEY, name text);',
  'CREATE TABLE customers (tenant_id int NOT NULL, id int NOT NULL, email text, PRIMARY KEY (tenant_id, id));',
  'CREATE TABLE orders (tenant_id int NOT NULL, id int NOT NULL, customer_id int, plan_id int, total int, PRIMARY KEY (tenant_id, id));',
  ''
].join('\n');

// The report object of SQL checked in memory: one text (schema.sql), or an object of file name to text, with a
// configuration object or none.
export function reportOf(sql, config = null, { minSeverity = 'notice' } = {}) {
  const sources = typeof sql === 'string' ? { 'schema.sql': sql } : sql;
  const files = Object.entries(sources).map(([file, text]) => ({ file, ...readSql(text) }));
  const cfg = configOf(config);
  return buildReport({ input: { paths: Object.keys(sources), skippedLinks: 0 }, files, config: cfg, minSeverity, version: 'test' });
}

// The report of one query after the schema above.
export const queryReport = (query, config = null) => reportOf(`${SCHEMA}${query}\n`, config);

// The findings of a report, of one rule or of all.
export const findingsOf = (r, rule) => r.findings.filter((f) => !rule || f.rule === rule);

// The rule ids of the findings of a report, in order.
export const rulesOf = (r) => r.findings.map((f) => f.rule);

// The rule ids of the findings of one query after the schema above.
export const rulesOfQuery = (query, config = null) => rulesOf(queryReport(query, config));

// Writes the files and runs the command line with these arguments (paths relative to the folder).
export async function run(files, args = [], limits) {
  return withFiles(files, async (dir) => {
    let out = '';
    let err = '';
    const code = await main(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, limits, dir);
    return { code, out, err, dir };
  });
}

// Runs the command line with exactly these arguments, in a folder.
export async function cli(argv, dir) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } }, undefined, dir);
  return { code, out, err };
}
