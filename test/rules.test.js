import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, applySchema, defaultConfig, emptySchema, markerOf, readSql, tenancyOf } from '../src/index.js';
import { SCHEMA, findingsOf, lineOf, queryReport, reportOf, rulesOf, rulesOfQuery } from './helpers.js';

// Every rule with a near miss on each side: the smallest query that is reported, and the smallest change that makes it
// pass. The schema of test/helpers.js has two tenant tables, customers and orders, and one global table, plans.

test('unscoped-query: a SELECT with no tenant condition is an error, and one compared to a parameter passes', () => {
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE id = $1;'), ['unscoped-query']);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders;'), ['unscoped-query']);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE tenant_id = $1 AND id = $2;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE id = $2 AND tenant_id = $1;'), []);
  const r = queryReport('SELECT * FROM orders WHERE id = $1;');
  assert.equal(r.findings[0].found, 'the SELECT reads orders with no condition on orders.tenant_id, so it can return the rows of every tenant');
  assert.equal(r.findings[0].line, lineOf(`${SCHEMA}SELECT * FROM orders WHERE id = $1;\n`, 'orders WHERE'));
  assert.equal(r.findings[0].level, 'error');
});

test('unscoped-query: every kind of value counts, and every kind of parameter', () => {
  for (const value of ['$1', ':tenant', ":'tenant'", '?', '@tenant', '#{tenantId}', '${tenantId}', '42', "'acme'", "current_setting('app.tenant_id')::int", '(SELECT 7)', 'ANY($1)']) {
    assert.deepEqual(rulesOfQuery(`SELECT * FROM orders WHERE tenant_id = ${value};`), [], value);
  }
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE tenant_id IN ($1, $2);'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE tenant_id::text = $1::text;'), [], 'casts on both sides');
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE $1 = tenant_id;'), [], 'the value on the left');
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE "tenant_id" = $1;'), [], 'a quoted name');
  assert.deepEqual(rulesOfQuery('SELECT * FROM public.orders o WHERE o.tenant_id = $1;'), [], 'a schema in front');
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE TENANT_ID = $1;'), [], 'a name in capitals');
});

test('unscoped-query: OR, NOT, NOT IN, a comparison other than equality and NULL do not limit a table', () => {
  for (const where of ['tenant_id = $1 OR id = $2', 'NOT tenant_id = $1', 'tenant_id NOT IN ($1)', 'tenant_id <> $1', 'tenant_id > $1', 'tenant_id = NULL', 'tenant_id IS NOT NULL', '(tenant_id = $1 OR TRUE)']) {
    assert.deepEqual(rulesOfQuery(`SELECT * FROM orders WHERE ${where};`), ['unscoped-query'], where);
  }
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE tenant_id = $1 AND (id = $2 OR id = $3);'), [], 'an OR beside the tenant condition is fine');
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE (tenant_id = $1 AND id = $2);'), [], 'a group of AND parts is opened up');
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE id BETWEEN 1 AND 3 AND tenant_id = $1;'), [], 'BETWEEN keeps its AND');
});

test('unscoped-query: the tenant condition of the wrong table, or of a column of the same name in a global table, does not count', () => {
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o, plans p WHERE p.id = $1;'), ['unscoped-query']);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o JOIN customers c ON c.tenant_id = $1;'), ['unscoped-query'], 'only customers is limited');
  assert.equal(findingsOf(queryReport('SELECT * FROM orders o JOIN customers c ON c.tenant_id = $1;'))[0].found.includes('orders (o)'), true);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o JOIN customers c ON c.tenant_id = $1 AND o.tenant_id = $1;'), []);
});

test('unscoped-query: an unqualified tenant column names the one tenant table of the block, and none when two have it', () => {
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o JOIN plans p ON p.id = o.plan_id WHERE tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE tenant_id = $1;'), ['unscoped-query', 'unscoped-query'], 'ambiguous between two tenant tables');
});

