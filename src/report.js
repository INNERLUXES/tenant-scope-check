// The reports: text for a terminal, JSON for other tools, and GitHub workflow commands that turn each finding into an
// annotation on the SQL file and line. Every text from the input (a file name, a table name, a reason) was cleaned by
// safeText before it reached the report object. The GitHub commands also escape the characters a command gives a
// meaning to, so a name in the input cannot end a command early or start another one.

import { grouped, listText, plural } from './size.js';
import { safeText } from './text.js';

const clean = (t, max = 200) => safeText(t, max);

const KIND_ORDER = ['select', 'insert', 'update', 'delete', 'truncate', 'create table', 'alter table', 'create index', 'drop table', 'other'];

function tablesText(c) {
  if (c.tenantTables === 'schema') return `tenant tables from the schema (CREATE TABLE with ${c.tenantColumns.join(' or ')})`;
  if (c.tenantTables === 'all') return 'every table is a tenant table but the global ones';
  return `tenant tables ${listText(c.tenantTables, 4)}`;
}

function configLine(r) {
  const c = r.config;
  const where = c.file ? `${c.file}${c.name ? ` (${clean(c.name, 120)})` : ''}` : 'built-in defaults';
  const globals = c.globalTables.length ? `; global tables ${listText(c.globalTables, 4)}` : '';
  return `${where}: tenant column ${c.tenantColumns.join(' or ')}; ${tablesText(c)}${globals}; files ${c.files.join(', ')}${c.exclude.length ? ` except ${c.exclude.join(', ')}` : ''}; minimum severity ${c.minSeverity}`;
}

const pathsText = (r) => r.input.paths.join(', ');

function inputLine(r) {
  const n = r.summary.counts;
  const kinds = KIND_ORDER.filter((k) => n.kinds[k]).map((k) => `${grouped(n.kinds[k])} ${k}`);
  return `${pathsText(r)} (${plural(n.files, 'file')}, ${plural(n.statements, 'statement')}${kinds.length ? `: ${kinds.join(', ')}` : ''})`;
}

const rulesLine = (r) => r.config.rules.map((x) => `${x.id} (${x.level})`).join('; ');

function findingsLine(r) {
  const b = r.totals.byLevel;
  const parts = ['error', 'warning', 'notice'].filter((l) => b[l]).map((l) => `${grouped(b[l])} ${l}`);
  const allowed = r.totals.allowed ? `; ${grouped(r.totals.allowed)} allowed by a marker` : '';
  return `${grouped(r.totals.findings)}${parts.length ? ` (${parts.join(', ')})` : ''}${allowed}${r.totals.hidden ? `; ${grouped(r.totals.hidden)} below ${r.config.minSeverity} not shown` : ''}`;
}

// The lines that say what was read.
function summaryLines(r) {
  const s = r.summary;
  const rows = [];
  const tenant = s.tenantTables.map((t) => `${t.name} (${t.columns.join(', ') || 'no tenant column'})`);
  const listedOnly = s.tenantTableNames.filter((n) => !s.tenantTables.some((t) => t.name === n));
  rows.push(['tenant tables', `${grouped(s.tenantTables.length + listedOnly.length)}${tenant.length || listedOnly.length ? `: ${listText([...tenant, ...listedOnly], 8)}` : ''}`]);
  rows.push(['global tables', `${grouped(s.globalTables.length)}${s.globalTables.length ? `: ${listText(s.globalTables, 8)}` : ''}`]);
  const n = s.counts.kinds;
  const queries = n.select + n.insert + n.update + n.delete + n.truncate;
  rows.push(['queries', `${grouped(queries)} checked: ${grouped(n.select)} select, ${grouped(n.insert)} insert, ${grouped(n.update)} update, ${grouped(n.delete)} delete, ${grouped(n.truncate)} truncate`]);
  rows.push(['schema', `${grouped(n['create table'])} create table, ${grouped(n['alter table'])} alter table, ${grouped(n['create index'])} create index, ${grouped(n['drop table'])} drop table; ${grouped(n.other)} other ${n.other === 1 ? 'statement' : 'statements'} not checked`]);
  const m = s.markers;
  rows.push(['allow markers', `${grouped(m.total)}: ${grouped(m.withReason)} with a reason, ${grouped(m.withoutReason)} without, ${grouped(m.unused)} with nothing to allow`]);
  const width = Math.max(...rows.map((x) => x[0].length));
  return rows.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`);
}

export function toText(r, { explain = false } = {}) {
  const out = [];
  out.push(`tenant-scope-check: ${pathsText(r)}`);
  out.push(`input: ${inputLine(r)}`);
  out.push(`config: ${configLine(r)}`);
  out.push(`rules: ${rulesLine(r)}`);
  out.push(`findings: ${findingsLine(r)}`);
  out.push('', `Findings (${grouped(r.findings.length)})`, '');
  if (!r.findings.length) out.push('  none', '');
  const width = Math.max(...r.config.rules.map((x) => x.id.length));
  const pad = ' '.repeat(11);
  for (const f of r.findings) {
    out.push(`  ${f.level.toUpperCase().padEnd(8)} ${f.rule.padEnd(width)}  ${f.at}`);
    out.push(`${pad}${f.found}`);
    if (explain) {
      out.push(`${pad}rule: ${r.config.rules.find((x) => x.id === f.rule).rule}`);
      for (const b of f.basis) out.push(`${pad}basis: ${b.text} (${b.source}, ${b.url})`);
      if (f.own) out.push(`${pad}the tool's own choice: ${f.own}`);
    }
    out.push('');
  }
  if (r.allowed.length) {
    out.push(`Allowed by a marker (${grouped(r.allowed.length)})`, '');
    for (const f of r.allowed) {
      out.push(`  ${'ALLOWED'.padEnd(8)} ${f.rule.padEnd(width)}  ${f.at}`);
      out.push(`${pad}${f.found}`);
      out.push(`${pad}reason (line ${f.markerLine}): ${f.reason}`);
      out.push('');
    }
  }
  out.push(`Read: ${pathsText(r)}`, '');
  out.push(...summaryLines(r), '');
  for (const n of r.notes) out.push(`note: ${n}`);
  if (r.notes.length) out.push('');
  out.push(r.notice, '');
  out.push(`RESULT: ${r.result.text}`);
  return `${out.join('\n')}\n`;
}

export function toJson(r, { explain = false } = {}) {
  const out = { ...r, findings: r.findings.map((f) => (explain ? f : { ...f, basis: undefined, own: undefined })) };
  return `${JSON.stringify(out, null, 2)}\n`;
}

// The message of a workflow command: %, CR and LF escaped.
export const escapeData = (t) => String(t).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

// A property of a workflow command: also : and , escaped.
export const escapeProperty = (t) => escapeData(t).replace(/:/g, '%3A').replace(/,/g, '%2C');

const COMMANDS = { error: 'error', warning: 'warning', notice: 'notice' };

export function toGithub(r) {
  const out = [];
  for (const f of r.findings) {
    const props = [`file=${escapeProperty(f.file)}`, `line=${f.line}`, `title=${escapeProperty(`tenant-scope-check ${f.rule}`)}`];
    out.push(`::${COMMANDS[f.level]} ${props.join(',')}::${escapeData(f.found)}`);
  }
  out.push(`tenant-scope-check: ${pathsText(r)}: ${grouped(r.totals.findings)} ${r.totals.findings === 1 ? 'finding' : 'findings'}, ${grouped(r.totals.allowed)} allowed by a marker; RESULT: ${r.result.text}`);
  return `${out.join('\n')}\n`;
}
