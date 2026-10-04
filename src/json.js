// A small strict JSON reader for the configuration file. It reads the text once, left to right,
// as RFC 8259 writes the grammar: no comments, no trailing comma, no single quotes, no NaN, no control character inside a
// string. It refuses an object that holds the same name twice, because RFC 8259 says the behaviour of software that
// receives such an object is unpredictable, and a finding must not depend on which of two values a library keeps. It
// also keeps the line of every value, so a mistake can be reported with its line. A name such as
// __proto__ becomes an ordinary property of the result and never changes how objects behave.

// The offset of the start of every line, and the line and column of an offset. A line ends at LF, CR LF or CR.
export function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 10) starts.push(i + 1);
    else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i += 1;
      starts.push(i + 1);
    }
  }
  return starts;
}

// The line and column (both from 1) of an offset, by binary search in the line starts.
export function positionOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

export const JSON_LIMITS = { maxDepth: 32, maxValues: 100000, maxStringLength: 4096, linesUpTo: Infinity };

export class JsonError extends Error {
  constructor(reason, offset) {
    super(reason);
    this.reason = reason;
    this.offset = offset;
  }
}

const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 13;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/y;
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

function setOwn(object, name, value) {
  Object.defineProperty(object, name, { value, enumerable: true, writable: true, configurable: true });
}

// Reads one JSON text. Returns { value, lines } where lines maps a path such as "systems.erp.entities" or
// "flows[1].fields[0]" to the line of its value, for the values nested at most limits.linesUpTo deep. Throws JsonError
// with the offset of the problem.
export function parseJson(text, limits = JSON_LIMITS) {
  const lim = { ...JSON_LIMITS, ...limits };
  const starts = lineStarts(text);
  const lines = new Map();
  const n = text.length;
  let i = 0;
  let values = 0;

  const skip = () => {
    while (i < n && isSpace(text.charCodeAt(i))) i += 1;
  };
  const fail = (reason, at = i) => {
    throw new JsonError(reason, at);
  };
  const lineOfOffset = (at) => positionOf(starts, at).line;

  const readString = () => {
    const start = i;
    i += 1;
    let out = '';
    let from = i;
    for (;;) {
      if (i >= n) fail('a string that is not closed', start);
      const c = text.charCodeAt(i);
      if (c === 34) break;
      if (c < 0x20) fail('a control character inside a string; write it as an escape such as \\n', i);
      if (c === 92) {
        out += text.slice(from, i);
        const e = text[i + 1];
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('an escape \\u that is not followed by four hexadecimal digits', i);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else if (Object.hasOwn(ESCAPES, e)) {
          out += ESCAPES[e];
          i += 2;
        } else fail(`an escape \\${(e ?? '').slice(0, 1)} that JSON does not have`, i);
        from = i;
        if (out.length > lim.maxStringLength) fail(`a string longer than ${lim.maxStringLength} characters`, start);
        continue;
      }
      i += 1;
      if (i - from + out.length > lim.maxStringLength) fail(`a string longer than ${lim.maxStringLength} characters`, start);
    }
    out += text.slice(from, i);
    i += 1;
    return out;
  };

  const readValue = (path, depth) => {
    skip();
    if (i >= n) fail('the text ends where a value was expected');
    values += 1;
    if (values > lim.maxValues) fail(`more than ${lim.maxValues} values`);
    const at = i;
    if (depth <= lim.linesUpTo) lines.set(path, lineOfOffset(at));
    const c = text[i];
    if (c === '{') {
      if (depth >= lim.maxDepth) fail(`values nested more than ${lim.maxDepth} deep`);
      i += 1;
      const object = {};
      const seen = new Set();
      skip();
      if (text[i] === '}') {
        i += 1;
        return object;
      }
      for (;;) {
        skip();
        if (text[i] !== '"') fail(text[i] === '}' ? 'a comma before the closing brace; JSON has no trailing comma' : 'a name in double quotes was expected');
        const nameAt = i;
        const name = readString();
        if (seen.has(name)) fail(`the name "${name.slice(0, 60)}" appears twice in one object; RFC 8259 says the behavior of software that receives such an object is unpredictable, so the file is refused`, nameAt);
        seen.add(name);
        skip();
        if (text[i] !== ':') fail('a colon after the name was expected');
        i += 1;
        setOwn(object, name, readValue(path ? `${path}.${name}` : name, depth + 1));
        skip();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === '}') {
          i += 1;
          return object;
        }
        fail('a comma or a closing brace was expected');
      }
    }
    if (c === '[') {
      if (depth >= lim.maxDepth) fail(`values nested more than ${lim.maxDepth} deep`);
      i += 1;
      const array = [];
      skip();
      if (text[i] === ']') {
        i += 1;
        return array;
      }
      for (;;) {
        skip();
        if (text[i] === ']') fail('a comma before the closing bracket; JSON has no trailing comma');
        array.push(readValue(`${path}[${array.length}]`, depth + 1));
        skip();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === ']') {
          i += 1;
          return array;
        }
        fail('a comma or a closing bracket was expected');
      }
    }
    if (c === '"') return readString();
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(text);
      if (!m) fail('a number that JSON does not allow');
      i += m[0].length;
      const number = Number(m[0]);
      if (!Number.isFinite(number)) fail('a number too large to read', at);
      return number;
    }
    if (c === '/' || c === '#') fail('a comment; JSON has no comments');
    if (c === "'") fail("a string in single quotes; JSON strings use double quotes");
    return fail(`the character ${JSON.stringify(c).slice(0, 12)} where a value was expected`);
  };

  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const value = readValue('', 0);
  skip();
  if (i < n) fail('text after the end of the value');
  return { value, lines };
}

// The reason of a JsonError with its line and column, for an error message.
export function jsonProblem(error, text) {
  if (!(error instanceof JsonError)) return error.message;
  const pos = positionOf(lineStarts(text), Math.min(error.offset, text.length));
  return `line ${pos.line}, column ${pos.column}: ${error.reason}`;
}
