import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { asciiLower, atOrAbove, capped, cleanTexts, collectFiles, decide, decodeText, displayPath, fileError, flat, grouped, inspectPath, isBinary, isEmptyValue, lineStarts, listText, normalizePhrase, plural, positionOf, readBounded, readTextFile, ruleById, safeText } from '../src/index.js';
import { withFiles } from './helpers.js';

// The small helpers: numbers and lists, text cleaning, words, lines and columns, the result, and the files the tool
// reads.

test('size: grouped numbers, lists and plurals', () => {
  assert.equal(grouped(1234567), '1,234,567');
  assert.equal(listText([]), '');
  assert.equal(listText(['a']), 'a');
  assert.equal(listText(['a', 'b']), 'a and b');
  assert.equal(listText(['a', 'b', 'c']), 'a, b and c');
  assert.equal(listText(['a', 'b', 'c', 'd'], 2), 'a, b and 2 more');
  assert.equal(plural(1, 'file'), '1 file');
  assert.equal(plural(2, 'file'), '2 files');
  assert.equal(plural(2, 'query', 'queries'), '2 queries');
});

test('text: control, line separator and direction characters become spaces; long text is cut; every text of a value is cleaned', () => {
  assert.equal(safeText(`a${String.fromCharCode(27)}b${String.fromCharCode(0x202e)}c${String.fromCharCode(0x2028)}d${String.fromCharCode(0x9b)}e`), 'a b c d e');
  assert.equal(safeText('x'.repeat(20), 10), 'xxxxxxx...');
  assert.equal(flat(' a \n\t b '), 'a b');
  assert.deepEqual(cleanTexts({ a: [`x${String.fromCharCode(7)}`], b: 1, c: null }), { a: ['x '], b: 1, c: null });
  assert.deepEqual(capped(Array.from({ length: 25 }, (_, i) => `p${i}`)).slice(-2), ['p19', 'and 5 more']);
});

test('words: lowercase for A to Z only, phrases in their compared form, and values that say nothing', () => {
  assert.equal(asciiLower('ABC-xyz'), 'abc-xyz');
  assert.equal(normalizePhrase("N/A, Don't know!"), 'n a dont know');
  const empty = ['tbd', 'n a', 'none'];
  for (const v of [null, undefined, '', '  ', '-', '?', 'TBD', 'n/a', 'None.']) assert.equal(isEmptyValue(v, empty), true, String(v));
  for (const v of ['Dana', 'tbd later', 'the finance team']) assert.equal(isEmptyValue(v, empty), false, v);
});

test('lines: LF, CRLF and a lone CR each end a line; positions count from 1', () => {
  const starts = lineStarts('a\nb\r\nc\rd');
  assert.deepEqual(starts, [0, 2, 5, 7]);
  assert.deepEqual(positionOf(starts, 6), { line: 3, column: 2 });
});

test('result: only an error fails the run, and the levels compare from notice up', () => {
  assert.deepEqual(decide([]), { pass: true, errors: 0, byLevel: { error: 0, warning: 0, notice: 0 }, text: 'PASS - no error' });
  assert.equal(decide([{ level: 'warning' }, { level: 'notice' }]).text, 'PASS - no error (1 warning, 1 notice)');
  assert.equal(decide([{ level: 'error' }, { level: 'error' }, { level: 'warning' }]).text, 'FAIL - 2 errors (and 1 warning)');
  assert.equal(atOrAbove('error', 'warning'), true);
  assert.equal(atOrAbove('notice', 'warning'), false);
  assert.equal(ruleById('unscoped-join').key, 'unscopedJoin');
});