test('unscoped-query: UPDATE, DELETE, TRUNCATE and TABLE, each with its own words', () => {
  const update = queryReport("UPDATE orders SET total = 0 WHERE id = $1;");
  assert.deepEqual(rulesOf(update), ['unscoped-query']);
  assert.match(update.findings[0].found, /^the UPDATE changes orders with no condition on orders\.tenant_id, so it can change the rows of every tenant$/);
  assert.deepEqual(rulesOfQuery('UPDATE orders SET total = 0 WHERE tenant_id = $1 AND id = $2;'), []);
  const del = queryReport('DELETE FROM orders WHERE id = $1;');
  assert.match(del.findings[0].found, /^the DELETE deletes from orders with no condition on orders\.tenant_id, so it can delete the rows of every tenant$/);
  assert.deepEqual(rulesOfQuery('DELETE FROM orders WHERE tenant_id = $1 AND id = $2;'), []);
  assert.deepEqual(rulesOfQuery('DELETE FROM orders;'), ['unscoped-query']);
  const truncate = queryReport('TRUNCATE TABLE orders, plans;');
  assert.deepEqual(rulesOf(truncate), ['unscoped-query'], 'plans is global');
  assert.match(truncate.findings[0].found, /^TRUNCATE empties orders, which removes the rows of every tenant$/);
  assert.match(queryReport('TABLE orders;').findings[0].found, /reads every row of orders \(TABLE orders\)/);
  assert.deepEqual(rulesOfQuery('TABLE plans;'), []);
  assert.deepEqual(rulesOfQuery('UPDATE orders SET total = 0 WHERE CURRENT OF c;'), [], 'the cursor limits the rows');
});

test('unscoped-query: UPDATE ... FROM, DELETE ... USING and the MySQL forms read every table they name', () => {
  assert.deepEqual(rulesOfQuery('UPDATE orders o SET plan_id = p.id FROM plans p WHERE p.name = $2 AND o.tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('UPDATE orders o SET total = 1 FROM customers c WHERE c.id = o.customer_id AND c.tenant_id = $1 AND o.tenant_id = c.tenant_id;'), []);
  assert.deepEqual(rulesOfQuery('DELETE FROM orders USING customers c WHERE orders.customer_id = c.id AND c.tenant_id = $1 AND orders.tenant_id = c.tenant_id;'), []);
  assert.deepEqual(rulesOfQuery('UPDATE orders o JOIN customers c ON c.id = o.customer_id SET o.total = 0 WHERE o.tenant_id = $1;'), ['unscoped-join']);
  assert.deepEqual(rulesOfQuery('DELETE o FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.tenant_id = $1;'), ['unscoped-join']);
  assert.match(queryReport('DELETE o FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.tenant_id = $1;').findings[0].found, /^the DELETE deletes from orders \(o\) through/);
});

test('unscoped-join: a tenant table joined on a key alone is a warning; a tie of the tenant columns or a condition on both passes', () => {
  const r = queryReport('SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.tenant_id = $1;');
  assert.deepEqual(rulesOf(r), ['unscoped-join']);
  assert.equal(r.findings[0].level, 'warning');
  assert.match(r.findings[0].found, /^the SELECT reads customers \(c\) through c\.id = o\.customer_id from orders \(o\) only: no condition ties c\.tenant_id to the tenant of orders \(o\)/);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id WHERE o.tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.tenant_id = $1 AND c.tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o JOIN customers c USING (tenant_id) WHERE o.tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o NATURAL JOIN customers c WHERE o.tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o, customers c WHERE c.id = o.customer_id AND o.tenant_id = $1;'), ['unscoped-join'], 'a comma join');
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o CROSS JOIN customers c WHERE o.tenant_id = $1;'), ['unscoped-query'], 'nothing links a cross join');
});

test('unscoped-join: a global table passes nothing on, so a tenant table reached through it is unscoped', () => {
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o JOIN plans p ON p.id = o.plan_id JOIN customers c ON c.id = p.id WHERE o.tenant_id = $1;'), ['unscoped-query']);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o JOIN plans p ON p.id = o.plan_id WHERE o.tenant_id = $1;'), [], 'a global table needs no condition');
});

test('outer joins: a condition in ON limits only the side the join does not keep whole', () => {
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o LEFT JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id WHERE o.tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o LEFT JOIN customers c ON c.tenant_id = $1 WHERE o.tenant_id = $1;'), []);
  const left = queryReport('SELECT * FROM orders o LEFT JOIN plans p ON p.id = o.plan_id AND o.tenant_id = $1;');
  assert.deepEqual(rulesOf(left), ['unscoped-query'], 'LEFT JOIN keeps every row of orders');
  assert.deepEqual(rulesOfQuery('SELECT * FROM plans p RIGHT JOIN orders o ON o.plan_id = p.id AND o.tenant_id = $1;'), ['unscoped-query'], 'RIGHT JOIN keeps every row of orders');
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o RIGHT JOIN plans p ON p.id = o.plan_id AND o.tenant_id = $1;'), [], 'RIGHT JOIN limits the left side');
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o FULL JOIN customers c ON c.tenant_id = $1 AND o.tenant_id = $1;'), ['unscoped-query', 'unscoped-query'], 'FULL JOIN keeps both');
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.tenant_id = $1 AND c.tenant_id = $1;'), [], 'WHERE limits every row');
});

