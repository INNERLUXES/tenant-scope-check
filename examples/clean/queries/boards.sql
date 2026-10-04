-- name: ListProjects :many
SELECT p.id, p.name, u.name AS owner
FROM projects p
JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.owner_id
WHERE p.tenant_id = $1
ORDER BY p.name;

-- name: OpenTasks :many
SELECT t.id, t.title
FROM tasks t
WHERE t.tenant_id = $1
  AND t.project_id = $2
  AND (t.status = 'open' OR t.status = 'blocked');

-- name: TaskWithComments :many
WITH task AS (
  SELECT id, title FROM tasks WHERE tenant_id = $1 AND id = $2
)
SELECT task.title, c.body
FROM task
LEFT JOIN comments c ON c.task_id = task.id AND c.tenant_id = $1;

-- name: SearchTasks :many
SELECT t.id, t.title
FROM tasks t
WHERE t.tenant_id = $1
  AND EXISTS (
    SELECT 1 FROM comments c
    WHERE c.tenant_id = t.tenant_id AND c.task_id = t.id AND c.body ILIKE '%' || $2 || '%'
  );

-- name: PlanOfTenant :one
SELECT p.name, p.seats
FROM tenants t
JOIN plans p ON p.code = t.plan_code
WHERE t.id = $1;
