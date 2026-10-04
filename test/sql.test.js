import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqlError, analyseQuery, applySchema, attachComments, conjuncts, emptySchema, indexWhere, isGroup, isName, isOp, isQueryGroup, isWord, itemsText, leadingColumn, nameOf, nest, qualifiedName, readFromList, readSql, scanSubqueries, schemaKind, splitAt, splitCommas, splitStatements, sqlProblem, tokenize } from '../src/index.js';

// The SQL reader: tokens, statements, comments and groups, and the small helpers over them.

const types = (text) => tokenize(text).tokens.map((t) => `${t.type}:${t.text}`);
const fails = (text, pattern) => assert.throws(() => readSql(text), (e) => e instanceof SqlError && pattern.test(e.reason), text.slice(0, 60));

test('tokens: words, quoted identifiers, numbers, operators and the semicolon', () => {
  assert.deepEqual(types('SELECT a.b, "Mixed ""Case""", `back`, 1e-5, .5, 0x1F FROM t;'), ['word:SELECT', 'word:a', 'op:.', 'word:b', 'op:,', 'ident:"Mixed ""Case"""', 'op:,', 'ident:`back`', 'op:,', 'number:1e-5', 'op:,', 'number:.5', 'op:,', 'number:0x1F', 'word:FROM', 'word:t', 'semi:;']);
  const t = tokenize('"Mixed ""Case""" Abc').tokens;
  assert.equal(t[0].value, 'Mixed "Case"');
  assert.equal(t[1].lower, 'abc');
  assert.deepEqual(types('a::int <> b != c >= d ->> e || f'), ['word:a', 'op:::', 'word:int', 'op:<>', 'word:b', 'op:!=', 'word:c', 'op:>=', 'word:d', 'op:->>', 'word:e', 'op:||', 'word:f']);
  assert.deepEqual(types('$x'), ['op:$', 'word:x'], 'a dollar sign with no tag is an operator');
});

test('tokens: strings with a doubled quote, escape strings, and dollar quotes with and without a tag', () => {
  assert.deepEqual(types("'it''s' E'it\\'s' e'\\\\' $$a'b$$ $fn$ $$ x $fn$"), ["string:'it''s'", "string:E'it\\'s'", "string:e'\\\\'", "string:$$a'b$$", 'string:$fn$ $$ x $fn$']);
  assert.equal(tokenize("'it''s'").tokens[0].value, "it''s");
  assert.deepEqual(types("x'1'"), ['word:x', "string:'1'"], 'a word other than E before a quote stays a word');
});

test('tokens: every kind of parameter', () => {
  assert.deepEqual(types("$1 :tenant :'t' :\"t\" ? @p #{tenantId} ${tenantId}"), ['param:$1', 'param::tenant', "param::'t'", 'param::"t"', 'param:?', 'param:@p', 'param:#{tenantId}', 'param:${tenantId}']);
  assert.deepEqual(types('a::text'), ['word:a', 'op:::', 'word:text'], 'a cast is not a parameter');
  assert.deepEqual(types('# x'), ['op:#', 'word:x']);
});

test('comments: line comments and nested block comments, with their lines', () => {
  const { tokens, comments } = tokenize('a -- one\n/* two /* three */ still */ b');
  assert.deepEqual(tokens.map((t) => t.text), ['a', 'b']);
  assert.deepEqual(comments.map((c) => [c.line, c.text]), [[1, ' one'], [2, ' two /* three */ still ']]);
});

test('lines: LF, CRLF and CR count the same, and a byte order mark is skipped', () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    const t = tokenize(`${String.fromCharCode(0xfeff)}a${eol}${eol}b`).tokens;
    assert.deepEqual(t.map((x) => [x.text, x.line]), [['a', 1], ['b', 3]], JSON.stringify(eol));
  }
});

