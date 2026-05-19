-- Phase 5: Heads Up (5A) + Assets & Maintenance (5B) + Documents (5C)
-- Forward-only migration — never edit once on main.

-- ─── 5A: Heads Up ────────────────────────────────────────────────────────────

CREATE TABLE heads_ups (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  engagement_level text NOT NULL DEFAULT 'view',
  require_acknowledgement boolean NOT NULL DEFAULT false,
  require_signature boolean NOT NULL DEFAULT false,
  publish_at timestamptz,
  expires_at timestamptz,
  linked_document_id text,
  created_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX heads_ups_tenant_id_idx ON heads_ups(tenant_id);
CREATE INDEX heads_ups_tenant_status_idx ON heads_ups(tenant_id, status);

CREATE TABLE heads_up_recipients (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  heads_up_id text NOT NULL REFERENCES heads_ups(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id),
  viewed_at timestamptz,
  acknowledged_at timestamptz,
  signed_at timestamptz,
  signature_data text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX heads_up_recipients_unique_idx ON heads_up_recipients(heads_up_id, user_id);
CREATE INDEX heads_up_recipients_heads_up_idx ON heads_up_recipients(heads_up_id);
CREATE INDEX heads_up_recipients_user_idx ON heads_up_recipients(user_id);

CREATE TABLE heads_up_attachments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  heads_up_id text NOT NULL REFERENCES heads_ups(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  uploaded_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX heads_up_attachments_heads_up_idx ON heads_up_attachments(heads_up_id);

CREATE TABLE heads_up_comments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  heads_up_id text NOT NULL REFERENCES heads_ups(id) ON DELETE CASCADE,
  author_user_id text NOT NULL REFERENCES "user"(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX heads_up_comments_heads_up_idx ON heads_up_comments(heads_up_id);

-- ─── 5B: Assets & Maintenance ────────────────────────────────────────────────

CREATE TABLE asset_types (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  custom_fields jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX asset_types_tenant_idx ON asset_types(tenant_id);

CREATE TABLE assets (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  type_id text REFERENCES asset_types(id),
  site_id text,
  parent_id text REFERENCES assets(id),
  photo_key text,
  custom_field_values jsonb NOT NULL DEFAULT '{}',
  qr_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX assets_tenant_idx ON assets(tenant_id);
CREATE INDEX assets_tenant_type_idx ON assets(tenant_id, type_id);
CREATE INDEX assets_tenant_site_idx ON assets(tenant_id, site_id);
CREATE INDEX assets_parent_idx ON assets(parent_id);

CREATE TABLE asset_readings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual',
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_by_user_id text REFERENCES "user"(id)
);
CREATE INDEX asset_readings_asset_idx ON asset_readings(asset_id, captured_at DESC);

CREATE TABLE maintenance_plans (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  plan_type text NOT NULL DEFAULT 'time',
  interval_days integer,
  interval_usage numeric,
  usage_field text,
  usage_unit text NOT NULL DEFAULT '',
  last_service_date date,
  last_service_value numeric,
  notification_days_before jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX maintenance_plans_tenant_idx ON maintenance_plans(tenant_id);

CREATE TABLE maintenance_plan_assets (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES maintenance_plans(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  last_service_date date,
  last_service_value numeric,
  UNIQUE(plan_id, asset_id)
);
CREATE INDEX maintenance_plan_assets_plan_idx ON maintenance_plan_assets(plan_id);
CREATE INDEX maintenance_plan_assets_asset_idx ON maintenance_plan_assets(asset_id);

-- ─── 5C: Documents ───────────────────────────────────────────────────────────

CREATE TABLE document_folders (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  parent_id text REFERENCES document_folders(id),
  created_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_folders_tenant_idx ON document_folders(tenant_id);
CREATE INDEX document_folders_parent_idx ON document_folders(parent_id);

CREATE TABLE documents (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  folder_id text REFERENCES document_folders(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  storage_key text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  site_id text,
  labels jsonb NOT NULL DEFAULT '[]',
  freshness_days integer,
  current_version integer NOT NULL DEFAULT 1,
  uploaded_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX documents_tenant_idx ON documents(tenant_id);
CREATE INDEX documents_folder_idx ON documents(folder_id);
CREATE INDEX documents_tenant_site_idx ON documents(tenant_id, site_id);

CREATE TABLE document_versions (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(id),
  version integer NOT NULL,
  storage_key text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  uploaded_by_user_id text NOT NULL REFERENCES "user"(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX document_versions_unique_idx ON document_versions(document_id, version);
CREATE INDEX document_versions_document_idx ON document_versions(document_id, version DESC);

CREATE TABLE document_access (
  id text PRIMARY KEY,
  document_id text REFERENCES documents(id) ON DELETE CASCADE,
  folder_id text REFERENCES document_folders(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(id),
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  permission text NOT NULL,
  granted_by_user_id text NOT NULL REFERENCES "user"(id),
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_access_document_idx ON document_access(document_id);
CREATE INDEX document_access_folder_idx ON document_access(folder_id);
CREATE INDEX document_access_subject_idx ON document_access(tenant_id, subject_type, subject_id);
