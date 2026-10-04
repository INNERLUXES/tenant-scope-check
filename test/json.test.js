import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonError, jsonProblem, parseJson } from '../src/index.js';

// Coverage counting slows every line of the tool several times over, so a run with --experimental-test-coverage gets a
// wider time limit. The runner sets NODE_V8_COVERAGE for its test processes only when coverage is on.
const COVERAGE = Boolean(process.env.NODE_V8_COVERAGE);
const within = (start, ms) => {
  const limit = COVERAGE ? ms * 4 : ms;
  assert.ok(Date.now() - start < limit, `took ${Date.now() - start} ms`);
};

const fails = (text, pattern) => assert.throws(() => parseJson(text), (e) => e instanceof JsonError && pattern.test(e.reason), text.slice(0, 60));

test('json: objects, arrays, strings, numbers, booleans and null are read as RFC 8259 writes them', () => {
  const { value } = parseJson('{"a": [1, 2.5, -3, 1e2, 0], "b": "x\\ny\\u0041\\"", "c": true, "d": false, "e": null, "f": {}, "g": []}');
  assert.deepEqual(value.a, [1, 2.5, -3, 100, 0]);
  assert.equal(value.b, 'x\nyA"');
  assert.equal(value.c, true);
  assert.equal(value.d, false);
  assert.equal(value.e, null);
  assert.deepEqual(value.f, {});
  assert.deepEqual(value.g, []);
});

test('json: the line of every value is kept under its path', () => {
  const { lines } = parseJson('{\n  "rules": {\n    "writeBack": 0,\n    "list": [\n      "a",\n      "b"\n    ]\n  }\n}');
  assert.equal(lines.get('rules'), 2);
  assert.equal(lines.get('rules.writeBack'), 3);
  assert.equal(lines.get('rules.list[1]'), 6);
});

test('json: with linesUpTo, only the lines of values at most that deep are kept, and a top list has paths [0], [1]', () => {
  const text = '[\n  {\n    "title": "a"\n  },\n  {\n    "title": "b"\n  }\n]';
  const { value, lines } = parseJson(text, { linesUpTo: 1 });
  assert.equal(value.length, 2);
  assert.equal(lines.get('[0]'), 2);
  assert.equal(lines.get('[1]'), 5);
  assert.equal(lines.has('[0].title'), false);
  assert.equal(parseJson(text).lines.get('[1].title'), 6);
});

test('json: an object that names a key twice is refused, because RFC 8259 calls the result unpredictable', () => {
  fails('{"a": 1, "a": 2}', /the name "a" appears twice in one object/);
  fails('{"o": {"x": 1, "x": 1}}', /appears twice/);
  assert.equal(parseJson('{"a": {"x": 1}, "b": {"x": 2}}').value.b.x, 2, 'the same name in two objects is fine');
});

test('json: a name such as __proto__ becomes an ordinary property and changes no prototype', () => {
  const { value } = parseJson('{"__proto__": {"polluted": true}, "constructor": 1}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.deepEqual(Object.keys(value), ['__proto__', 'constructor']);
});

for (const [name, text, pattern] of [
  ['a trailing comma in an object', '{"a": 1,}', /no trailing comma/],
  ['a trailing comma in an array', '[1, 2,]', /no trailing comma/],
  ['a comment after the value', '{"a": 1} // note', /text after the end/],
  ['a comment as a value', '{"a": /* x */ 1}', /JSON has no comments/],
  ['a single quoted string', "{'a': 1}", /double quotes|name in double quotes/],
  ['an unquoted name', '{a: 1}', /name in double quotes/],
  ['NaN', '{"a": NaN}', /where a value was expected/],
  ['Infinity', '{"a": Infinity}', /where a value was expected/],
  ['a leading zero', '{"a": 01}', /comma or a closing brace|text after/],
  ['a plus sign', '{"a": +1}', /where a value was expected/],
  ['a number with a bare point', '{"a": 1.}', /comma or a closing brace/],
  ['a number too large', '{"a": 1e999}', /too large/],
  ['a string that is not closed', '{"a": "x', /string that is not closed/],
  ['a control character in a string', '{"a": "x\ty"}', /control character inside a string/],
  ['an escape that JSON does not have', '{"a": "\\q"}', /escape \\q/],
  ['a short unicode escape', '{"a": "\\u12"}', /four hexadecimal digits/],
  ['a missing colon', '{"a" 1}', /colon/],
  ['a missing comma', '{"a": 1 "b": 2}', /comma or a closing brace/],
  ['text after the value', '{"a": 1} x', /text after the end of the value/],
  ['an empty text', '', /ends where a value was expected/],
  ['an array that is not closed', '[1, 2', /comma or a closing bracket|ends where/]
]) {
  test(`json: ${name} is refused`, () => fails(text, pattern));
}

test('json: values nested very deep, very many values and a very long string are refused at their limits, in one pass', () => {
  const started = Date.now();
  fails('['.repeat(100000), /nested more than 32 deep/);
  fails(`{"a": "${'x'.repeat(10000)}"}`, /string longer than 4096 characters/);
  assert.throws(() => parseJson(`[${'1,'.repeat(200000)}1]`), /more than 100000 values/);
  within(started, 5000);
});

test('json: a byte order mark at the start is skipped, and the problem of an error has a line and a column', () => {
  assert.equal(parseJson('\ufeff{"a": 1}').value.a, 1);
  const text = '{\n  "a": 1,\n  "a": 2\n}';
  try {
    parseJson(text);
    assert.fail('not refused');
  } catch (error) {
    assert.match(jsonProblem(error, text), /^line 3, column 3: the name "a" appears twice/);
  }
  assert.equal(jsonProblem(new Error('plain'), ''), 'plain');
});
