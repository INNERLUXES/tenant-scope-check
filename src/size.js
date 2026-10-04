// Numbers and lists as the reports show them.

export const grouped = (n) => Number(n).toLocaleString('en-US');

// A list for a sentence: "a", "a and b", "a, b and c", and "a, b, c and 4 more" past the limit.
export function listText(items, max = 3) {
  const list = items.slice(0, max);
  const more = items.length - list.length;
  if (more > 0) return `${list.join(', ')} and ${grouped(more)} more`;
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

export function plural(count, one, many = `${one}s`) {
  return `${grouped(count)} ${count === 1 ? one : many}`;
}
