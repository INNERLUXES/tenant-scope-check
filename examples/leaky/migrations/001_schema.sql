-- Brightwater Ledger, a made-up invoicing service. Every customer business is a tenant, and all tenants share one
-- database.

CREATE TABLE plans (
  code text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  plan_code text NOT NULL REFERENCES plans (code)
);

CREATE TABLE customers (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  customer_id uuid NOT NULL,
  number text NOT NULL,
  status text NOT NULL,
  total numeric(12, 2) NOT NULL
);

CREATE TABLE invoice_lines (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  description text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE payments (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount numeric(12, 2) NOT NULL,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Files sent with an invoice. Added in a hurry: no tenant column.
CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL,
  file_name text NOT NULL
);
