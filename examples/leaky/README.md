# A leaky set

The made-up migrations and queries of a made-up invoicing service, Brightwater Ledger, written the way a shared
database often looks after the first rush of features. It holds one problem of most kinds: an invoice read by its id
alone, a customer joined on a key with no tie between the tenant columns, a tenant condition that an OR undoes, a
tenant condition in the ON of a LEFT JOIN on the side the join keeps whole, a subquery with no tenant condition, an
UPDATE by invoice number, an INSERT that leaves the tenant column out and one that names no columns, a DELETE whose
allow marker gives no reason, a marker on a query that needs none, a table of attachments with no tenant column, and
an index that puts the tenant column second. One query that reads every tenant, the dunning job, is allowed with a
reason.
