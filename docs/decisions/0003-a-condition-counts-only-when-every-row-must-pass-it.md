# 3. A condition counts only when every row must pass it

## Status

Accepted

## Context

A tenant condition in a query is only a guard if no row can get past it. `WHERE tenant_id = $1` guards every row;
`WHERE tenant_id = $1 OR status = 'open'` lets through the open rows of every tenant, although it holds the same
words. A LEFT JOIN keeps every row of its left side whatever its ON says, so `orders o LEFT JOIN plans p ON
p.id = o.plan_id AND o.tenant_id = $1` returns the orders of every tenant. A tool that looks for the words
`tenant_id =` anywhere in a query passes both.

The second question is a table that is joined to a guarded table on a key: `orders o JOIN customers c ON
c.id = o.customer_id WHERE o.tenant_id = $1`. Every customer row it returns is the customer of an order of the
tenant, so it leaks only when an order of one tenant points at a customer of another, which a foreign key that
starts with the tenant column rules out and a foreign key on `id` alone does not.

## Decision

1. Only conditions every row must pass count: the parts of WHERE, and of the ON of an inner join, joined by AND at the
   top. A part under OR or NOT counts for nothing. In the ON of a LEFT or RIGHT join, a condition counts only for the
   side the join does not keep whole; the ON of a FULL join counts for neither.
2. A tenant table is scoped when its tenant column is compared to a value, or tied by equality to the tenant column of
   a scoped table. A table that is not scoped at all is `unscoped-query`, an error.
3. A tenant table that is not scoped but is reached through a key from a scoped tenant table is `unscoped-join`, a
   warning. A global table passes nothing on, because its rows belong to every tenant.
4. A subquery, a CTE and each part of a set operation are blocks of their own; a column of an outer query counts as a
   value, and a CTE or subquery that is limited to one tenant counts as scoped where it is used.

## Consequences

- The common mistakes are errors even when the words `tenant_id = $1` are in the query.
- A tenant condition that each branch of an OR repeats is reported; writing it once, outside the OR, is clearer and
  passes.
- Joins on a key alone are warnings, so a team whose foreign keys start with the tenant column can lower the rule or
  tie the columns, and a team whose keys do not can raise it to an error.
