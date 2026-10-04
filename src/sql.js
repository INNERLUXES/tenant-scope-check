// The SQL reader: a small tokenizer, the split into statements and the nesting of parentheses. It is not a SQL parser.
// It knows what PostgreSQL's lexical rules say about the parts that can hide a semicolon, a quote or a keyword: string
// constants with a doubled quote, escape strings (E'...') with backslashes, dollar-quoted strings ($$...$$ and
// $tag$...$tag$), quoted identifiers ("..." and, for MySQL, `...`), line comments (--) and nested block comments
// (/* ... */). Everything else is a word, a number, a parameter or an operator. A string, an identifier or a comment
// that is not closed, and a parenthesis that is not matched, stop the run with the line, so text the reader could not
// place is never passed over. docs/method.md says what is read and docs/limits.md what is not.

import { lineStarts, positionOf } from './json.js';

export const SQL_LIMITS = { maxDepth: 64, maxTokens: 1000000 };

export class SqlError extends Error {
  constructor(reason, offset) {
    super(reason);
    this.reason = reason;
    this.offset = offset;
  }
}

const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11;
const isDigit = (c) => c >= 48 && c <= 57;
const isLetter = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c >= 0x80;
const isWordChar = (c) => isLetter(c) || isDigit(c) || c === 36;
const isTagChar = (c) => isLetter(c) || isDigit(c);
const MULTI_OPS = ['->>', '#>>', '<>', '!=', '<=', '>=', '||', '->', '#>', '::', ':=', '=>', '@>', '<@', '&&', '=='];
const SINGLE = '(),;.[]';

// ASCII lower case, so a keyword compares the same whatever the locale.
const lower = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

