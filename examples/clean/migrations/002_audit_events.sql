-- The audit log takes the tenant from a setting the application makes in each transaction, so an INSERT may leave
-- tenant_id out.

CREATE TABLE audit_events (
  id uuid NOT NULL,
  action text NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE audit_events ADD COLUMN tenant_id uuid NOT NULL DEFAULT current_setting('app.tenant_id')::uuid;

CREATE INDEX audit_events_tenant_idx ON audit_events (tenant_id, id);

CREATE INDEX tasks_project_idx ON tasks (tenant_id, project_id);
