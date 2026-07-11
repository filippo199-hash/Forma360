CREATE TABLE IF NOT EXISTS "heads_up_documents" (
	"tenant_id" text NOT NULL,
	"heads_up_id" text NOT NULL,
	"document_id" text NOT NULL,
	"document_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "heads_up_documents_heads_up_document_pk" PRIMARY KEY("heads_up_id","document_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "heads_up_documents" ADD CONSTRAINT "heads_up_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "heads_up_documents" ADD CONSTRAINT "heads_up_documents_heads_up_id_heads_ups_id_fk" FOREIGN KEY ("heads_up_id") REFERENCES "heads_ups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "heads_up_documents" ADD CONSTRAINT "heads_up_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heads_up_documents_document_idx" ON "heads_up_documents" ("tenant_id","document_id");