test('subqueries, CTEs and derived tables are checked on their own, with the outer query as a value', () => {
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o WHERE o.tenant_id = $1 AND o.customer_id IN (SELECT id FROM customers WHERE email = $2);'), ['unscoped-query']);
  assert.match(queryReport('SELECT * FROM orders o WHERE o.tenant_id = $1 AND o.customer_id IN (SELECT id FROM customers WHERE email = $2);').findings[0].found, /^a subquery reads customers/);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o WHERE o.tenant_id = $1 AND EXISTS (SELECT 1 FROM customers c WHERE c.tenant_id = o.tenant_id AND c.id = o.customer_id);'), []);
  assert.deepEqual(rulesOfQuery('SELECT (SELECT count(*) FROM customers c WHERE c.id = o.customer_id) FROM orders o WHERE o.tenant_id = $1;'), ['unscoped-query']);
  assert.deepEqual(rulesOfQuery('WITH mine AS (SELECT * FROM orders WHERE tenant_id = $1) SELECT * FROM mine;'), []);
  const cte = queryReport('WITH all_orders AS (SELECT * FROM orders) SELECT * FROM all_orders;');
  assert.match(cte.findings[0].found, /^the CTE all_orders reads orders/);
  assert.deepEqual(rulesOfQuery('WITH mine AS (SELECT * FROM orders WHERE tenant_id = $1) SELECT * FROM mine m JOIN customers c ON c.id = m.customer_id;'), ['unscoped-join'], 'reached through a limited CTE');
  assert.deepEqual(rulesOfQuery('SELECT * FROM (SELECT * FROM orders WHERE tenant_id = $1) x JOIN customers c ON c.id = x.customer_id AND c.tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o JOIN LATERAL (SELECT * FROM customers c WHERE c.tenant_id = o.tenant_id) x ON TRUE WHERE o.tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('WITH RECURSIVE r AS (SELECT id FROM orders WHERE tenant_id = $1 UNION ALL SELECT o.id FROM orders o JOIN r ON o.customer_id = r.id) SELECT * FROM r;'), ['unscoped-join']);
  assert.deepEqual(rulesOfQuery('SELECT id FROM orders WHERE tenant_id = $1 UNION SELECT id FROM customers;'), ['unscoped-query'], 'each part of a UNION');
  assert.deepEqual(rulesOfQuery('(SELECT id FROM orders WHERE tenant_id = $1) EXCEPT (SELECT id FROM customers WHERE tenant_id = $1);'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM generate_series(1, 3) g, orders o WHERE o.tenant_id = $1;'), [], 'a table function');
});

test('EXPLAIN and PREPARE are read through, and statements that are not queries are not checked', () => {
  assert.deepEqual(rulesOfQuery('EXPLAIN ANALYZE SELECT * FROM orders;'), ['unscoped-query']);
  assert.deepEqual(rulesOfQuery('EXPLAIN (FORMAT JSON) SELECT * FROM orders;'), ['unscoped-query']);
  assert.deepEqual(rulesOfQuery('PREPARE q (int) AS SELECT * FROM orders WHERE id = $1;'), ['unscoped-query']);
  for (const s of ['CREATE VIEW v AS SELECT * FROM orders;', 'GRANT SELECT ON orders TO app;', "COMMENT ON TABLE orders IS 'x';", 'CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT count(*) FROM orders $$;', 'SET app.tenant_id = 3;']) {
    assert.deepEqual(rulesOfQuery(s), [], s);
  }
  assert.equal(queryReport('CREATE VIEW v AS SELECT * FROM orders;').summary.counts.kinds.other, 1);
});

test('insert-without-tenant: an INSERT that leaves out the tenant column, or names no columns, is an error', () => {
  const missing = queryReport('INSERT INTO orders (id, total) VALUES ($1, $2);');
  assert.deepEqual(rulesOf(missing), ['insert-without-tenant']);
  assert.equal(missing.findings[0].found, 'the INSERT into orders gives no value for tenant_id, so the new row belongs to no tenant');
  assert.deepEqual(rulesOfQuery('INSERT INTO orders (tenant_id, id, total) VALUES ($1, $2, $3);'), []);
  assert.match(queryReport('INSERT INTO orders VALUES ($1, $2);').findings[0].found, /names no columns, so the tool cannot see that it sets tenant_id; name the columns$/);
  assert.deepEqual(rulesOfQuery('INSERT INTO plans VALUES (1, $1);'), [], 'a global table');
  assert.deepEqual(rulesOfQuery('INSERT INTO orders SET tenant_id = $1, id = $2;'), [], 'the MySQL SET form');
  assert.deepEqual(rulesOfQuery('INSERT INTO orders SET id = $2;'), ['insert-without-tenant']);
  assert.deepEqual(rulesOfQuery('INSERT INTO orders DEFAULT VALUES;'), ['insert-without-tenant']);
  assert.deepEqual(rulesOfQuery('INSERT INTO orders (tenant_id, id) SELECT tenant_id, id FROM customers WHERE tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('INSERT INTO orders (tenant_id, id) SELECT tenant_id, id FROM customers;'), ['unscoped-query'], 'the SELECT is checked too');
  assert.deepEqual(rulesOfQuery('INSERT INTO orders (tenant_id, id) VALUES ($1, $2) ON CONFLICT (tenant_id, id) DO UPDATE SET total = 0;'), []);
});

test('insert-without-tenant: a tenant column with a DEFAULT may be left out', () => {
  const schema = 'CREATE TABLE events (id int, tenant_id int NOT NULL DEFAULT current_setting(\'app.tenant_id\')::int);\n';
  assert.deepEqual(rulesOf(reportOf(`${schema}INSERT INTO events (id) VALUES (1);\n`)), []);
  const later = 'CREATE TABLE events (id int, tenant_id int);\nALTER TABLE events ALTER COLUMN tenant_id SET DEFAULT 1;\nINSERT INTO events (id) VALUES (1);\n';
  assert.deepEqual(rulesOf(reportOf(later)), []);
  const dropped = 'CREATE TABLE events (id int, tenant_id int DEFAULT 1);\nALTER TABLE events ALTER COLUMN tenant_id DROP DEFAULT;\nINSERT INTO events (id) VALUES (1);\n';
  assert.deepEqual(rulesOf(reportOf(dropped)), ['insert-without-tenant']);
});

test('missing-tenant-column: a table the configuration makes a tenant table needs the column', () => {
  const sql = 'CREATE TABLE notes (id int, body text);\nCREATE TABLE plans (id int);\n';
  assert.deepEqual(rulesOf(reportOf(sql)), [], 'tenant tables from the schema: notes is not one');
  const all = reportOf(sql, { tenantTables: 'all', globalTables: ['plans'] });
  assert.deepEqual(rulesOf(all), ['missing-tenant-column']);
  assert.equal(all.findings[0].line, 1);
  assert.match(all.findings[0].found, /^notes is a tenant table \(every table but the global ones is a tenant table\), but its CREATE TABLE has no tenant_id column/);
  const listed = reportOf(sql, { tenantTables: ['notes'] });
  assert.match(listed.findings[0].found, /\(listed in tenantTables\)/);
  assert.deepEqual(rulesOf(reportOf(`${sql}ALTER TABLE notes ADD COLUMN tenant_id int;\n`, { tenantTables: ['notes'] })), [], 'added later');
  assert.deepEqual(rulesOf(reportOf('CREATE TABLE notes (tenant_id int);\nALTER TABLE notes DROP COLUMN tenant_id;\n', { tenantTables: ['notes'] })), ['missing-tenant-column'], 'dropped later');
  assert.deepEqual(rulesOf(reportOf('CREATE TABLE notes AS SELECT 1;\n', { tenantTables: ['notes'] })), [], 'columns not written out are not judged');
  assert.deepEqual(rulesOf(reportOf('CREATE TABLE notes (account_id int);\n', { tenantTables: ['notes'], tenantColumns: ['tenant_id', 'account_id'] })), [], 'another tenant column of the configuration');
});

test('unindexed-tenant-column: runs when the input makes an index, and a tenant column must lead one', () => {
  const table = 'CREATE TABLE notes (id int PRIMARY KEY, tenant_id int);\n';
  assert.deepEqual(rulesOf(reportOf(table)), [], 'no CREATE INDEX in the input');
  const r = reportOf(`${table}CREATE INDEX notes_id ON notes (id, tenant_id);\n`);
  assert.deepEqual(rulesOf(r), ['unindexed-tenant-column']);
  assert.equal(r.findings[0].level, 'warning');
  assert.match(r.findings[0].found, /^the tenant column notes\.tenant_id leads no index, primary key or unique constraint/);
  assert.deepEqual(rulesOf(reportOf(`${table}CREATE INDEX CONCURRENTLY IF NOT EXISTS notes_t ON ONLY notes USING btree (tenant_id, id);\n`)), []);
  assert.deepEqual(rulesOf(reportOf(`${table}CREATE INDEX notes_x ON notes (lower(tenant_id::text));\n`)), ['unindexed-tenant-column'], 'an expression is not the column');
  assert.deepEqual(rulesOf(reportOf('CREATE TABLE notes (tenant_id int, id int, UNIQUE (tenant_id, id));\nCREATE INDEX x ON plans (id);\n')), []);
  assert.deepEqual(rulesOf(reportOf('CREATE TABLE notes (tenant_id int PRIMARY KEY);\nCREATE INDEX x ON plans (id);\n')), []);
  assert.deepEqual(rulesOf(reportOf('CREATE TABLE notes (tenant_id int, id int, KEY notes_t (tenant_id));\nCREATE INDEX x ON plans (id);\n')), [], 'a MySQL KEY line');
  assert.deepEqual(rulesOf(reportOf(`${table}ALTER TABLE notes ADD PRIMARY KEY (tenant_id, id);\nCREATE INDEX x ON plans (id);\n`)), []);
  assert.deepEqual(rulesOf(reportOf(`${table}ALTER TABLE notes ADD INDEX notes_t (tenant_id);\n`)), [], 'ALTER TABLE ... ADD INDEX counts as making an index');
  assert.deepEqual(rulesOf(reportOf(`${table}CREATE INDEX t ON notes (tenant_id);\nALTER TABLE notes RENAME COLUMN tenant_id TO account_id;\n`, { tenantColumns: ['account_id'] })), [], 'a renamed column keeps its index');
});

test('allow markers: a reason moves the findings of the statement to the allowed list; no reason is an error', () => {
  const sql = `${SCHEMA}-- tenant-scope: allow the nightly report reads every tenant\nSELECT * FROM orders;\n`;
  const r = reportOf(sql);
  assert.deepEqual(rulesOf(r), []);
  assert.equal(r.allowed.length, 1);
  assert.equal(r.allowed[0].reason, 'the nightly report reads every tenant');
  assert.equal(r.allowed[0].markerLine, lineOf(sql, 'tenant-scope'));
  assert.equal(r.result.pass, true);
  for (const marker of ['-- tenant-scope: allow', '-- tenant-scope: allow TBD', '-- Tenant-Scope: ALLOW: n/a', '/* tenant-scope: allow - none */']) {
    const bad = reportOf(`${SCHEMA}${marker}\nSELECT * FROM orders;\n`);
    assert.deepEqual(rulesOf(bad).sort(), ['allow-without-reason', 'unscoped-query'], marker);
    assert.equal(bad.result.pass, false);
  }
  const block = reportOf(`${SCHEMA}SELECT * /* tenant-scope: allow:\n   a reason over two lines */ FROM orders;\n`);
  assert.equal(block.allowed[0].reason, 'a reason over two lines');
  const after = reportOf(`${SCHEMA}SELECT * FROM orders; -- tenant-scope: allow read on the same line\nSELECT 1;\n`);
  assert.equal(after.allowed.length, 1, 'a comment after the semicolon on its line belongs to that statement');
  assert.deepEqual(rulesOf(reportOf(`${SCHEMA}-- tenant-scope: allowed everything\nSELECT * FROM orders;\n`)), ['unscoped-query'], 'not the marker');
  assert.deepEqual(rulesOf(reportOf(`${SCHEMA}-- tenant-scope:allow fine\n-- tenant-scope: allow\nSELECT * FROM orders;\n`)), ['allow-without-reason'], 'one good marker allows; the empty one is still an error');
});

test('allow markers: a marker with nothing to allow is a notice, after the last statement too', () => {
  const r = reportOf(`${SCHEMA}-- tenant-scope: allow not needed\nSELECT * FROM orders WHERE tenant_id = $1;\n-- tenant-scope: allow nothing below\n`);
  assert.deepEqual(rulesOf(r), ['unused-allow', 'unused-allow']);
  assert.equal(r.findings[0].level, 'notice');
  assert.match(r.findings[1].found, /comes after the last statement of the file/);
  assert.equal(r.result.pass, true);
  assert.deepEqual(r.summary.markers, { total: 2, withReason: 2, withoutReason: 0, unused: 2 });
  const create = reportOf('-- tenant-scope: allow notes are shared by design\nCREATE TABLE notes (id int);\n', { tenantTables: ['notes'] });
  assert.deepEqual(rulesOf(create), []);
  assert.equal(create.allowed[0].rule, 'missing-tenant-column');
});

test('levels: a rule set to off is not reported, and a rule can be raised or lowered', () => {
  assert.deepEqual(rulesOf(queryReport('SELECT * FROM orders;', { rules: { unscopedQuery: 'off' } })), []);
  const lowered = queryReport('SELECT * FROM orders;', { rules: { unscopedQuery: 'warning' } });
  assert.equal(lowered.findings[0].level, 'warning');
  assert.equal(lowered.result.pass, true);
  const raised = queryReport('SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.tenant_id = $1;', { rules: { unscopedJoin: 'error' } });
  assert.equal(raised.result.pass, false);
  const off = reportOf(`${SCHEMA}-- tenant-scope: allow x\nSELECT 1;\n`, { rules: { unusedAllow: 'off' } });
  assert.deepEqual(rulesOf(off), []);
});

test('tenant tables: from the schema, a list, or every table but the global ones, with several tenant columns', () => {
  const sql = 'CREATE TABLE a (account_id int);\nCREATE TABLE b (id int);\nSELECT * FROM a;\nSELECT * FROM b;\nSELECT * FROM c;\n';
  assert.deepEqual(rulesOf(reportOf(sql)), [], 'no table has tenant_id');
  assert.match(reportOf(sql).notes[0], /^no tenant table: no CREATE TABLE read has a tenant_id column/);
  assert.deepEqual(rulesOf(reportOf(sql, { tenantColumns: ['tenant_id', 'account_id'] })), ['unscoped-query']);
  const listed = reportOf(sql, { tenantTables: ['b', 'c'] });
  assert.deepEqual(rulesOf(listed), ['missing-tenant-column', 'unscoped-query', 'unscoped-query']);
  assert.match(listed.notes.join('\n'), /1 tenant table of the configuration has no CREATE TABLE in the input, so its columns and indexes are not checked: c/);
  const all = reportOf(sql, { tenantTables: 'all', globalTables: ['b'], tenantColumns: ['account_id'] });
  assert.deepEqual(rulesOf(all), ['unscoped-query', 'unscoped-query'], 'a and c; b is global');
  assert.match(all.findings[1].found, /reads c with no condition on c\.account_id/);
  assert.deepEqual(rulesOf(reportOf('SELECT * FROM t WHERE org_id = $1;\n', { tenantTables: ['t'], tenantColumns: ['tenant_id', 'org_id'] })), [], 'a table with no CREATE TABLE takes any tenant column');
});

test('schema: DROP TABLE and RENAME TO change what later statements see', () => {
  assert.deepEqual(rulesOf(reportOf('CREATE TABLE t (tenant_id int);\nDROP TABLE IF EXISTS t CASCADE;\nSELECT * FROM t;\n')), []);
  assert.deepEqual(rulesOf(reportOf('CREATE TABLE t (tenant_id int);\nALTER TABLE t RENAME TO u;\nSELECT * FROM u;\n')), ['unscoped-query']);
  assert.deepEqual(rulesOf(reportOf('CREATE TABLE p (tenant_id int, id int);\nCREATE TABLE p1 PARTITION OF p FOR VALUES IN (1);\nSELECT * FROM p1;\n')), ['unscoped-query'], 'a partition has the columns of its parent');
  assert.deepEqual(rulesOf(reportOf('CREATE TABLE p (tenant_id int, id int);\nCREATE TABLE q (LIKE p);\nSELECT * FROM q;\n')), ['unscoped-query'], 'LIKE copies the columns');
  assert.deepEqual(rulesOf(reportOf('CREATE TABLE t (key text, index int, tenant_id int);\nSELECT * FROM t;\n')), ['unscoped-query'], 'columns named key and index');
});

test('statements in strings, comments and dollar quotes are not read as SQL', () => {
  assert.deepEqual(rulesOfQuery("SELECT 'SELECT * FROM orders; --' FROM orders WHERE tenant_id = $1;"), []);
  assert.deepEqual(rulesOfQuery('SELECT $q$ ; FROM orders $q$ FROM orders WHERE tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('/* SELECT * FROM orders; */ SELECT 1;'), []);
  assert.deepEqual(rulesOfQuery("SELECT E'it\\'s; FROM orders' FROM orders WHERE tenant_id = $1;"), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE tenant_id = $1 -- AND nothing;\n;'), []);
});

test('the line of a finding is the line of the table it names, in the file it is in', () => {
  const queries = 'SELECT 1;\n\nSELECT *\nFROM plans p\nJOIN orders o\n  ON o.plan_id = p.id;\n';
  const r = reportOf({ 'a.sql': SCHEMA, 'b.sql': queries });
  assert.equal(r.findings[0].file, 'b.sql');
  assert.equal(r.findings[0].line, lineOf(queries, 'orders o'));
  assert.equal(r.findings[0].at, `b.sql:${lineOf(queries, 'orders o')}`);
});

test('markers and tenancy: the marker of a comment, and the tenant tables of a schema', () => {
  const empty = ['tbd', 'none'];
  assert.deepEqual(markerOf({ text: ' tenant-scope: allow - the export job ', line: 4 }, empty), { line: 4, reason: 'the export job', empty: false });
  assert.deepEqual(markerOf({ text: '* TENANT-SCOPE: allow:TBD *', line: 1 }, empty), { line: 1, reason: 'TBD', empty: true });
  assert.equal(markerOf({ text: ' tenant-scope: allowance', line: 1 }, empty), null);
  assert.equal(markerOf({ text: ' just a comment', line: 1 }, empty), null);
  const files = [{ file: 'a.sql', ...readSql('CREATE TABLE t (tenant_id int DEFAULT 1);\nCREATE TABLE g (id int);\n') }];
  const r = analyse(files, defaultConfig());
  assert.deepEqual(r.summary.tenantTables.map((t) => t.name), ['t']);
  assert.deepEqual(r.summary.counts.kinds['create table'], 2);
  const schema = emptySchema();
  for (const s of files[0].statements) applySchema(schema, s.items, { file: 'a.sql', line: s.line, statement: s });
  const tenancy = tenancyOf(schema, defaultConfig());
  assert.equal(tenancy.isTenant('t'), true);
  assert.equal(tenancy.isTenant('g'), false);
  assert.deepEqual(tenancy.tenantColumnsOf('t'), ['tenant_id']);
  assert.deepEqual(tenancy.tenantColumnsOf('elsewhere'), ['tenant_id']);
  assert.equal(tenancy.hasDefault('t', ['tenant_id']), true);
  assert.equal(tenancy.hasDefault('g', ['tenant_id']), false);
});

test('less common forms: TABLESAMPLE, index hints, joins in parentheses, VALUES, SEARCH clauses and a WITH with no query', () => {
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders TABLESAMPLE SYSTEM (10) REPEATABLE (1) WHERE tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o USE INDEX FOR ORDER BY (PRIMARY) WHERE o.tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o FORCE KEY (PRIMARY) WHERE o.tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM (orders o JOIN customers c ON c.tenant_id = o.tenant_id AND c.id = o.customer_id) WHERE (o.tenant_id) = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE tenant_id = $1 UNION VALUES (1, 2);'), []);
  assert.deepEqual(rulesOfQuery('WITH RECURSIVE r (id) AS NOT MATERIALIZED (SELECT id FROM orders WHERE tenant_id = $1) SEARCH DEPTH FIRST BY id SET o, s AS (SELECT 1) SELECT * FROM r, s;'), []);
  assert.deepEqual(rulesOfQuery('WITH x AS (SELECT * FROM orders) SET y = 1;'), ['unscoped-query'], 'the CTE is still checked');
  assert.deepEqual(rulesOfQuery('INSERT (SELECT * FROM orders);'), ['unscoped-query'], 'an INSERT with no INTO');
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders o, LATERAL unnest(o.tags) t WHERE o.tenant_id = $1;'), []);
  assert.deepEqual(rulesOfQuery('SELECT * FROM orders WHERE (((tenant_id))) = $1;'), []);
});
