-- Drop all compliance module tables (Phase 8 removal)
DROP TABLE IF EXISTS "compliance_certifications" CASCADE;
DROP TABLE IF EXISTS "compliance_attestations" CASCADE;
DROP TABLE IF EXISTS "compliance_evaluations" CASCADE;
DROP TABLE IF EXISTS "compliance_snapshots" CASCADE;
DROP TABLE IF EXISTS "compliance_rule_evidence" CASCADE;
DROP TABLE IF EXISTS "compliance_rules" CASCADE;
DROP TABLE IF EXISTS "compliance_frameworks" CASCADE;
