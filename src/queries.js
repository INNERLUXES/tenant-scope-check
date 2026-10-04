// The checks of the queries: SELECT, INSERT, UPDATE, DELETE, TRUNCATE and TABLE, with their CTEs, subqueries, joins
// and set operations. A query is read block by block (one SELECT, or the target and the FROM list of an UPDATE or a
// DELETE). In each block the tool lists the table references and reads the conditions of WHERE and of each JOIN that
// every row must pass: the parts joined by AND at the top, and the parts of a group joined by AND. A part under OR, or
// under NOT, filters no row for sure, so it is not read. From those conditions it works out, for each tenant table:
//
//   scoped    its tenant column is compared to a value (a parameter, a literal, a function call, a subquery or a
//             column of an outer query), or tied by equality to the tenant column of a scoped table;
//   reached   it is not scoped, but every row of it is reached through an equality with a scoped tenant table (a key
//             such as c.id = o.customer_id);
//   neither   nothing in the block limits it to one tenant.
//
// A condition in the ON of an outer join limits only the side the join does not keep whole, so it scopes or reaches
// only that side. "Neither" is unscoped-query and "reached" is unscoped-join. docs/method.md says the same with
// examples, and docs/limits.md what this reading cannot see.

import { indexWhere, isGroup, isName, isOp, isWord, nameOf, qualifiedName, splitAt, splitCommas } from './items.js';
import { listText } from './size.js';
import { itemsText } from './sql.js';

const CLAUSE_END = ['where', 'group', 'having', 'window', 'order', 'limit', 'offset', 'fetch', 'for', 'returning', 'union', 'intersect', 'except', 'into'];
const WHERE_END = ['group', 'having', 'window', 'order', 'limit', 'offset', 'fetch', 'for', 'returning', 'union', 'intersect', 'except'];
const NOT_ALIAS = new Set(['where', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'on', 'using', 'group', 'order', 'limit', 'offset', 'fetch', 'for', 'union', 'intersect', 'except', 'window', 'having', 'set', 'returning', 'straight_join', 'tablesample', 'values', 'select', 'lateral', 'as', 'with', 'use', 'force', 'ignore', 'into', 'from', 'outer']);
const QUERY_WORDS = ['select', 'with', 'values', 'table'];

// True when a group holds a query: (SELECT ...), (WITH ...), (VALUES ...), (TABLE t), or such a group in parentheses.
export function isQueryGroup(g) {
  if (!isGroup(g)) return false;
  const first = g.items[0];
  return isWord(first, ...QUERY_WORDS) || (isGroup(first) && isQueryGroup(first));
}

// The parts of a condition that every row must pass: the parts joined by AND at the top, with a group that holds only
// such parts opened up. A part with OR at its top, or that starts with NOT, is left out. BETWEEN x AND y stays one part.
export function conjuncts(items, out = []) {
  const parts = [[]];
  let between = false;
  for (const it of items) {
    if (isWord(it, 'between')) between = true;
    if (isWord(it, 'and')) {
      if (between) between = false;
      else {
        parts.push([]);
        continue;
      }
    }
    parts.at(-1).push(it);
  }
  for (const part of parts) {
    if (!part.length || part.some((it) => isWord(it, 'or')) || isWord(part[0], 'not')) continue;
    if (part.length === 1 && isGroup(part[0]) && !isQueryGroup(part[0])) conjuncts(part[0].items, out);
    else out.push(part);
  }
  return out;
}

// A side of a comparison without its casts (x::uuid, x::varchar(36)) and without parentheses around it.
function stripped(items) {
  let t = items;
  for (;;) {
    const cast = t.findIndex((it) => isOp(it, '::'));
    if (cast > 0) {
      t = t.slice(0, cast);
      continue;
    }
    if (t.length === 1 && isGroup(t[0]) && !isQueryGroup(t[0])) {
      t = t[0].items;
      continue;
    }
    return t;
  }
}

function findRef(scope, qual) {
  for (let s = scope, local = true; s; s = s.parent, local = false) {
    const ref = s.refs.find((r) => r.alias === qual) ?? s.refs.find((r) => r.kind === 'table' && r.name === qual && r.alias === r.name);
    if (ref) return { ref, local };
  }
  return null;
}

const keyOf = (ref, column) => `${ref.index}:${column}`;

