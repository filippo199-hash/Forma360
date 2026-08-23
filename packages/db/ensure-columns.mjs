/**
 * ensure-columns.mjs
 *
 * Idempotent safety-net script that runs AFTER drizzle-kit migrate as part
 * of the pre-deploy command.  It directly issues the ALTER TABLE statements
 * that were added in migrations 0024 (group_ids / site_ids on invitations)
 * and 0025 (phone on user + invitations) using IF NOT EXISTS so it is always
 * safe to execute, even if those migrations already applied correctly.
 *
 * Why this exists: drizzle-kit migrate has been observed to skip migrations
 * when its internal tracking table already contains an entry for a given hash
 * even though the actual DDL was never committed to the database.  This script
 * bypasses the tracking table entirely.
 *
 * Usage (called automatically by db:migrate):
 *   node packages/db/ensure-columns.mjs
 */

// pg is a CJS package; the default import works fine in Node ESM.
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Journal-repair replay: every hand-written migration (0026+), in order.
 *
 * The Forma360-brand production database dates from the window when
 * migrations sat on disk without journal entries: drizzle's tracking table
 * records them applied while their DDL never ran. The gap covered entire
 * FreeHS-only modules (fire_*, permits, …) and stayed invisible because the
 * forma360 brand never queries those tables — until this script's later
 * ALTERs tripped over the missing relations and every deploy died.
 *
 * migrations-integrity invariant #4 exists for exactly this scenario and
 * names this database: re-applying every 0026+ migration onto an
 * already-migrated database must be a no-op (IF NOT EXISTS, DO-block
 * guards, ON CONFLICT), with one documented tolerance — a statement
 * touching a table that a LATER migration drops may fail with
 * undefined_table, because production never replays a pre-drop ALTER onto
 * a post-drop database. This block mirrors that pass 1:1 at boot, which
 * heals any silently-skipped migration, past or future, instead of
 * hand-chasing one module at a time. On a healthy database every statement
 * is a no-op; the error-code tolerance is belt and braces on top of the
 * in-file guards.
 */
const FIRST_HANDWRITTEN = '0026';
// duplicate_table / duplicate_object / duplicate_column
const DUPLICATE_ERROR_CODES = new Set(['42P07', '42710', '42701']);
const UNDEFINED_TABLE = '42P01';

