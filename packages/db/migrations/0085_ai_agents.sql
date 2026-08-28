-- AI Agents: per-tenant agent customization + uploaded knowledge documents.
-- Agent definitions are code; these tables hold only what a company may
-- customize (ADR 0002 tenant scoping — one company's rows are unreachable
-- from another).
CREATE TABLE IF NOT EXISTS "ai_agent_settings" (
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "agent_id" varchar(64) NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "knowledge" text NOT NULL DEFAULT '',
  "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" text REFERENCES "user"("id") ON DELETE set null,
  CONSTRAINT "ai_agent_settings_tenant_id_agent_id_pk" PRIMARY KEY ("tenant_id", "agent_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_agent_knowledge_files" (
  "id" varchar(26) PRIMARY KEY,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "agent_id" varchar(64) NOT NULL,
  "filename" text NOT NULL,
  "storage_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "extracted_text" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'ready',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text REFERENCES "user"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_knowledge_files_tenant_agent_idx" ON "ai_agent_knowledge_files" ("tenant_id", "agent_id");
