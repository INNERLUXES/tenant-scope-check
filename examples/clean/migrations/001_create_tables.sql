-- Larkspur Boards, a made-up project tracker. Every customer company is a tenant, and all tenants share one database.
-- Plans and tenants are global; every other table carries tenant_id and starts its primary key with it.

CREATE TABLE plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  seats integer NOT NULL
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  plan_code text NOT NULL REFERENCES plans (code)
);

CREATE TABLE users (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE projects (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  name text NOT NULL,
  owner_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_id) REFERENCES users (tenant_id, id)
);

CREATE TABLE tasks (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id)
);

CREATE TABLE comments (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  task_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, task_id) REFERENCES tasks (tenant_id, id)
);
