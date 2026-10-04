// Repository checks that run in CI next to the tests.
//   1. every JavaScript file parses
//   2. every module in src is exported from src/index.js and named in a test
//   3. nothing that looks like a credential is committed
//   4. source files stay free of leftovers (debugger, conflict markers, a focused test in the tests) and of non-ASCII
//      characters
//   5. no file holds a control byte (0x01 to 0x08) or a carriage return outside the example output
//   6. no file holds a number that reads like a year
//   7. no file names a tool that wrote it, or says that a tool wrote it
//   8. every example file is plain ASCII with LF line ends
//   9. no file uses a word from the list of words this project keeps out of its prose

import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const SKIP = new Set(['node_modules', '.git']);
const SKIP_AT_TOP = new Set(['coverage', 'dist']);
const problems = [];

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || (dir === root && SKIP_AT_TOP.has(entry.name))) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = await walk(root);
const rel = (f) => relative(root, f).split(sep).join('/');
const code = files.filter((f) => /\.(js|mjs)$/.test(f) && !rel(f).startsWith('examples/'));

for (const file of code) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) problems.push(`${rel(file)}: does not parse\n${result.stderr.trim().split('\n').slice(0, 4).join('\n')}`);
}

const index = await readFile(join(root, 'src', 'index.js'), 'utf8');
const tests = (await Promise.all(files.filter((f) => rel(f).startsWith('test/')).map((f) => readFile(f, 'utf8')))).join('\n');
for (const file of code.filter((f) => rel(f).startsWith('src/') && rel(f) !== 'src/index.js')) {
  const path = `./${rel(file).slice('src/'.length)}`;
  if (!index.includes(`'${path}'`)) problems.push(`${rel(file)}: not exported from src/index.js`);
  const source = await readFile(file, 'utf8');
  const names = [...source.matchAll(/^export (?:async )?(?:function\*?|class|const) ([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
  const used = names.filter((n) => new RegExp(`(?:^|[^A-Za-z0-9_$])${n.replace(/\$/g, '\\$')}(?![A-Za-z0-9_$])`).test(tests));
  if (names.length && used.length === 0) problems.push(`${rel(file)}: none of its exports appears in a test`);
}

const SECRET = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/,
  new RegExp(`\\b${['AK', 'IA'].join('')}[0-9A-Z]{16}\\b`),
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*['"][^'"\s]{12,}['"]/i
];
// A focused test in this repository's own tests would leave the rest of them unrun.
const FOCUSED = new RegExp(`\\b(?:test|describe|it)\\.${['on', 'ly'].join('')}\\(`);
const LEFTOVER = [/^\s*debugger;?\s*$/m, /^(?:<<<<<<<|>>>>>>>) /m];
const CONTROL = /[\x01-\x08]/;
const YEAR = /\b(?:19|20)\d{2}\b/;
// Words that say a tool wrote a file, built from pieces so that this file does not hold them. Some are matched inside
// longer words too.
const WRITTEN_BY = new RegExp(`\\b(?:${['gene', 'rated'].join('')}|${['assis', 'tants?'].join('')}|${['ch', 'at', 'g', 'pt'].join('')}|${['ope', 'na', 'i'].join('')}|${['ch', 'at'].join('')}|${['g', 'pt'].join('')}|${['l', 'lms?'].join('')})\\b|\\b${['A', 'I'].join('')}\\b|${['cla', 'ude'].join('')}|${['anthro', 'pic'].join('')}|${['ses', 'sion'].join('')}|${['co-', 'authored'].join('')}`, 'i');
// Words this project keeps out of its prose because they say little, built from pieces so that this file does not hold
// them. A word is matched at its start, so its other forms are caught too.
const BANNED_WORDS = [['har', 'ness'], ['del', 've'], ['lever', 'age'], ['seam', 'less'], ['rob', 'ust'], ['cutting', '-edge'], ['un', 'lock'], ['em', 'power'], ['ele', 'vate'], ['stream', 'line'], ['game', '-changer'], ['tap', 'estry'], ['re', 'alm'], ['further', 'more'], ['more', 'over'], ['in today', "'s"]].map((p) => p.join(''));
const BANNED = new RegExp(`\\b(?:${BANNED_WORDS.map((w) => w.replace(/e$/, '')).join('|')})`, 'i');

for (const file of files) {
  if (/\.(png|jpg|jpeg|webp|ico|woff2?)$/.test(file)) continue;
  const text = await readFile(file, 'utf8');
  const name = rel(file);
  if (CONTROL.test(text)) problems.push(`${name}: holds a control byte`);
  if (name === 'tools/check.mjs') continue;
  // The saved pages are copies of documentation; the patterns of real tokens and keys still apply to them.
  for (const pattern of name.startsWith('research/sources/') ? SECRET.slice(0, 4) : SECRET) if (pattern.test(text)) problems.push(`${name}: looks like a credential`);
  if (/\.(js|mjs)$/.test(file) && !name.startsWith('examples/')) {
    for (const pattern of LEFTOVER) if (pattern.test(text)) problems.push(`${name}: leftover (${pattern.source})`);
    if ((name.startsWith('test/') || name.startsWith('tools/')) && FOCUSED.test(text)) problems.push(`${name}: a focused test is left in`);
    if (/[^\x00-\x7f]/.test(text)) problems.push(`${name}: holds a character that is not ASCII; write it as a Unicode escape`);
  }
  if (YEAR.test(text)) problems.push(`${name}: holds a number that reads like a year`);
  if (WRITTEN_BY.test(text)) problems.push(`${name}: names a tool that wrote it`);
  const banned = BANNED.exec(text);
  if (banned) problems.push(`${name}: uses "${banned[0]}", a word this project keeps out of its prose`);
  if (!name.startsWith('examples/output/') && text.includes(String.fromCharCode(13))) problems.push(`${name}: holds a carriage return; files keep LF line ends`);
  if (name.startsWith('examples/') && /[^\x00-\x7f]/.test(text)) problems.push(`${name}: holds a character that is not ASCII`);
}

if (problems.length) {
  console.error(`${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`checked ${files.length} files, ${code.length} scripts: no problems`);
