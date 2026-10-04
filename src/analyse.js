// The checks of a set of SQL files. First every statement of every file, in order, builds the schema (src/schema.js);
// then the tenant tables are worked out from the configuration and the schema; then every query is checked
// (src/queries.js), and the tables of the schema are checked for their tenant column and its index. Last, the allow
// markers move the findings of their statement to the allowed list, or are findings themselves.

import { ALLOW_MARKER } from './defaults.js';
import { analyseStatement } from './queries.js';
import { RULES } from './rules.js';
import { applySchema, emptySchema } from './schema.js';
import { listText, plural } from './size.js';
import { safeText } from './text.js';
import { asciiLower, isEmptyValue } from './words.js';

const KINDS = ['select', 'insert', 'update', 'delete', 'truncate', 'create table', 'alter table', 'create index', 'drop table', 'other'];

// An allow marker in a comment: { line, reason, empty }, or null when the comment is not one. The comment must start
// with "tenant-scope:" and then "allow" as a word; the rest, after a colon or a dash, is the reason.
export function markerOf(comment, emptyValues) {
  const text = comment.text.replace(/^[\s*]+/, '').replace(/[\s*]+$/, '');
  if (!asciiLower(text).startsWith(ALLOW_MARKER)) return null;
  const rest = text.slice(ALLOW_MARKER.length).trim();
  if (!asciiLower(rest).startsWith('allow') || /^allow[A-Za-z0-9_-]/i.test(rest)) return null;
  const reason = safeText(rest.slice('allow'.length).replace(/^[\s:-]+/, '').replace(/\s+/g, ' ').trim(), 300);
  return { line: comment.line, reason, empty: isEmptyValue(reason, emptyValues) };
}

// The tenant tables and their columns, from the configuration and the schema.
export function tenancyOf(schema, config) {
  const globals = new Set(config.globalTables);
  const listed = Array.isArray(config.tenantTables) ? new Set(config.tenantTables) : null;
  const columnsIn = (t) => config.tenantColumns.filter((c) => t.columns.has(c));
  const isTenant = (name) => {
    if (globals.has(name)) return false;
    if (listed) return listed.has(name);
    if (config.tenantTables === 'all') return true;
    const t = schema.tables.get(name);
    return Boolean(t) && columnsIn(t).length > 0;
  };
  // The tenant columns of a tenant table: those its schema has, or every tenant column when its columns are not known.
  const tenantColumnsOf = (name) => {
    const t = schema.tables.get(name);
    if (!t) return [...config.tenantColumns];
    const has = columnsIn(t);
    if (has.length || (t.created && !t.unknownColumns)) return has;
    return [...config.tenantColumns];
  };
  const hasDefault = (name, columns) => {
    const t = schema.tables.get(name);
    return Boolean(t) && columns.some((c) => t.columns.get(c)?.hasDefault);
  };
  return { isTenant, tenantColumnsOf, hasDefault, columnsIn, globals, listed };
}

