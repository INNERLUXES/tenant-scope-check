-- name: GetInvoice :one
SELECT * FROM invoices WHERE id = $1;

-- name: InvoicesWithCustomer :many
SELECT i.number, i.total, c.name
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE i.tenant_id = $1;

-- name: InvoicesOfCustomerByEmail :many
SELECT i.number, i.total
FROM invoices i
WHERE i.tenant_id = $1
  AND i.customer_id IN (SELECT id FROM customers WHERE email = $2);

-- name: VoidInvoice :exec
UPDATE invoices SET status = 'void' WHERE number = $1;

-- name: AddInvoiceLine :exec
INSERT INTO invoice_lines (id, invoice_id, description, amount)
VALUES ($1, $2, $3, $4);

-- name: MarkPaid :exec
-- tenant-scope: allow payments are written by the bank import
UPDATE invoices SET status = 'paid' WHERE tenant_id = $1 AND id = $2;
