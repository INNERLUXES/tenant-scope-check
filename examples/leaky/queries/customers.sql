-- name: FindCustomer :many
SELECT id, name
FROM customers
WHERE tenant_id = $1 OR email = $2;

-- name: CustomerWithPlan :one
SELECT c.name, t.plan_code
FROM customers c
LEFT JOIN tenants t ON t.id = c.tenant_id AND c.tenant_id = $1
WHERE c.id = $2;

-- name: ImportCustomer :exec
INSERT INTO customers VALUES ($1, $2, $3, $4);
