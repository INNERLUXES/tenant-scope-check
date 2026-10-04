-- name: OverdueInvoices :many
-- tenant-scope: allow the dunning job reads the overdue invoices of every tenant, under its own database role
SELECT tenant_id, id, customer_id
FROM invoices
WHERE status = 'overdue';

-- name: PurgeOldPayments :exec
-- tenant-scope: allow TBD
DELETE FROM payments WHERE received_at < now() - interval '7 years';
