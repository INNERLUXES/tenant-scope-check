// Small helpers over the items of a statement (tokens and groups, src/sql.js): keywords, names and lists.

export const isWord = (it, ...words) => Boolean(it) && it.type === 'word' && (words.length === 0 || words.includes(it.lower));
export const isOp = (it, ...ops) => Boolean(it) && it.type === 'op' && ops.includes(it.text);
export const isGroup = (it) => Boolean(it) && it.type === 'group';
export const isName = (it) => Boolean(it) && (it.type === 'word' || it.type === 'ident');

// The name of a word or a quoted identifier as the database sees it: an unquoted name in lower case, a quoted one as
// written.
export const nameOf = (it) => (it.type === 'ident' ? it.value : it.lower);

// A name with its qualifiers at p: schema.table or db.schema.table. { parts, name, display, line, next }, where name is
// the last part, or null when p holds no name.
export function qualifiedName(items, p) {
  if (!isName(items[p])) return null;
  const parts = [items[p]];
  let q = p + 1;
  while (isOp(items[q], '.') && isName(items[q + 1]) && parts.length < 4) {
    parts.push(items[q + 1]);
    q += 2;
  }
  return { parts: parts.map(nameOf), name: nameOf(parts.at(-1)), display: parts.map((t) => t.text).join('.'), line: items[p].line, next: q };
}

// The items split at every top-level item for which test is true; the item itself is dropped.
export function splitAt(items, test) {
  const out = [[]];
  for (const it of items) {
    if (test(it)) out.push([]);
    else out.at(-1).push(it);
  }
  return out;
}

export const splitCommas = (items) => splitAt(items, (it) => isOp(it, ','));

// The index of the first top-level item at or after from for which test is true, or items.length.
export function indexWhere(items, from, test) {
  for (let i = from; i < items.length; i += 1) if (test(items[i], i)) return i;
  return items.length;
}

// The first column named in a group of index columns: the leading column, or null when it is an expression.
export function leadingColumn(group) {
  const first = splitCommas(group.items)[0];
  if (!first.length || !isName(first[0])) return null;
  if (isGroup(first[1]) || isOp(first[1], '.')) return null;
  return nameOf(first[0]);
}
