// The schema the SQL files describe: the tables of CREATE TABLE with their columns, what ALTER TABLE adds, drops and
// renames, what DROP TABLE removes, and the leading column of every index, primary key and unique constraint. The
// statements are read in the order of the files, so a later migration changes what an earlier one created. Tables are
// told apart by their name alone, without the schema they live in (docs/limits.md).

import { indexWhere, isGroup, isName, isOp, isWord, leadingColumn, nameOf, qualifiedName, splitCommas } from './items.js';

export function emptySchema() {
  return { tables: new Map(), leading: new Map(), indexStatements: 0 };
}

// An element of CREATE TABLE that is a constraint or a MySQL index line, not a column. A column may be named key or
// index, so those words count only when a list of columns, or a name and a list, follows.
function isConstraintElement(e) {
  if (isWord(e[0], 'constraint', 'primary', 'foreign', 'check', 'exclude')) return true;
  if (isWord(e[0], 'unique')) return isGroup(e[1]) || isWord(e[1], 'key', 'index') || (isName(e[1]) && isGroup(e[2]));
  if (isWord(e[0], 'index', 'key', 'fulltext', 'spatial')) return isGroup(e[1]) || (isName(e[1]) && isGroup(e[2])) || isWord(e[1], 'key', 'index');
  return false;
}

function tableEntry(schema, name, display, where, created) {
  let t = schema.tables.get(name);
  if (!t) {
    t = { name, display, file: where.file, line: where.line, statement: where.statement, created, columns: new Map(), unknownColumns: false };
    schema.tables.set(name, t);
  }
  return t;
}

function addLeading(schema, table, column) {
  if (!column) return;
  if (!schema.leading.has(table)) schema.leading.set(table, new Set());
  schema.leading.get(table).add(column);
}

// A table constraint or a MySQL index line inside CREATE TABLE or after ALTER TABLE ... ADD: the leading column of a
// primary key, a unique constraint or an index.
function readConstraint(schema, table, items) {
  let p = 0;
  if (isWord(items[p], 'constraint')) p += 2;
  const at = indexWhere(items, p, (it) => isGroup(it));
  const keyed = isWord(items[p], 'primary', 'unique', 'index', 'key');
  if (keyed && at < items.length) addLeading(schema, table, leadingColumn(items[at]));
}

// A column definition: its name, whether it has a DEFAULT, and a primary key or unique mark on the column itself.
function readColumn(schema, t, items) {
  let p = 0;
  if (isWord(items[p], 'if') && isWord(items[p + 1], 'not') && isWord(items[p + 2], 'exists')) p += 3;
  if (!isName(items[p])) return;
  const column = nameOf(items[p]);
  const rest = items.slice(p + 1);
  t.columns.set(column, { hasDefault: rest.some((it) => isWord(it, 'default')) || rest.some((it, k) => isWord(it, 'as') && isGroup(rest[k + 1])) });
  if (rest.some((it, k) => (isWord(it, 'primary') && isWord(rest[k + 1], 'key')) || (isWord(it, 'unique') && !isGroup(rest[k + 1])))) addLeading(schema, t.name, column);
}

function createTable(schema, items, where) {
  let p = indexWhere(items, 0, (it) => isWord(it, 'table')) + 1;
  if (isWord(items[p], 'if') && isWord(items[p + 1], 'not') && isWord(items[p + 2], 'exists')) p += 3;
  const q = qualifiedName(items, p);
  if (!q) return;
  // A table created twice keeps the later definition.
  schema.tables.delete(q.name);
  const t = tableEntry(schema, q.name, q.display, { ...where, line: q.line }, true);
  p = q.next;
  if (isWord(items[p], 'partition') && isWord(items[p + 1], 'of')) {
    const parent = qualifiedName(items, p + 2);
    const from = parent && schema.tables.get(parent.name);
    if (from) {
      for (const [k, v] of from.columns) t.columns.set(k, { ...v });
      for (const c of schema.leading.get(parent.name) ?? []) addLeading(schema, t.name, c);
    } else t.unknownColumns = true;
    p = parent ? parent.next : p + 2;
    while (p < items.length && !isGroup(items[p])) p += 1;
  }
  if (!isGroup(items[p])) {
    // CREATE TABLE ... AS SELECT and CREATE TABLE ... OF type: the columns are not written out.
    t.unknownColumns = true;
    return;
  }
  for (const element of splitCommas(items[p].items)) {
    if (!element.length) continue;
    if (isWord(element[0], 'like')) {
      const other = qualifiedName(element, 1);
      const from = other && schema.tables.get(other.name);
      if (from) for (const [k, v] of from.columns) t.columns.set(k, { ...v });
      else t.unknownColumns = true;
    } else if (isConstraintElement(element)) readConstraint(schema, t.name, element);
    else readColumn(schema, t, element);
  }
}