// What one side of a comparison is: a column of a table of this block ({ node, ref, column }), a value ({ value }), or
// null when it says nothing for sure (NULL, a name that could belong to two tables).
function sideOf(items, scope, env) {
  const t = stripped(items);
  if (!t.length) return null;
  if (t.length === 1 && isWord(t[0], 'null')) return null;
  const isColumn = (t.length === 1 || t.length === 3 || t.length === 5) && t.every((it, k) => (k % 2 === 0 ? isName(it) : isOp(it, '.')));
  if (!isColumn) return { value: true };
  const column = nameOf(t.at(-1));
  if (t.length > 1) {
    const found = findRef(scope, nameOf(t.at(-3)));
    if (found && found.local) return { node: keyOf(found.ref, column), ref: found.ref, column };
    return { value: true };
  }
  if (env.tenantColumns.has(column)) {
    const holders = scope.refs.filter((r) => r.tenant && r.columns.includes(column));
    if (holders.length === 1) return { node: keyOf(holders[0], column), ref: holders[0], column };
    if (holders.length > 1) return null;
  }
  if (scope.refs.length === 1) return { node: keyOf(scope.refs[0], column), ref: scope.refs[0], column };
  return { value: true };
}

// A comparison that can scope or tie a table: a = b, a == b, or a IN (...). { left, right } or null.
function comparisonOf(part, scope, env) {
  const eq = part.findIndex((it) => isOp(it, '=', '=='));
  if (eq > 0) return { left: sideOf(part.slice(0, eq), scope, env), right: sideOf(part.slice(eq + 1), scope, env) };
  const at = part.findIndex((it) => isWord(it, 'in'));
  if (at > 0 && !isWord(part[at - 1], 'not') && isGroup(part[at + 1]) && at + 2 === part.length) return { left: sideOf(part.slice(0, at), scope, env), right: { value: true } };
  return null;
}

// Runs the query checks on every subquery inside the items, with the scope as the outer query.
export function scanSubqueries(items, env, scope) {
  for (const it of items) {
    if (!isGroup(it) || env.done.has(it)) continue;
    if (isQueryGroup(it)) {
      env.done.add(it);
      analyseQuery(it.items, env, scope, 'a subquery');
    } else scanSubqueries(it.items, env, scope);
  }
}

function isJoinStart(list, i) {
  const it = list[i];
  if (isWord(it, 'join', 'straight_join', 'inner', 'cross', 'natural')) return true;
  return isWord(it, 'left', 'right', 'full') && isWord(list[i + 1], 'join', 'outer');
}

function lookupCte(scope, name) {
  for (let s = scope; s; s = s.parent) if (s.ctes?.has(name)) return s.ctes.get(name);
  return null;
}

// One element of a FROM list at p: a table, a CTE, a subquery or a table function, with its alias. { ref, next }, or
// { nested, next } for a join written in parentheses, or null.
function readElement(list, p, env, scope) {
  let q = p;
  while (isWord(list[q], 'lateral', 'only')) q += 1;
  let ref;
  if (isGroup(list[q])) {
    const g = list[q];
    if (!isQueryGroup(g)) {
      readFromList(g.items, env, scope);
      return { nested: true, next: q + 1 };
    }
    env.done.add(g);
    const r = analyseQuery(g.items, env, scope, 'a subquery in FROM');
    ref = { kind: 'derived', name: null, display: 'a subquery', line: g.line, seed: r.tenantRefs > 0 && r.unscoped === 0 };
    q += 1;
  } else if (isName(list[q])) {
    const qn = qualifiedName(list, q);
    q = qn.next;
    if (isGroup(list[q])) {
      scanSubqueries([list[q]], env, scope);
      ref = { kind: 'function', name: qn.name, display: qn.display, line: qn.line, seed: false };
      q += 1;
    } else {
      if (isOp(list[q], '*')) q += 1;
      const cte = qn.parts.length === 1 ? lookupCte(scope, qn.name) : null;
      if (cte) ref = { kind: 'cte', name: qn.name, display: qn.display, line: qn.line, seed: cte.scoped };
      else {
        const tenant = env.isTenant(qn.name);
        ref = { kind: 'table', name: qn.name, display: qn.display, line: qn.line, seed: false, tenant, columns: tenant ? env.tenantColumnsOf(qn.name) : [] };
      }
    }
  } else return null;
  if (isWord(list[q], 'with') && isWord(list[q + 1], 'ordinality')) q += 2;
  if (isWord(list[q], 'as')) q += 1;
  let alias = ref.name;
  if (isName(list[q]) && !(list[q].type === 'word' && NOT_ALIAS.has(list[q].lower))) {
    alias = nameOf(list[q]);
    q += 1;
    if (isGroup(list[q])) q += 1;
  }
  if (isWord(list[q], 'tablesample')) {
    q += 3;
    if (isWord(list[q], 'repeatable')) q += 2;
  }
  while (isWord(list[q], 'use', 'force', 'ignore') && isWord(list[q + 1], 'index', 'key')) {
    q += 2;
    if (isWord(list[q], 'for')) q += isWord(list[q + 1], 'order', 'group') ? 3 : 2;
    if (isGroup(list[q])) q += 1;
  }
  ref.alias = alias;
  ref.tenant ??= false;
  ref.columns ??= [];
  ref.index = scope.refs.length;
  scope.refs.push(ref);
  return { ref, next: q };
}

