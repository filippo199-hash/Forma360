-- Phase 8: Compliance
-- Forward-only. Never edit once on main.

CREATE TABLE compliance_frameworks (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'custom',
  owner_user_id text REFERENCES "user"(id),
  applicable_sites jsonb NOT NULL DEFAULT '[]',
  target_score numeric,
  created_by_user_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX compliance_frameworks_tenant_idx ON compliance_frameworks(tenant_id);
CREATE INDEX compliance_frameworks_tenant_status_idx ON compliance_frameworks(tenant_id) WHERE archived_at IS NULL;

CREATE TABLE compliance_rules (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  framework_id text NOT NULL REFERENCES compliance_frameworks(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  clause_ref text NOT NULL DEFAULT '',
  frequency text NOT NULL DEFAULT 'monthly',
  frequency_days integer,
  applicable_sites jsonb,
  responsible_user_id text REFERENCES "user"(id),
  due_soon_days integer NOT NULL DEFAULT 7,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compliance_rules_framework_idx ON compliance_rules(framework_id);
CREATE INDEX compliance_rules_tenant_idx ON compliance_rules(tenant_id);

CREATE TABLE compliance_rule_evidence (
  id text PRIMARY KEY,
  rule_id text NOT NULL REFERENCES compliance_rules(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(id),
  evidence_type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compliance_rule_evidence_rule_idx ON compliance_rule_evidence(rule_id);

CREATE TABLE compliance_evaluations (
  id text PRIMARY KEY,
  rule_id text NOT NULL REFERENCES compliance_rules(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(id),
  status text NOT NULL,
  evidence_summary jsonb NOT NULL DEFAULT '[]',
  period_start timestamptz,
  period_end timestamptz,
  evaluated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compliance_evaluations_rule_idx ON compliance_evaluations(rule_id, evaluated_at DESC);
CREATE INDEX compliance_evaluations_tenant_idx ON compliance_evaluations(tenant_id);

CREATE TABLE compliance_snapshots (
  id text PRIMARY KEY,
  framework_id text NOT NULL REFERENCES compliance_frameworks(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(id),
  snapshotted_at date NOT NULL,
  score_pct numeric NOT NULL DEFAULT 0,
  total_rules integer NOT NULL DEFAULT 0,
  compliant_count integer NOT NULL DEFAULT 0,
  due_soon_count integer NOT NULL DEFAULT 0,
  non_compliant_count integer NOT NULL DEFAULT 0,
  not_evaluable_count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX compliance_snapshots_unique_idx ON compliance_snapshots(framework_id, snapshotted_at);
CREATE INDEX compliance_snapshots_tenant_idx ON compliance_snapshots(tenant_id);