test('statements: split at each semicolon, but not inside BEGIN ATOMIC, and empty statements are dropped', () => {
  const s = splitStatements(tokenize('SELECT 1;; SELECT 2;\nCREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT CASE WHEN true THEN 1 END; END;\nSELECT 3').tokens);
  assert.equal(s.length, 4);
  assert.equal(s[2].tokens[0].text, 'CREATE');
  assert.equal(s[3].semi, null);
  assert.equal(s[3].line, 3);
});

test('comments belong to the statement they come before, or to the one whose semicolon is on their line', () => {
  const { statements, orphans } = readSql('-- a\nSELECT 1; -- b\n-- c\nSELECT 2 /* d */;\n-- e\n');
  assert.deepEqual(statements.map((s) => s.comments.map((c) => c.text.trim())), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(orphans.map((c) => c.text.trim()), ['e']);
  const bare = splitStatements(tokenize('SELECT 1').tokens);
  assert.deepEqual(attachComments(bare, [{ text: 'x', at: 0, line: 1 }]), []);
  assert.equal(bare[0].comments.length, 1);
});

test('groups: each parenthesis makes a group, and the text of items reads as one line', () => {
  const items = nest(tokenize('SELECT f(a, (b)) FROM t').tokens);
  assert.equal(items.length, 5);
  assert.ok(isGroup(items[2]));
  assert.ok(isGroup(items[2].items[2]));
  assert.equal(itemsText(items), 'SELECT f(a, (b)) FROM t');
  assert.equal(itemsText(nest(tokenize('o.id = c.customer_id::int').tokens)), 'o.id = c.customer_id::int');
  assert.equal(itemsText(nest(tokenize('a = b'.repeat(40)).tokens), 20), 'a = ba = ba = ba ...');
});

for (const [name, text, pattern] of [
  ['a string that is not closed', "SELECT 'abc", /a string that is not closed/],
  ['an escape string that ends in an escaped quote', "SELECT E'abc\\'", /a string that is not closed/],
  ['a quoted identifier that is not closed', 'SELECT "abc', /a quoted identifier that is not closed/],
  ['a backtick identifier that is not closed', 'SELECT `abc', /a quoted identifier that is not closed/],
  ['a block comment that is not closed', 'SELECT 1 /* x /* y */', /a block comment that is not closed/],
  ['a dollar quote that is not closed', 'SELECT $body$ x', /a dollar-quoted string that is not closed \(\$body\$\)/],
  ['a quoted parameter that is not closed', "SELECT :'t", /a quoted parameter that is not closed/],
  ['a parenthesis that is not closed', 'SELECT (1', /a parenthesis that is not closed/],
  ['a closing parenthesis with no opening one', 'SELECT 1)', /a closing parenthesis with no opening one/]
]) {
  test(`reader: ${name} is refused with its place`, () => fails(text, pattern));
}

test('reader: the place of a problem has a line and a column, and nesting and token counts have limits', () => {
  try {
    readSql("SELECT 1;\n  SELECT 'x");
    assert.fail('not refused');
  } catch (error) {
    assert.equal(sqlProblem(error, "SELECT 1;\n  SELECT 'x"), 'line 2, column 10: a string that is not closed');
  }
  assert.equal(sqlProblem(new Error('plain'), ''), 'plain');
  assert.throws(() => readSql(`SELECT ${'('.repeat(70)}1${')'.repeat(70)}`), /parentheses nested more than 64 deep/);
  assert.throws(() => tokenize('a b c d', { maxTokens: 3 }), /more than 3 tokens in one file/);
});

test('items: words, operators, names, lists and the leading column of an index', () => {
  const items = nest(tokenize('public."Orders" AS o, b (tenant_id DESC, id) lower(x)').tokens);
  assert.ok(isName(items[0]) && isOp(items[1], '.') && isWord(items[3], 'as') && !isWord(items[3], 'from'));
  assert.deepEqual(qualifiedName(items, 0), { parts: ['public', 'Orders'], name: 'Orders', display: 'public."Orders"', line: 1, next: 3 });
  assert.equal(qualifiedName(items, 1), null);
  assert.equal(nameOf(items[4]), 'o');
  assert.equal(splitCommas(items).length, 2);
  assert.equal(splitAt(items, (it) => isWord(it, 'as'))[1].length, 6);
  assert.equal(indexWhere(items, 0, (it) => isGroup(it)), 7);
  assert.equal(leadingColumn(items[7]), 'tenant_id');
  assert.equal(leadingColumn(nest(tokenize('(lower(x), y)').tokens)[0]), null);
  assert.equal(leadingColumn(nest(tokenize('()').tokens)[0]), null);
});

test('schema: the kind of a statement, and what each one changes', () => {
  const kind = (sql) => schemaKind(nest(tokenize(sql).tokens));
  assert.equal(kind('CREATE UNLOGGED TABLE t (a int)'), 'create table');
  assert.equal(kind('CREATE OR REPLACE TEMP TABLE t (a int)'), 'create table');
  assert.equal(kind('CREATE UNIQUE INDEX i ON t (a)'), 'create index');
  assert.equal(kind('ALTER TABLE t ADD COLUMN a int'), 'alter table');
  assert.equal(kind('DROP TABLE t'), 'drop table');
  assert.equal(kind('CREATE VIEW v AS SELECT 1'), null);
  assert.equal(kind('SELECT 1'), null);
  const schema = emptySchema();
  for (const s of readSql('CREATE TABLE t (a int, b int DEFAULT 1, CONSTRAINT pk PRIMARY KEY (a));\nALTER TABLE IF EXISTS ONLY t ADD COLUMN IF NOT EXISTS c int, DROP COLUMN IF EXISTS b, RENAME COLUMN a TO d;\nCREATE INDEX ON t (c);\nALTER TABLE t ADD CONSTRAINT u UNIQUE (d);').statements) applySchema(schema, s.items, { file: 'f', line: s.line, statement: s });
  const t = schema.tables.get('t');
  assert.deepEqual([...t.columns.keys()], ['c', 'd']);
  assert.deepEqual([...schema.leading.get('t')].sort(), ['c', 'd']);
  assert.equal(schema.indexStatements, 1);
});

test('queries: query groups, the parts every row must pass, FROM lists and a query checked on its own', () => {
  const group = (sql) => nest(tokenize(sql).tokens)[0];
  assert.equal(isQueryGroup(group('(SELECT 1)')), true);
  assert.equal(isQueryGroup(group('((VALUES (1)))')), true);
  assert.equal(isQueryGroup(group('(1, 2)')), false);
  assert.equal(isQueryGroup(nest(tokenize('x').tokens)[0]), false);
  const parts = conjuncts(nest(tokenize('a = 1 AND (b = 2 AND c = 3) AND (d = 4 OR e = 5) AND NOT f = 6 AND g BETWEEN 1 AND 2').tokens));
  assert.deepEqual(parts.map((p) => itemsText(p)), ['a = 1', 'b = 2', 'c = 3', 'g BETWEEN 1 AND 2']);
  const env = { isTenant: (n) => n === 'orders', tenantColumnsOf: () => ['tenant_id'], hasDefault: () => false, tenantColumns: new Set(['tenant_id']), out: [], done: new WeakSet() };
  const scope = { refs: [], parent: null, ctes: null };
  readFromList(nest(tokenize('orders o LEFT OUTER JOIN plans AS p ON p.id = o.plan_id, generate_series(1, 2) WITH ORDINALITY g (n, i)').tokens), env, scope);
  assert.deepEqual(scope.refs.map((r) => [r.kind, r.name, r.alias, r.joinType, r.tenant]), [['table', 'orders', 'o', 'from', true], ['table', 'plans', 'p', 'left', false], ['function', 'generate_series', 'g', 'from', false]]);
  assert.equal(analyseQuery(nest(tokenize('SELECT * FROM orders').tokens), env, null).kind, 'select');
  assert.equal(env.out.length, 1);
  env.out = [];
  scanSubqueries(nest(tokenize('f((SELECT 1 FROM orders))').tokens), env, scope);
  assert.match(env.out[0].found, /^a subquery reads orders/);
});