test('files: a path relative to the base with forward slashes, and an error that names the file', async () => {
  const base = resolve('base');
  assert.equal(displayPath(resolve(base, 'a/b.sql'), base), 'a/b.sql');
  assert.equal(displayPath(base, base), '.');
  assert.ok(displayPath(resolve(base, '../x.sql'), base).endsWith('/x.sql'));
  assert.equal(fileError('a.sql', 'why').message, 'a.sql: why');
  assert.equal(fileError('a.sql', 'why').reason, 'why');
  await withFiles({ 'a.sql': 'hello', 'd/b.sql': 'x' }, async (dir) => {
    assert.equal((await readBounded(resolve(dir, 'a.sql'), 10)).toString(), 'hello');
    await assert.rejects(readBounded(resolve(dir, 'a.sql'), 2), /5 bytes is over the 2 byte limit/);
    await assert.rejects(readBounded(resolve(dir, 'none.sql'), 2), /no such file/);
    await assert.rejects(readBounded(resolve(dir, 'd'), 2), /is a folder|cannot be read/);
    assert.deepEqual(await inspectPath('a.sql', dir), { full: resolve(dir, 'a.sql'), shown: 'a.sql', folder: false });
    await assert.rejects(inspectPath('d', dir), /d: is a folder; give the file itself/);
    assert.deepEqual(await inspectPath('d', dir, true), { full: resolve(dir, 'd'), shown: 'd', folder: true });
    await assert.rejects(inspectPath('none', dir), /none: no such file/);
  });
});

test('files: a text file is read as UTF-8 without its byte order mark; UTF-16 and binary files are refused', async () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  assert.equal(decodeText(Buffer.concat([bom, Buffer.from('a,b')])), 'a,b');
  assert.equal(isBinary(Buffer.from([65, 0, 66])), true);
  assert.equal(isBinary(Buffer.from('plain')), false);
  assert.equal(decodeText(Buffer.from([0xc3, 0x28])), null, 'bytes that are not UTF-8');
  await withFiles({ 'u8.sql': Buffer.concat([bom, Buffer.from('x\n')]), 'u16.sql': Buffer.from([0xff, 0xfe, 0x61, 0]), 'bin.sql': Buffer.from([0x61, 0, 0x62]), 'latin1.sql': Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]) }, async (dir) => {
    const r = await readTextFile('u8.sql', dir, 100);
    assert.deepEqual({ file: r.file, size: r.size, text: r.text }, { file: 'u8.sql', size: 5, text: 'x\n' });
    await assert.rejects(readTextFile('u16.sql', dir, 100), /u16.sql: is UTF-16; only UTF-8 is read/);
    await assert.rejects(readTextFile('bin.sql', dir, 100), /bin.sql: holds binary data \(a null byte\); only text is read/);
    await assert.rejects(readTextFile('u8.sql', dir, 2), /u8.sql: 5 bytes is over the 2 byte limit/);
    await assert.rejects(readTextFile('latin1.sql', dir, 100), /latin1.sql: is not valid UTF-8; only UTF-8 text is read/);
  });
});

test('files: a folder is walked in the order of its paths, with the patterns, and a folder with nothing to read is an error', async () => {
  const patterns = { files: ['**/*.sql'], exclude: ['**/seed/*.sql'] };
  await withFiles({ 'db/b.sql': 'x', 'db/a.sql': 'x', 'db/sub/c.sql': 'x', 'db/seed/s.sql': 'x', 'db/notes.md': 'x', 'db/node_modules/m.sql': 'x', 'db/.git/g.sql': 'x', 'one.txt': 'x', 'empty/readme.md': 'x' }, async (dir) => {
    const r = await collectFiles(['db', 'one.txt', 'db/a.sql'], dir, patterns);
    assert.deepEqual(r.files.map((f) => f.shown), ['db/a.sql', 'db/b.sql', 'db/sub/c.sql', 'one.txt'], 'a file named directly is read whatever its name, and once');
    assert.deepEqual(r.named, ['db', 'one.txt', 'db/a.sql']);
    assert.equal(r.skippedLinks, 0);
    await assert.rejects(collectFiles(['empty'], dir, patterns), /empty: no file in this folder matches \*\*\/\*\.sql outside \*\*\/seed\/\*\.sql/);
    await assert.rejects(collectFiles(['db'], dir, patterns, { maxFiles: 2, maxEntries: 100, maxDepth: 32 }), /more than 2 SQL files/);
    await assert.rejects(collectFiles(['db'], dir, patterns, { maxFiles: 10, maxEntries: 3, maxDepth: 32 }), /db: more than 3 files and folders to look at/);
    await assert.rejects(collectFiles(['db'], dir, patterns, { maxFiles: 10, maxEntries: 100, maxDepth: 0 }), /folders nested more than 0 deep/);
    await assert.rejects(collectFiles(['none'], dir, patterns), /none: no such file/);
  });
});