function alterTable(schema, items, where) {
  let p = indexWhere(items, 0, (it) => isWord(it, 'table')) + 1;
  if (isWord(items[p], 'if') && isWord(items[p + 1], 'exists')) p += 2;
  if (isWord(items[p], 'only')) p += 1;
  const q = qualifiedName(items, p);
  if (!q) return;
  let t = schema.tables.get(q.name) ?? null;
  const entry = () => {
    t ??= tableEntry(schema, q.name, q.display, { ...where, line: q.line }, false);
    return t;
  };
  p = q.next;
  if (isOp(items[p], '*')) p += 1;
  for (const action of splitCommas(items.slice(p))) {
    if (!action.length) continue;
    const [a, b] = action;
    if (isWord(a, 'add')) {
      let rest = action.slice(1);
      if (isWord(rest[0], 'column')) rest = rest.slice(1);
      if (isWord(rest[0], 'constraint', 'primary', 'unique', 'index', 'key', 'foreign', 'check', 'exclude')) readConstraint(schema, q.name, rest);
      else readColumn(schema, entry(), rest);
    } else if (isWord(a, 'drop')) {
      if (isWord(b, 'constraint', 'primary', 'index', 'key', 'foreign', 'check')) continue;
      let k = isWord(b, 'column') ? 2 : 1;
      if (isWord(action[k], 'if') && isWord(action[k + 1], 'exists')) k += 2;
      if (isName(action[k])) {
        const column = nameOf(action[k]);
        entry().columns.delete(column);
        schema.leading.get(q.name)?.delete(column);
      }
    } else if (isWord(a, 'rename')) {
      const to = action.findIndex((it) => isWord(it, 'to'));
      if (to < 0 || !isName(action[to + 1])) continue;
      if (to === 1 || (isWord(b, 'to'))) {
        // RENAME TO: the table takes a new name, with its columns and indexes.
        const next = qualifiedName(action, to + 1);
        if (!next) continue;
        const moved = entry();
        schema.tables.delete(q.name);
        moved.name = next.name;
        moved.display = next.display;
        schema.tables.set(next.name, moved);
        if (schema.leading.has(q.name)) {
          schema.leading.set(next.name, schema.leading.get(q.name));
          schema.leading.delete(q.name);
        }
        t = moved;
      } else {
        const from = action[to - 1];
        if (!isName(from) || isWord(from, 'constraint')) continue;
        const old = nameOf(from);
        const now = nameOf(action[to + 1]);
        const e = entry();
        if (e.columns.has(old)) {
          e.columns.set(now, e.columns.get(old));
          e.columns.delete(old);
        }
        const lead = schema.leading.get(q.name);
        if (lead?.has(old)) {
          lead.delete(old);
          lead.add(now);
        }
      }
    } else if (isWord(a, 'alter')) {
      const k = isWord(b, 'column') ? 2 : 1;
      if (!isName(action[k])) continue;
      const column = nameOf(action[k]);
      const e = entry();
      const has = e.columns.get(column);
      if (!has) continue;
      if (isWord(action[k + 1], 'set') && isWord(action[k + 2], 'default')) has.hasDefault = true;
      if (isWord(action[k + 1], 'drop') && isWord(action[k + 2], 'default')) has.hasDefault = false;
    }
  }
}

function createIndex(schema, items) {
  schema.indexStatements += 1;
  const on = indexWhere(items, 0, (it) => isWord(it, 'on'));
  let p = on + 1;
  if (isWord(items[p], 'only')) p += 1;
  const q = qualifiedName(items, p);
  if (!q) return;
  const g = indexWhere(items, q.next, (it) => isGroup(it));
  if (g < items.length) addLeading(schema, q.name, leadingColumn(items[g]));
}

function dropTable(schema, items) {
  let p = indexWhere(items, 0, (it) => isWord(it, 'table')) + 1;
  if (isWord(items[p], 'if') && isWord(items[p + 1], 'exists')) p += 2;
  for (const part of splitCommas(items.slice(p))) {
    const q = qualifiedName(part, 0);
    if (!q) continue;
    schema.tables.delete(q.name);
    schema.leading.delete(q.name);
  }
}

// What kind of schema statement the items are: create table, alter table, create index, drop table, or null.
export function schemaKind(items) {
  if (isWord(items[0], 'create')) {
    let p = 1;
    if (isWord(items[p], 'or') && isWord(items[p + 1], 'replace')) p += 2;
    while (isWord(items[p], 'global', 'local', 'temp', 'temporary', 'unlogged')) p += 1;
    if (isWord(items[p], 'table')) return 'create table';
    if (isWord(items[p], 'unique')) p += 1;
    if (isWord(items[p], 'index')) return 'create index';
    return null;
  }
  if (isWord(items[0], 'alter') && isWord(items[1], 'table')) return 'alter table';
  if (isWord(items[0], 'drop') && isWord(items[1], 'table')) return 'drop table';
  return null;
}

// Applies one statement to the schema; returns its kind, or null when it is not a schema statement. where is
// { file, line, statement }.
export function applySchema(schema, items, where) {
  const kind = schemaKind(items);
  if (kind === 'create table') createTable(schema, items, where);
  else if (kind === 'alter table') {
    alterTable(schema, items, where);
    // ALTER TABLE ... ADD INDEX, as MySQL writes it, counts as a statement that makes an index.
    if (items.some((it, k) => isWord(it, 'add') && isWord(items[k + 1], 'index', 'key', 'unique', 'primary'))) schema.indexStatements += 1;
  } else if (kind === 'create index') createIndex(schema, items);
  else if (kind === 'drop table') dropTable(schema, items);
  return kind;
}