// The FROM list of a block: every table reference with how it is joined (from for a comma, inner, left, right, full,
// cross), and its ON condition or USING list.
export function readFromList(list, env, scope) {
  let p = 0;
  let joinType = 'from';
  let natural = false;
  while (p < list.length) {
    if (isOp(list[p], ',')) {
      joinType = 'from';
      p += 1;
      continue;
    }
    if (isJoinStart(list, p)) {
      if (isWord(list[p], 'natural')) {
        natural = true;
        p += 1;
        continue;
      }
      joinType = isWord(list[p], 'left', 'right', 'full', 'cross') ? list[p].lower : 'inner';
      while (p < list.length && !isWord(list[p], 'join', 'straight_join')) p += 1;
      p += 1;
      continue;
    }
    const element = readElement(list, p, env, scope);
    if (!element) {
      p += 1;
      continue;
    }
    p = element.next;
    if (!element.ref) continue;
    const ref = element.ref;
    ref.joinType = joinType;
    ref.natural = natural;
    natural = false;
    if (isWord(list[p], 'on')) {
      const end = indexWhere(list, p + 1, (it, i) => isOp(it, ',') || isJoinStart(list, i));
      ref.on = list.slice(p + 1, end);
      p = end;
    } else if (isWord(list[p], 'using') && isGroup(list[p + 1])) {
      ref.using = splitCommas(list[p + 1].items).filter((e) => isName(e[0])).map((e) => nameOf(e[0]));
      p += 2;
    }
  }
}

const label = (r) => (r.alias && r.alias !== r.name ? `${r.display} (${r.alias})` : r.display);
const columnsOf = (r) => listText(r.columns.map((c) => `${r.alias ?? r.name}.${c}`), 4).replace(/ and /, ' or ');