// files: [{ file, statements, orphans }] as src/sql.js reads them. Returns { summary, findings, allowed, notes };
// findings and allowed are { rule, file, line, found, reason? } in the order of the files.
export function analyse(files, config) {
  const schema = emptySchema();
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const f of files) for (const s of f.statements) s.kind = applySchema(schema, s.items, { file: f.file, line: s.line, statement: s });
  const tenancy = tenancyOf(schema, config);
  const env = { isTenant: tenancy.isTenant, tenantColumnsOf: tenancy.tenantColumnsOf, hasDefault: tenancy.hasDefault, tenantColumns: new Set(config.tenantColumns), out: [], done: new WeakSet() };
  const off = new Set(RULES.filter((r) => config.rules[r.key] === 'off').map((r) => r.id));
  const byStatement = new Map();
  const note = (s, file, f) => {
    if (off.has(f.rule)) return;
    if (!byStatement.has(s)) byStatement.set(s, []);
    byStatement.get(s).push({ ...f, file });
  };
  const referenced = new Set();
  for (const f of files) {
    for (const s of f.statements) {
      if (s.kind === null) {
        env.out = [];
        s.kind = analyseStatement(s.items, env) ?? 'other';
        for (const finding of env.out) note(s, f.file, finding);
      }
      counts[s.kind] += 1;
    }
  }

  // The tables of the schema: a tenant table needs its tenant column, and, when the input makes indexes, an index that
  // starts with it.
  const tenantTables = [];
  for (const t of schema.tables.values()) {
    if (!tenancy.isTenant(t.name)) continue;
    const has = tenancy.columnsIn(t);
    tenantTables.push({ name: t.name, columns: has.length ? has : tenancy.tenantColumnsOf(t.name), created: t.created, file: t.file, line: t.line });
    if (!t.created) continue;
    const why = tenancy.listed ? 'listed in tenantTables' : 'every table but the global ones is a tenant table';
    if (!has.length && !t.unknownColumns) note(t.statement, t.file, { rule: 'missing-tenant-column', line: t.line, found: `${t.display} is a tenant table (${why}), but its CREATE TABLE has no ${config.tenantColumns.join(' or ')} column, so its rows belong to no tenant` });
    else if (has.length && schema.indexStatements > 0 && !has.some((c) => schema.leading.get(t.name)?.has(c))) note(t.statement, t.file, { rule: 'unindexed-tenant-column', line: t.line, found: `the tenant column ${t.display}.${has[0]} leads no index, primary key or unique constraint, so every query scoped by tenant reads the whole table` });
  }
  for (const name of tenancy.listed ?? []) if (!schema.tables.has(name)) referenced.add(name);

  // The allow markers.
  const findings = [];
  const allowed = [];
  const markers = { total: 0, withReason: 0, withoutReason: 0, unused: 0 };
  for (const f of files) {
    for (const s of f.statements) {
      const own = byStatement.get(s) ?? [];
      const found = s.comments.map((c) => markerOf(c, config.emptyValues)).filter(Boolean);
      markers.total += found.length;
      const good = found.find((m) => !m.empty);
      for (const m of found) {
        if (m.empty) {
          markers.withoutReason += 1;
          if (!off.has('allow-without-reason')) findings.push({ rule: 'allow-without-reason', file: f.file, line: m.line, found: `the marker "tenant-scope: allow" gives no reason${m.reason ? ` ("${m.reason}" says nothing)` : ''}, so it allows nothing; write why the statement may cross tenants after it` });
        } else markers.withReason += 1;
      }
      if (good) {
        for (const x of own) allowed.push({ ...x, reason: good.reason, markerLine: good.line });
        if (!own.length) {
          markers.unused += 1;
          if (!off.has('unused-allow')) findings.push({ rule: 'unused-allow', file: f.file, line: good.line, found: 'the marker "tenant-scope: allow" allows nothing: its statement has no finding, so the marker can go' });
        }
      } else findings.push(...own);
    }
    for (const c of f.orphans) {
      const m = markerOf(c, config.emptyValues);
      if (!m) continue;
      markers.total += 1;
      markers.unused += 1;
      if (m.empty) markers.withoutReason += 1;
      else markers.withReason += 1;
      if (!off.has('unused-allow')) findings.push({ rule: 'unused-allow', file: f.file, line: m.line, found: 'the marker "tenant-scope: allow" comes after the last statement of the file, so it allows nothing' });
    }
  }

  const notes = [];
  if (!tenantTables.length && !tenancy.listed && config.tenantTables !== 'all') notes.push(`no tenant table: no CREATE TABLE read has a ${config.tenantColumns.join(' or ')} column, so no query was checked against a tenant table; give the migrations too, or name the tenant tables in the configuration`);
  if (referenced.size) notes.push(`${plural(referenced.size, 'tenant table')} of the configuration ${referenced.size === 1 ? 'has' : 'have'} no CREATE TABLE in the input, so ${referenced.size === 1 ? 'its' : 'their'} columns and indexes are not checked: ${listText([...referenced], 6)}`);
  return {
    summary: {
      counts: { files: files.length, statements: Object.values(counts).reduce((a, b) => a + b, 0), kinds: counts, indexStatements: schema.indexStatements },
      tenantTables,
      tenantTableNames: tenancy.listed ? [...tenancy.listed] : tenantTables.map((t) => t.name),
      globalTables: [...tenancy.globals],
      markers
    },
    findings,
    allowed,
    notes
  };
}
