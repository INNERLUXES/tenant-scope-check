-- The tenant column comes second, so a query that filters on tenant_id alone cannot use the index well.
CREATE INDEX invoices_customer_idx ON invoices (customer_id, tenant_id);

ALTER TABLE customers ADD COLUMN email text;
