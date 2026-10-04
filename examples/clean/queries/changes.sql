-- name: CloseTask :exec
UPDATE tasks SET status = 'done' WHERE tenant_id = $1 AND id = $2;

-- name: DeleteComment :exec
DELETE FROM comments WHERE tenant_id = $1 AND id = $2 AND author_id = $3;

-- name: AddComment :exec
INSERT INTO comments (tenant_id, id, task_id, author_id, body)
VALUES ($1, $2, $3, $4, $5);

-- name: RecordEvent :exec
INSERT INTO audit_events (id, action) VALUES ($1, $2);

-- name: TasksPerTenant :many
-- tenant-scope: allow the billing job counts the tasks of every tenant, and runs only under the billing role
SELECT tenant_id, count(*) AS tasks
FROM tasks
GROUP BY tenant_id;