// The checks of one block once its FROM list is read: which tenant tables are scoped, which are reached through a
// scoped one, and the findings for the rest. opts: { context, role, targets, currentOf }. Returns the counts used to
// tell whether a CTE or a subquery in FROM is itself limited to one tenant.
function checkBlock(scope, whereItems, env, opts) {
  const refs = scope.refs;
  const edges = new Map();
  const seeds = new Set();
  const links = new Map();
  const nodes = new Map();
  const addEdge = (a, b) => {
    if (!edges.has(a.node)) edges.set(a.node, new Set());
    edges.get(a.node).add(b.node);
  };
  const addLink = (from, to, text) => {
    if (!links.has(from.index)) links.set(from.index, []);
    links.get(from.index).push({ to, text });
  };
  // A tie of two columns: both ways in WHERE and an inner join, from the kept side to the other in an outer join.
  const tie = (a, b, ctx, text) => {
    nodes.set(a.node, a.ref);
    nodes.set(b.node, b.ref);
    const both = () => {
      addEdge(a, b);
      addEdge(b, a);
      addLink(a.ref, b.ref, text);
      addLink(b.ref, a.ref, text);
    };
    const into = (from, to) => {
      addEdge(from, to);
      addLink(from.ref, to.ref, text);
    };
    if (ctx.type === 'inner') both();
    else if (ctx.type === 'left') {
      if (b.ref === ctx.joined && a.ref !== ctx.joined) into(a, b);
      else if (a.ref === ctx.joined && b.ref !== ctx.joined) into(b, a);
    } else if (ctx.type === 'right') {
      if (a.ref === ctx.joined && b.ref !== ctx.joined) into(a, b);
      else if (b.ref === ctx.joined && a.ref !== ctx.joined) into(b, a);
    }
  };
  const filter = (a, ctx) => {
    nodes.set(a.node, a.ref);
    if (ctx.type === 'inner' || (ctx.type === 'left' && a.ref === ctx.joined) || (ctx.type === 'right' && a.ref !== ctx.joined)) seeds.add(a.node);
  };
  const read = (items, ctx) => {
    for (const part of conjuncts(items)) {
      const c = comparisonOf(part, scope, env);
      if (!c || !c.left || !c.right) continue;
      const text = itemsText(part);
      if (c.left.node && c.right.node && c.left.ref !== c.right.ref) tie(c.left, c.right, ctx, text);
      else if (c.left.node && c.right.value) filter(c.left, ctx);
      else if (c.right.node && c.left.value) filter(c.right, ctx);
    }
  };
  const ctxOf = (r) => (['left', 'right', 'full'].includes(r.joinType) ? { type: r.joinType, joined: r } : { type: 'inner' });
  read(whereItems, { type: 'inner' });
  for (const r of refs) {
    if (r.on) read(r.on, ctxOf(r));
    const shared = r.natural ? [...new Set(refs.slice(0, r.index).flatMap((x) => x.columns))].filter((c) => r.columns.includes(c)) : r.using ?? [];
    for (const column of shared) {
      const before = refs.slice(0, r.index);
      const holders = before.filter((x) => x.tenant && x.columns.includes(column));
      for (const x of holders.length ? holders : before.slice(-1)) tie({ node: keyOf(x, column), ref: x }, { node: keyOf(r, column), ref: r }, ctxOf(r), `USING (${column})`);
    }
    if (r.natural && !shared.length && r.index > 0) tie({ node: keyOf(refs[r.index - 1], '*'), ref: refs[r.index - 1] }, { node: keyOf(r, '*'), ref: r }, ctxOf(r), 'NATURAL JOIN');
  }
  for (const r of refs) if (r.on) scanSubqueries(r.on, env, scope);
  scanSubqueries(whereItems, env, scope);

  // The columns of a CTE or a subquery in FROM that is itself limited to one tenant count as scoped, and so does the
  // target of WHERE CURRENT OF, which the cursor limits.
  for (const [node, ref] of nodes) if (ref.seed) seeds.add(node);
  if (opts.currentOf) for (const r of opts.targets) for (const c of r.columns) seeds.add(keyOf(r, c));
  const visited = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const k = queue.pop();
    for (const next of edges.get(k) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  const scoped = (r) => r.columns.some((c) => visited.has(keyOf(r, c)));

  // Reached: from a scoped tenant table, or a CTE or subquery limited to one tenant, through equalities; a global table
  // passes nothing on, because its rows belong to every tenant.
  const via = new Map();
  const start = refs.filter((r) => (r.tenant && scoped(r)) || r.seed);
  const reachQueue = [...start];
  const reached = new Set(start);
  while (reachQueue.length) {
    const r = reachQueue.shift();
    if (!(r.tenant || r.seed)) continue;
    for (const { to, text } of links.get(r.index) ?? []) {
      if (reached.has(to)) continue;
      reached.add(to);
      via.set(to, { from: r, text });
      reachQueue.push(to);
    }
  }

  let unscoped = 0;
  const tenantRefs = refs.filter((r) => r.tenant);
  for (const r of tenantRefs) {
    if (scoped(r)) continue;
    const target = opts.targets?.has(r);
    const verb = !target ? 'reads' : opts.role === 'update' ? 'changes' : 'deletes from';
    const outcome = !target ? 'return the rows of every tenant' : opts.role === 'update' ? 'change the rows of every tenant' : 'delete the rows of every tenant';
    if (!r.columns.length) {
      unscoped += 1;
      env.out.push({ rule: 'unscoped-query', line: r.line, found: `${opts.context} ${verb} ${label(r)}, a tenant table with no tenant column, so no condition can limit it to one tenant` });
    } else if (reached.has(r)) {
      const v = via.get(r);
      env.out.push({ rule: 'unscoped-join', line: r.line, found: `${opts.context} ${verb} ${label(r)} through ${v.text} from ${label(v.from)} only: no condition ties ${columnsOf(r)} to the tenant of ${label(v.from)} or compares it to a value, so a key that points into another tenant brings that tenant's rows in` });
    } else {
      unscoped += 1;
      env.out.push({ rule: 'unscoped-query', line: r.line, found: `${opts.context} ${verb} ${label(r)} with no condition on ${columnsOf(r)}, so it can ${outcome}` });
    }
  }
  return { tenantRefs: tenantRefs.length, unscoped };
}

// One SELECT block, with no set operation at its top.
function analyseSelect(items, env, parent, context) {
  const scope = { refs: [], parent, ctes: null };
  const fromAt = indexWhere(items, 0, (it, i) => isWord(it, 'from') && !(isWord(items[i - 1], 'distinct') && isWord(items[i - 2], 'is', 'not')));
  if (fromAt >= items.length) {
    scanSubqueries(items, env, scope);
    return { tenantRefs: 0, unscoped: 0 };
  }
  // FOR, ORDER and GROUP inside a MySQL index hint (USE INDEX FOR ORDER BY (...)) do not end the FROM list.
  const hint = (i) => (isWord(items[i], 'for') && isWord(items[i - 1], 'index', 'key')) || (isWord(items[i], 'order', 'group') && isWord(items[i - 1], 'for') && isWord(items[i - 2], 'index', 'key'));
  const fromEnd = indexWhere(items, fromAt + 1, (it, i) => isWord(it, ...CLAUSE_END) && !hint(i));
  const whereAt = isWord(items[fromEnd], 'where') ? fromEnd : -1;
  const whereEnd = whereAt >= 0 ? indexWhere(items, whereAt + 1, (it) => isWord(it, ...WHERE_END)) : fromEnd;
  readFromList(items.slice(fromAt + 1, fromEnd), env, scope);
  scanSubqueries(items.slice(0, fromAt), env, scope);
  scanSubqueries(items.slice(whereEnd), env, scope);
  return checkBlock(scope, whereAt >= 0 ? items.slice(whereAt + 1, whereEnd) : [], env, { context, role: 'read' });
}

// A query with set operations: each part on its own.
function analyseSetOps(items, env, scope, context) {
  const total = { tenantRefs: 0, unscoped: 0 };
  for (let part of splitAt(items, (it) => isWord(it, 'union', 'intersect', 'except'))) {
    if (isWord(part[0], 'all', 'distinct')) part = part.slice(1);
    let r;
    if (isGroup(part[0]) && isQueryGroup(part[0])) {
      env.done.add(part[0]);
      r = analyseQuery(part[0].items, env, scope, context);
      scanSubqueries(part.slice(1), env, scope);
    } else if (isWord(part[0], 'table')) r = analyseTable(part, env, context);
    else if (isWord(part[0], 'select')) r = analyseSelect(part, env, scope, context);
    else {
      scanSubqueries(part, env, scope);
      r = { tenantRefs: 0, unscoped: 0 };
    }
    total.tenantRefs += r.tenantRefs;
    total.unscoped += r.unscoped;
  }
  return total;
}

// TABLE t, which reads every row of t.
function analyseTable(items, env, context) {
  const qn = qualifiedName(items, isWord(items[1], 'only') ? 2 : 1);
  if (!qn || !env.isTenant(qn.name)) return { tenantRefs: 0, unscoped: 0 };
  env.out.push({ rule: 'unscoped-query', line: qn.line, found: `${context} reads every row of ${qn.display} (TABLE ${qn.display}), so it returns the rows of every tenant` });
  return { tenantRefs: 1, unscoped: 1 };
}

function analyseUpdate(items, env, parent, context) {
  const scope = { refs: [], parent, ctes: null };
  const setAt = indexWhere(items, 1, (it) => isWord(it, 'set'));
  readFromList(items.slice(isWord(items[1], 'only') ? 2 : 1, setAt), env, scope);
  const targets = new Set(scope.refs.slice(0, 1));
  const fromAt = indexWhere(items, setAt + 1, (it) => isWord(it, 'from'));
  const whereAt = indexWhere(items, setAt + 1, (it) => isWord(it, 'where'));
  const endAt = indexWhere(items, setAt + 1, (it) => isWord(it, 'returning', 'order', 'limit'));
  if (fromAt < Math.min(whereAt, endAt)) readFromList(items.slice(fromAt + 1, Math.min(whereAt, endAt)), env, scope);
  scanSubqueries(items.slice(setAt + 1, Math.min(fromAt, whereAt, endAt)), env, scope);
  scanSubqueries(items.slice(endAt), env, scope);
  const where = whereAt < items.length ? items.slice(whereAt + 1, endAt) : [];
  const currentOf = where.some((it, k) => isWord(it, 'current') && isWord(where[k + 1], 'of'));
  return checkBlock(scope, where, env, { context, role: 'update', targets, currentOf });
}

function analyseDelete(items, env, parent, context) {
  const scope = { refs: [], parent, ctes: null };
  const fromAt = indexWhere(items, 1, (it) => isWord(it, 'from'));
  // DELETE a FROM a JOIN b ..., as MySQL writes it, names the tables it deletes from before FROM.
  const named = splitCommas(items.slice(1, fromAt)).filter((e) => isName(e[0])).map((e) => nameOf(e.at(-1).type === 'op' ? e[0] : e.at(-1)));
  const listEnd = indexWhere(items, fromAt + 1, (it) => isWord(it, 'using', 'where', 'returning', 'order', 'limit'));
  readFromList(items.slice(fromAt + 1, listEnd), env, scope);
  const targets = new Set(named.length ? scope.refs.filter((r) => named.includes(r.alias) || named.includes(r.name)) : scope.refs.slice(0, 1));
  let p = listEnd;
  if (isWord(items[p], 'using')) {
    const end = indexWhere(items, p + 1, (it) => isWord(it, 'where', 'returning'));
    readFromList(items.slice(p + 1, end), env, scope);
    p = end;
  }
  const whereEnd = indexWhere(items, p + 1, (it) => isWord(it, 'returning', 'order', 'limit'));
  const where = isWord(items[p], 'where') ? items.slice(p + 1, whereEnd) : [];
  scanSubqueries(items.slice(whereEnd), env, scope);
  const currentOf = where.some((it, k) => isWord(it, 'current') && isWord(where[k + 1], 'of'));
  return checkBlock(scope, where, env, { context, role: 'delete', targets, currentOf });
}

function analyseTruncate(items, env) {
  let p = 1;
  if (isWord(items[p], 'table')) p += 1;
  const parts = splitCommas(items.slice(p));
  let count = 0;
  for (const part of parts) {
    const qn = qualifiedName(part, isWord(part[0], 'only') ? 1 : 0);
    if (!qn || !env.isTenant(qn.name)) continue;
    count += 1;
    env.out.push({ rule: 'unscoped-query', line: qn.line, found: `TRUNCATE empties ${qn.display}, which removes the rows of every tenant` });
  }
  return { tenantRefs: count, unscoped: count };
}

function analyseInsert(items, env, scope, context) {
  const into = indexWhere(items, 0, (it) => isWord(it, 'into'));
  const qn = qualifiedName(items, into + 1);
  if (!qn) {
    scanSubqueries(items, env, scope);
    return { tenantRefs: 0, unscoped: 0 };
  }
  let p = qn.next;
  if (isWord(items[p], 'as') && isName(items[p + 1])) p += 2;
  let columns = null;
  if (isGroup(items[p]) && !isQueryGroup(items[p])) {
    columns = splitCommas(items[p].items).filter((e) => isName(e[0])).map((e) => nameOf(e.at(-1)));
    p += 1;
  }
  if (isWord(items[p], 'overriding')) p += 3;
  const mysqlSet = isWord(items[p], 'set');
  if (mysqlSet) columns = splitCommas(items.slice(p + 1, indexWhere(items, p + 1, (it) => isWord(it, 'on', 'returning')))).filter((e) => isName(e[0])).map((e) => nameOf(e[0]));
  const defaultValues = isWord(items[p], 'default') && isWord(items[p + 1], 'values');
  const cte = qn.parts.length === 1 && lookupCte(scope, qn.name);
  let found = 0;
  if (!cte && env.isTenant(qn.name)) {
    const tenant = env.tenantColumnsOf(qn.name);
    const names = listText(tenant, 4).replace(/ and /, ' or ');
    if (columns === null && !defaultValues) {
      env.out.push({ rule: 'insert-without-tenant', line: qn.line, found: `the INSERT into ${qn.display} names no columns, so the tool cannot see that it sets ${names || 'a tenant column'}; name the columns` });
      found = 1;
    } else if (!tenant.length || !tenant.some((c) => columns?.includes(c))) {
      if (!env.hasDefault(qn.name, tenant)) {
        env.out.push({ rule: 'insert-without-tenant', line: qn.line, found: `the INSERT into ${qn.display} gives no value for ${names || 'a tenant column, which the table does not have'}, so the new row belongs to no tenant` });
        found = 1;
      }
    }
  }
  const end = indexWhere(items, p, (it) => isWord(it, 'on', 'returning'));
  const body = items.slice(p, end);
  if (isWord(body[0], 'select', 'with', 'table') || isQueryGroup(body[0])) analyseSetOps(body, env, scope, `the SELECT of the INSERT into ${qn.display}`);
  else scanSubqueries(body, env, scope);
  scanSubqueries(items.slice(end), env, scope);
  return { tenantRefs: found, unscoped: found };
}

// The CTEs of a WITH at p: each body is checked, and its name is kept with whether it is limited to one tenant. The
// index of the main statement is returned.
function readWith(items, p, env, scope) {
  let q = p;
  if (isWord(items[q], 'recursive')) q += 1;
  for (;;) {
    if (!isName(items[q])) return q;
    const name = nameOf(items[q]);
    q += 1;
    if (isGroup(items[q]) && isWord(items[q + 1], 'as')) q += 1;
    if (!isWord(items[q], 'as')) return q;
    q += 1;
    if (isWord(items[q], 'not')) q += 1;
    if (isWord(items[q], 'materialized')) q += 1;
    if (!isGroup(items[q])) return q;
    const body = items[q];
    // While its own body is read, a CTE counts as limited to one tenant, so the recursive part of WITH RECURSIVE is judged
    // by the joins it makes; the part that starts the recursion is checked on its own.
    scope.ctes.set(name, { scoped: true });
    env.done.add(body);
    const r = analyseQuery(body.items, env, scope, `the CTE ${name}`);
    scope.ctes.set(name, { scoped: r.tenantRefs > 0 && r.unscoped === 0 });
    q += 1;
    while (q < items.length && !isOp(items[q], ',') && !isGroup(items[q]) && !isWord(items[q], 'select', 'insert', 'update', 'delete', 'values', 'table', 'merge', 'replace')) q += 1;
    if (!isOp(items[q], ',')) return q;
    q += 1;
  }
}

const KIND_LABEL = { select: 'the SELECT', insert: 'the INSERT', update: 'the UPDATE', delete: 'the DELETE' };

// Checks one query, which may start with WITH. { kind, tenantRefs, unscoped }; kind is select, insert, update,
// delete, truncate or null for a statement that is not a query.
export function analyseQuery(items, env, parent, context = null) {
  const scope = { refs: [], parent, ctes: new Map() };
  let p = 0;
  if (isWord(items[0], 'with')) p = readWith(items, 1, env, scope);
  const rest = items.slice(p);
  const w = rest[0];
  const kind = isWord(w, 'insert', 'replace') ? 'insert' : isWord(w, 'update') ? 'update' : isWord(w, 'delete') ? 'delete' : isWord(w, 'truncate') ? 'truncate' : isWord(w, 'select', 'values', 'table') || isQueryGroup(w) || (isGroup(w) && isQueryGroup(w)) ? 'select' : null;
  const ctx = context ?? KIND_LABEL[kind];
  let r;
  if (kind === 'insert') r = analyseInsert(rest, env, scope, ctx);
  else if (kind === 'update') r = analyseUpdate(rest, env, scope, ctx);
  else if (kind === 'delete') r = analyseDelete(rest, env, scope, ctx);
  else if (kind === 'truncate') r = analyseTruncate(rest, env);
  else if (kind === 'select') r = analyseSetOps(rest, env, scope, ctx);
  else {
    scanSubqueries(rest, env, scope);
    r = { tenantRefs: 0, unscoped: 0 };
  }
  return { kind, ...r };
}

// Checks one statement: EXPLAIN and PREPARE ... AS are read through to the query they hold. Returns the kind of the
// query, or null.
export function analyseStatement(items, env) {
  let p = 0;
  if (isWord(items[0], 'explain')) {
    p = 1;
    if (isGroup(items[p])) p += 1;
    while (isWord(items[p], 'analyze', 'analyse', 'verbose')) p += 1;
  } else if (isWord(items[0], 'prepare')) {
    const as = indexWhere(items, 1, (it) => isWord(it, 'as'));
    p = as + 1;
  }
  if (!isWord(items[p], 'select', 'with', 'values', 'table', 'insert', 'replace', 'update', 'delete', 'truncate') && !isQueryGroup(items[p])) return null;
  return analyseQuery(items.slice(p), env, null).kind;
}