// The tokens and the comments of one SQL text. A token is { type, text, value, lower, at, line }, where type is word,
// ident (a quoted identifier, value without its quotes), string, number, param, op or semi. A comment is
// { text, at, line }, with the text inside the comment marks.
export function tokenize(text, limits = SQL_LIMITS) {
  const lim = { ...SQL_LIMITS, ...limits };
  const starts = lineStarts(text);
  const lineAt = (at) => positionOf(starts, at).line;
  const tokens = [];
  const comments = [];
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const push = (type, start, end, value = text.slice(start, end)) => {
    if (tokens.length >= lim.maxTokens) throw new SqlError(`more than ${lim.maxTokens} tokens in one file`, start);
    const raw = text.slice(start, end);
    tokens.push({ type, text: raw, value, lower: type === 'word' ? lower(raw) : null, at: start, line: lineAt(start) });
  };
  // The end of a quoted run that ends at quote and takes a doubled quote as one, or -1.
  const closeQuoted = (from, quote, backslash) => {
    let j = from;
    for (;;) {
      const k = text.indexOf(quote, j);
      if (k < 0) return -1;
      if (backslash) {
        // A quote after an odd number of backslashes is escaped.
        let b = 0;
        while (k - 1 - b >= from && text.charCodeAt(k - 1 - b) === 92) b += 1;
        if (b % 2 === 1) {
          j = k + 1;
          continue;
        }
      }
      if (text[k + 1] === quote) {
        j = k + 2;
        continue;
      }
      return k;
    }
  };
  while (i < n) {
    const c = text.charCodeAt(i);
    const ch = text[i];
    if (isSpace(c)) {
      i += 1;
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      let j = i + 2;
      while (j < n && text.charCodeAt(j) !== 10 && text.charCodeAt(j) !== 13) j += 1;
      comments.push({ text: text.slice(i + 2, j), at: i, line: lineAt(i) });
      i = j;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      // Block comments nest, as in PostgreSQL and the SQL standard.
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (text[j] === '*' && text[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else j += 1;
      }
      if (depth > 0) throw new SqlError('a block comment that is not closed', i);
      comments.push({ text: text.slice(i + 2, j - 2), at: i, line: lineAt(i) });
      i = j;
      continue;
    }
    if (ch === "'") {
      // An escape string is a word E or e right before the quote, with no space between.
      const prev = tokens.at(-1);
      const escape = prev && prev.type === 'word' && prev.at + prev.text.length === i && prev.lower === 'e';
      const end = closeQuoted(i + 1, "'", escape);
      if (end < 0) throw new SqlError('a string that is not closed', i);
      const start = escape ? prev.at : i;
      if (escape) tokens.pop();
      push('string', start, end + 1, text.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === '`') {
      const end = closeQuoted(i + 1, ch, false);
      if (end < 0) throw new SqlError('a quoted identifier that is not closed', i);
      push('ident', i, end + 1, text.slice(i + 1, end).split(ch + ch).join(ch));
      i = end + 1;
      continue;
    }
    if (ch === '$') {
      if (isDigit(text.charCodeAt(i + 1))) {
        let j = i + 1;
        while (j < n && isDigit(text.charCodeAt(j))) j += 1;
        push('param', i, j);
        i = j;
        continue;
      }
      if (text[i + 1] === '{') {
        const end = text.indexOf('}', i + 2);
        if (end > 0 && end - i < 200 && !text.slice(i, end).includes('\n')) {
          push('param', i, end + 1);
          i = end + 1;
          continue;
        }
      }
      let j = i + 1;
      while (j < n && isTagChar(text.charCodeAt(j))) j += 1;
      if (text[j] === '$') {
        const tag = text.slice(i, j + 1);
        const end = text.indexOf(tag, j + 1);
        if (end < 0) throw new SqlError(`a dollar-quoted string that is not closed (${tag.slice(0, 40)})`, i);
        push('string', i, end + tag.length, text.slice(j + 1, end));
        i = end + tag.length;
        continue;
      }
      push('op', i, i + 1);
      i += 1;
      continue;
    }
    if (ch === '#' && text[i + 1] === '{') {
      const end = text.indexOf('}', i + 2);
      if (end > 0 && end - i < 200 && !text.slice(i, end).includes('\n')) {
        push('param', i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (ch === ':' && text[i + 1] !== ':' && (isLetter(text.charCodeAt(i + 1)) || text[i + 1] === "'" || text[i + 1] === '"') && !(tokens.length && tokens.at(-1).at + tokens.at(-1).text.length === i && tokens.at(-1).text === ':')) {
      // A named parameter: :tenant, and :'tenant' or :"tenant" as psql writes a variable.
      let j = i + 1;
      if (text[j] === "'" || text[j] === '"') {
        const end = text.indexOf(text[j], j + 1);
        if (end < 0) throw new SqlError('a quoted parameter that is not closed', i);
        j = end + 1;
      } else while (j < n && isWordChar(text.charCodeAt(j))) j += 1;
      push('param', i, j);
      i = j;
      continue;
    }
    if (ch === '?') {
      push('param', i, i + 1);
      i += 1;
      continue;
    }
    if (ch === '@' && isLetter(text.charCodeAt(i + 1))) {
      let j = i + 1;
      while (j < n && isWordChar(text.charCodeAt(j))) j += 1;
      push('param', i, j);
      i = j;
      continue;
    }
    if (isDigit(c) || (ch === '.' && isDigit(text.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (isDigit(d) || isLetter(d) || d === 46) j += 1;
        else if ((d === 43 || d === 45) && (text[j - 1] === 'e' || text[j - 1] === 'E') && isDigit(text.charCodeAt(j + 1))) j += 1;
        else break;
      }
      push('number', i, j);
      i = j;
      continue;
    }
    if (isLetter(c)) {
      let j = i + 1;
      while (j < n && isWordChar(text.charCodeAt(j))) j += 1;
      push('word', i, j);
      i = j;
      continue;
    }
    if (SINGLE.includes(ch)) {
      push(ch === ';' ? 'semi' : 'op', i, i + 1);
      i += 1;
      continue;
    }
    const multi = MULTI_OPS.find((op) => text.startsWith(op, i));
    push('op', i, i + (multi ? multi.length : 1));
    i += multi ? multi.length : 1;
  }
  return { tokens, comments };
}

const isWordToken = (t, w) => t && t.type === 'word' && t.lower === w;

// The statements of a token list, split at each semicolon. A routine written with BEGIN ATOMIC holds semicolons of its
// own, so inside one the split waits for its END. Each statement is { tokens, semi, line }, where semi is the
// semicolon that ends it or null for the last one; a statement with no token is dropped.
export function splitStatements(tokens) {
  const out = [];
  let current = [];
  let atomic = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    const t = tokens[k];
    if (t.type === 'semi' && atomic === 0) {
      if (current.length) out.push({ tokens: current, semi: t, line: current[0].line });
      current = [];
      continue;
    }
    if (t.type === 'word') {
      if (t.lower === 'begin' && isWordToken(tokens[k + 1], 'atomic')) atomic += 1;
      else if (atomic > 0 && (t.lower === 'case' || (t.lower === 'begin' && !isWordToken(tokens[k + 1], 'atomic')))) atomic += 1;
      else if (atomic > 0 && t.lower === 'end' && !isWordToken(tokens[k + 1], 'if') && !isWordToken(tokens[k + 1], 'loop')) atomic -= 1;
    }
    current.push(t);
  }
  if (current.length) out.push({ tokens: current, semi: null, line: current[0].line });
  return out;
}

// Gives each comment to its statement: a comment that starts on the line of a semicolon, after it, belongs to the
// statement that semicolon ends; any other comment belongs to the next statement that has not ended before it. A
// comment after the last statement belongs to none. Each statement gets .comments; the comments that belong to none
// are returned.
export function attachComments(statements, comments) {
  for (const s of statements) s.comments = [];
  const orphans = [];
  let k = 0;
  for (const c of comments) {
    while (k < statements.length && (statements[k].semi ? statements[k].semi.at : statements[k].tokens.at(-1).at) < c.at) k += 1;
    const prev = statements[k - 1];
    if (prev && prev.semi && prev.semi.line === c.line && prev.semi.at < c.at) prev.comments.push(c);
    else if (k < statements.length) statements[k].comments.push(c);
    else orphans.push(c);
  }
  return orphans;
}

// The items of a statement with every parenthesis made a group: { type: 'group', items, at, line, end }. Square
// brackets stay operators. A parenthesis that is not matched, or groups nested deeper than the limit, throw SqlError.
export function nest(tokens, limits = SQL_LIMITS) {
  const lim = { ...SQL_LIMITS, ...limits };
  const root = { type: 'group', items: [], at: tokens[0]?.at ?? 0, line: tokens[0]?.line ?? 1 };
  const stack = [root];
  for (const t of tokens) {
    if (t.type === 'op' && t.text === '(') {
      if (stack.length > lim.maxDepth) throw new SqlError(`parentheses nested more than ${lim.maxDepth} deep`, t.at);
      const g = { type: 'group', items: [], at: t.at, line: t.line };
      stack.at(-1).items.push(g);
      stack.push(g);
    } else if (t.type === 'op' && t.text === ')') {
      if (stack.length === 1) throw new SqlError('a closing parenthesis with no opening one', t.at);
      stack.pop().end = t.at;
    } else stack.at(-1).items.push(t);
  }
  if (stack.length > 1) throw new SqlError('a parenthesis that is not closed', stack.at(-1).at);
  return root.items;
}

// The text of items as one line, for a message: tokens joined by a space, with no space around a dot or before a comma.
export function itemsText(items, max = 80) {
  const pieces = [];
  const walk = (list) => {
    for (const it of list) {
      if (pieces.length > max) return;
      if (it.type === 'group') {
        pieces.push('(');
        walk(it.items);
        pieces.push(')');
      } else pieces.push(it.text);
    }
  };
  walk(items);
  let out = '';
  for (const p of pieces) {
    const tight = out === '' || out.endsWith('(') || out.endsWith('.') || out.endsWith('::') || p === ')' || p === ',' || p === '.' || p === '::' || (p === '(' && /[A-Za-z0-9_"]$/.test(out));
    out += tight ? p : ` ${p}`;
  }
  return out.length > max ? `${out.slice(0, max - 3)}...` : out;
}

// A whole SQL text read into statements with their groups and comments: { statements, orphans }. Each statement gets
// .items (the nested form).
export function readSql(text, limits = SQL_LIMITS) {
  const { tokens, comments } = tokenize(text, limits);
  const statements = splitStatements(tokens);
  const orphans = attachComments(statements, comments);
  for (const s of statements) s.items = nest(s.tokens, limits);
  return { statements, orphans };
}

// The reason of a SqlError with its line, for an error message.
export function sqlProblem(error, text) {
  if (!(error instanceof SqlError)) return error.message;
  const pos = positionOf(lineStarts(text), Math.min(error.offset, text.length));
  return `line ${pos.line}, column ${pos.column}: ${error.reason}`;
}