try {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql') && f >= FIRST_HANDWRITTEN)
    .sort();

  // Same tolerance as migrations-integrity invariant #4: statements that
  // reference a table some migration DROPs are allowed to fail with
  // undefined_table on re-apply.
  const droppedTables = new Set();
  const fileTexts = new Map();
  for (const file of files) {
    const sqlText = await readFile(join(migrationsDir, file), 'utf8');
    fileTexts.set(file, sqlText);
    for (const m of sqlText.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z_]+)"?/gi)) {
      if (m[1] !== undefined) droppedTables.add(m[1]);
    }
  }

  for (const file of files) {
    for (const statement of fileTexts.get(file).split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      try {
        await pool.query(trimmed);
      } catch (error) {
        if (DUPLICATE_ERROR_CODES.has(error?.code)) continue;
        if (
          error?.code === UNDEFINED_TABLE &&
          [...droppedTables].some((t) => String(error.message).includes(`"${t}"`))
        ) {
          continue;
        }
        throw new Error(`replaying ${file}: ${String(error)}`);
      }
    }
  }

  await pool.query(`
    ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "group_ids" jsonb;
    ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "site_ids" jsonb;
    ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "phone" text;
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone" text;
    -- 0032: first/last name on user (To-Do #4)
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "first_name" text;
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_name" text;
    -- 0033: document-level visibility by group / site (To-Do #5)
    ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "visible_to_group_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "visible_to_site_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
    -- per-user saved views for the Actions board (To-Do #3)
    CREATE TABLE IF NOT EXISTS "action_saved_views" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "action_saved_views_user_idx" ON "action_saved_views" ("tenant_id", "user_id");
    -- WhatsApp opt-out registry (Business Messaging Policy: honour STOP/UNSUBSCRIBE)
    CREATE TABLE IF NOT EXISTS "whatsapp_opt_outs" (
      "phone" varchar(32) PRIMARY KEY NOT NULL,
      "opted_out_at" timestamptz NOT NULL DEFAULT now()
    );
    -- 0036: Sites → Sites & Projects (kind discriminator + project lifecycle)
    ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'site';
    ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "status" text;
    ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "client" text;
    ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "start_date" date;
    ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "end_date" date;
    CREATE INDEX IF NOT EXISTS "sites_tenant_kind_idx" ON "sites" ("tenant_id", "kind");
    -- 0037: Site/Project media gallery (standalone progress photos & videos)
    CREATE TABLE IF NOT EXISTS "site_media" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "site_id" varchar(26) NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
      "storage_key" text NOT NULL,
      "filename" text NOT NULL,
      "mime_type" text NOT NULL,
      "size_bytes" integer NOT NULL,
      "kind" text NOT NULL DEFAULT 'photo',
      "caption" text NOT NULL DEFAULT '',
      "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "captured_at" timestamptz,
      "uploaded_by" varchar(64) NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "archived_at" timestamptz
    );
    CREATE INDEX IF NOT EXISTS "site_media_tenant_idx" ON "site_media" ("tenant_id");
    CREATE INDEX IF NOT EXISTS "site_media_site_idx" ON "site_media" ("tenant_id", "site_id");
    -- 0038: Site/Project plans & drawings + pins (Phase 3)
    CREATE TABLE IF NOT EXISTS "site_plans" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "site_id" varchar(26) NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "storage_key" text NOT NULL,
      "mime_type" text NOT NULL,
      "kind" text NOT NULL DEFAULT 'image',
      "sort_order" integer NOT NULL DEFAULT 0,
      "uploaded_by" varchar(64) NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "archived_at" timestamptz
    );
    CREATE INDEX IF NOT EXISTS "site_plans_tenant_idx" ON "site_plans" ("tenant_id");
    CREATE INDEX IF NOT EXISTS "site_plans_site_idx" ON "site_plans" ("tenant_id", "site_id");
    CREATE TABLE IF NOT EXISTS "site_plan_pins" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "plan_id" varchar(26) NOT NULL REFERENCES "site_plans"("id") ON DELETE CASCADE,
      "site_id" varchar(26) NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
      "x" real NOT NULL,
      "y" real NOT NULL,
      "entity_type" text NOT NULL DEFAULT 'note',
      "entity_id" varchar(26),
      "label" text NOT NULL DEFAULT '',
      "created_by" varchar(64) NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "archived_at" timestamptz
    );
    CREATE INDEX IF NOT EXISTS "site_plan_pins_tenant_idx" ON "site_plan_pins" ("tenant_id");
    CREATE INDEX IF NOT EXISTS "site_plan_pins_plan_idx" ON "site_plan_pins" ("tenant_id", "plan_id");
    -- 0039: Site/Project geolocation (world-map view, Phase 4)
    ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "latitude" real;
    ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "longitude" real;
    ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "location_address" text;
    -- 0040: Groups assigned to a site/project (Team & access)
    CREATE TABLE IF NOT EXISTS "site_groups" (
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "site_id" varchar(26) NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
      "group_id" varchar(26) NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
      "added_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "site_groups_site_group_pk" PRIMARY KEY ("site_id", "group_id")
    );
    CREATE INDEX IF NOT EXISTS "site_groups_tenant_group_idx" ON "site_groups" ("tenant_id", "group_id");
    CREATE INDEX IF NOT EXISTS "site_groups_tenant_site_idx" ON "site_groups" ("tenant_id", "site_id");
    -- 0041: Library documents attached to a Heads-Up (signature workflow)
    CREATE TABLE IF NOT EXISTS "heads_up_documents" (
      "tenant_id" text NOT NULL REFERENCES "tenants"("id"),
      "heads_up_id" text NOT NULL REFERENCES "heads_ups"("id") ON DELETE CASCADE,
      "document_id" text NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
      "document_version" integer NOT NULL DEFAULT 1,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "heads_up_documents_heads_up_document_pk" PRIMARY KEY ("heads_up_id", "document_id")
    );
    CREATE INDEX IF NOT EXISTS "heads_up_documents_document_idx" ON "heads_up_documents" ("tenant_id", "document_id");
    -- 0042: Contractors module (directory + compliance documents)
    CREATE TABLE IF NOT EXISTS "contractors" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "name" text NOT NULL,
      "category" text,
      "status" text NOT NULL DEFAULT 'active',
      "primary_contact_name" text,
      "primary_contact_email" text,
      "notes" text,
      "archived_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "contractors_tenant_idx" ON "contractors" ("tenant_id");
    CREATE TABLE IF NOT EXISTS "contractor_requirements" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "contractor_id" varchar(26) NOT NULL REFERENCES "contractors"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "blocking" boolean NOT NULL DEFAULT true,
      "recurrence_months" integer,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "contractor_requirements_contractor_idx" ON "contractor_requirements" ("tenant_id", "contractor_id");
    CREATE TABLE IF NOT EXISTS "contractor_documents" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "contractor_id" varchar(26) NOT NULL REFERENCES "contractors"("id") ON DELETE CASCADE,
      "requirement_id" varchar(26) NOT NULL REFERENCES "contractor_requirements"("id") ON DELETE CASCADE,
      "storage_key" text NOT NULL,
      "filename" text NOT NULL,
      "mime_type" text NOT NULL,
      "size_bytes" integer NOT NULL DEFAULT 0,
      "start_date" date,
      "end_date" date,
      "status" text NOT NULL DEFAULT 'pending',
      "reject_reason" text,
      "uploaded_by_user_id" varchar(64),
      "verified_by_user_id" varchar(64),
      "verified_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "contractor_documents_requirement_idx" ON "contractor_documents" ("tenant_id", "requirement_id");
    CREATE INDEX IF NOT EXISTS "contractor_documents_contractor_idx" ON "contractor_documents" ("tenant_id", "contractor_id");
    -- 0043: Contractors Phase 1b (templates, public upload token, reminder stamp)
    ALTER TABLE "contractors" ADD COLUMN IF NOT EXISTS "upload_token" text;
    CREATE UNIQUE INDEX IF NOT EXISTS "contractors_upload_token_idx" ON "contractors" ("upload_token");
    ALTER TABLE "contractor_documents" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamptz;
    CREATE TABLE IF NOT EXISTS "contractor_requirement_templates" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "category" text NOT NULL,
      "name" text NOT NULL,
      "blocking" boolean NOT NULL DEFAULT true,
      "recurrence_months" integer,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "contractor_req_templates_tenant_idx" ON "contractor_requirement_templates" ("tenant_id", "category");
    -- 0044: Contractors Phase 2a (visits / calendar)
    CREATE TABLE IF NOT EXISTS "contractor_visits" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "contractor_id" varchar(26) NOT NULL REFERENCES "contractors"("id") ON DELETE CASCADE,
      "site_id" varchar(26),
      "title" text NOT NULL,
      "status" text NOT NULL DEFAULT 'scheduled',
      "scheduled_start" timestamptz NOT NULL,
      "scheduled_end" timestamptz,
      "is_walk_in" boolean NOT NULL DEFAULT false,
      "authorized_by_user_id" varchar(64) REFERENCES "user"("id") ON DELETE SET NULL,
      "checked_in_at" timestamptz,
      "checked_out_at" timestamptz,
      "notes" text,
      "created_by_user_id" varchar(64) REFERENCES "user"("id") ON DELETE SET NULL,
      "archived_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "contractor_visits_tenant_start_idx" ON "contractor_visits" ("tenant_id", "scheduled_start");
    CREATE INDEX IF NOT EXISTS "contractor_visits_contractor_idx" ON "contractor_visits" ("tenant_id", "contractor_id");
    -- 0045: Contractors Phase 2b (gate check-in)
    CREATE TABLE IF NOT EXISTS "contractor_gate_fields" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "label" text NOT NULL,
      "field_type" text NOT NULL DEFAULT 'text',
      "required" boolean NOT NULL DEFAULT false,
      "sort_order" integer NOT NULL DEFAULT 0,
      "archived_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "contractor_gate_fields_tenant_idx" ON "contractor_gate_fields" ("tenant_id", "sort_order");
    CREATE TABLE IF NOT EXISTS "contractor_visit_events" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "visit_id" varchar(26) NOT NULL REFERENCES "contractor_visits"("id") ON DELETE CASCADE,
      "contractor_id" varchar(26) NOT NULL REFERENCES "contractors"("id") ON DELETE CASCADE,
      "event_type" text NOT NULL,
      "method" text NOT NULL,
      "override_reason" text,
      "captured_fields" jsonb,
      "actor_user_id" varchar(64) REFERENCES "user"("id") ON DELETE SET NULL,
      "at" timestamptz NOT NULL DEFAULT now(),
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "contractor_visit_events_visit_idx" ON "contractor_visit_events" ("tenant_id", "visit_id");
    CREATE TABLE IF NOT EXISTS "contractor_gate_config" (
      "tenant_id" varchar(26) PRIMARY KEY NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "gate_token" text,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "contractor_gate_config_token_idx" ON "contractor_gate_config" ("gate_token");
    -- 0046: Contractors Phase 3 (contractor ↔ asset link)
    CREATE TABLE IF NOT EXISTS "contractor_assets" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "contractor_id" varchar(26) NOT NULL REFERENCES "contractors"("id") ON DELETE CASCADE,
      "asset_id" text NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
      "note" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "contractor_assets_unique" ON "contractor_assets" ("contractor_id", "asset_id");
    CREATE INDEX IF NOT EXISTS "contractor_assets_asset_idx" ON "contractor_assets" ("tenant_id", "asset_id");
    CREATE INDEX IF NOT EXISTS "contractor_assets_contractor_idx" ON "contractor_assets" ("tenant_id", "contractor_id");
    -- 0047: Contractors Phase 4 (external contractor users)
    ALTER TABLE "permission_sets" ADD COLUMN IF NOT EXISTS "external_managed" boolean NOT NULL DEFAULT false;
    ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "contractor_id" varchar(26);
    ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "contractor_activities" jsonb;
    CREATE TABLE IF NOT EXISTS "contractor_users" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
      "contractor_id" varchar(26) NOT NULL REFERENCES "contractors"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "activities" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "acknowledged_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "contractor_users_user_unique" ON "contractor_users" ("user_id");
    CREATE INDEX IF NOT EXISTS "contractor_users_contractor_idx" ON "contractor_users" ("tenant_id", "contractor_id");
    -- 0048: visitor name on visits (gate on-site board shows who is inside)
    ALTER TABLE "contractor_visits" ADD COLUMN IF NOT EXISTS "visitor_name" text;
    -- 0049: manual compliance-status override
    ALTER TABLE "contractors" ADD COLUMN IF NOT EXISTS "compliance_override" text;
    ALTER TABLE "contractors" ADD COLUMN IF NOT EXISTS "compliance_override_reason" text;
    -- 0050: overstay-alert dedupe stamp
    ALTER TABLE "contractor_visits" ADD COLUMN IF NOT EXISTS "overstay_alerted_at" timestamptz;
    -- 0051: site FK integrity — null orphans, then add ON DELETE SET NULL FKs
    -- (DO-blocks because ADD CONSTRAINT has no IF NOT EXISTS).
    UPDATE "assets" a SET "site_id" = NULL
      WHERE a."site_id" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "sites" s WHERE s."id" = a."site_id");
    UPDATE "documents" d SET "site_id" = NULL
      WHERE d."site_id" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "sites" s WHERE s."id" = d."site_id");
    UPDATE "contractor_visits" v SET "site_id" = NULL
      WHERE v."site_id" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "sites" s WHERE s."id" = v."site_id");
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_site_id_fk') THEN
        ALTER TABLE "assets" ADD CONSTRAINT "assets_site_id_fk"
          FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_site_id_fk') THEN
        ALTER TABLE "documents" ADD CONSTRAINT "documents_site_id_fk"
          FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_visits_site_id_fk') THEN
        ALTER TABLE "contractor_visits" ADD CONSTRAINT "contractor_visits_site_id_fk"
          FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS "reference_counters" (
      "tenant_id" text NOT NULL,
      "series" text NOT NULL,
      "value" integer NOT NULL DEFAULT 0,
      CONSTRAINT "reference_counters_tenant_id_series_pk" PRIMARY KEY ("tenant_id","series")
    );
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reference_counters_tenant_id_tenants_id_fk') THEN
        ALTER TABLE "reference_counters" ADD CONSTRAINT "reference_counters_tenant_id_tenants_id_fk"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
      END IF;
    END $$;
    -- Seed each tenant's counter from its current max reference number so new
    -- numbers never collide with existing ones. Idempotent (ON CONFLICT DO
    -- NOTHING), so re-running on every deploy is a no-op once seeded.
    INSERT INTO "reference_counters" ("tenant_id", "series", "value")
    SELECT "tenant_id", 'issue', COALESCE(max(CAST(substring("reference_number" FROM '[0-9]+$') AS integer)), 0)
    FROM "issues" GROUP BY "tenant_id"
    ON CONFLICT ("tenant_id", "series") DO NOTHING;
    INSERT INTO "reference_counters" ("tenant_id", "series", "value")
    SELECT "tenant_id", 'action', COALESCE(max(CAST(substring("reference_number" FROM '[0-9]+$') AS integer)), 0)
    FROM "actions" GROUP BY "tenant_id"
    ON CONFLICT ("tenant_id", "series") DO NOTHING;

    -- ── HSE evaluation fix pass ──────────────────────────────────────────
    -- 0079: a fire drill that found a problem raises a follow-up action, and
    -- the drill records which one, plus the evacuation target it was judged
    -- against.
    ALTER TABLE "fire_drills" ADD COLUMN IF NOT EXISTS "action_id" varchar(26);
    ALTER TABLE "fire_drills" ADD COLUMN IF NOT EXISTS "evacuation_target_seconds" integer;

    -- 0081: a permit acceptor who is not a platform user (BUG-05). The
    -- acceptor of a permit to work is normally the contractor doing the job.
    ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "acceptor_name" text DEFAULT '' NOT NULL;
    ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "acceptor_organisation" text DEFAULT '' NOT NULL;
    ALTER TABLE "permits" ADD COLUMN IF NOT EXISTS "acceptance_witnessed_by" text;

    -- 0080: COSHH was the only one of the three assessment modules with no
    -- signed copy, so editing an Active assessment destroyed what was
    -- attested (BUG-03). Table rather than columns, so it is created here
    -- too — same reasoning as reference_counters above.
    CREATE TABLE IF NOT EXISTS "coshh_assessment_versions" (
      "id" varchar(26) PRIMARY KEY NOT NULL,
      "tenant_id" varchar(26) NOT NULL,
      "assessment_id" varchar(26) NOT NULL,
      "version_number" integer NOT NULL,
      "content" jsonb NOT NULL,
      "signed_off_by" text NOT NULL,
      "signed_off_by_name" text,
      "signed_off_at" timestamp with time zone NOT NULL,
      "actions_created" integer DEFAULT 0 NOT NULL,
      "superseded_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'coshh_assessment_versions_tenant_id_tenants_id_fk') THEN
        ALTER TABLE "coshh_assessment_versions"
          ADD CONSTRAINT "coshh_assessment_versions_tenant_id_tenants_id_fk"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'coshh_assessment_versions_assessment_id_fk') THEN
        ALTER TABLE "coshh_assessment_versions"
          ADD CONSTRAINT "coshh_assessment_versions_assessment_id_fk"
          FOREIGN KEY ("assessment_id") REFERENCES "coshh_assessments"("id") ON DELETE CASCADE;
      END IF;
    END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS "coshh_assessment_versions_version_idx"
      ON "coshh_assessment_versions" ("assessment_id", "version_number");
    -- Exactly one current signed version, as a database fact.
    CREATE UNIQUE INDEX IF NOT EXISTS "coshh_assessment_versions_current_idx"
      ON "coshh_assessment_versions" ("assessment_id") WHERE "superseded_at" IS NULL;
    CREATE INDEX IF NOT EXISTS "coshh_assessment_versions_tenant_idx"
      ON "coshh_assessment_versions" ("tenant_id");

    -- 0082: which clock a site's printed documents are stamped in (BUG-14).
    -- Null inherits the tenant default, which falls back to APP_TIMEZONE.
    ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "timezone" text;
  `);
  process.stdout.write('[ensure-columns] OK — columns verified / added\n');
} catch (error) {
  process.stderr.write('[ensure-columns] FAILED: ' + String(error) + '\n');
  process.exit(1);
} finally {
  await pool.end();
}
