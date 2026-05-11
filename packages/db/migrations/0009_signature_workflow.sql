CREATE TABLE "inspection_workflow_signers" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"inspection_id" varchar(26) NOT NULL,
	"position" integer NOT NULL,
	"signer_user_id" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"signed_at" timestamp with time zone,
	"signature_data" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_workflow_signers_status_chk" CHECK ("status" IN ('pending','signed','declined'))
);
--> statement-breakpoint
ALTER TABLE "inspection_workflow_signers" ADD CONSTRAINT "inspection_workflow_signers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_workflow_signers" ADD CONSTRAINT "inspection_workflow_signers_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_workflow_signers" ADD CONSTRAINT "inspection_workflow_signers_signer_user_id_user_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspection_workflow_signers_inspection_idx" ON "inspection_workflow_signers" USING btree ("inspection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_workflow_signers_position_uq" ON "inspection_workflow_signers" USING btree ("inspection_id","position");--> statement-breakpoint
CREATE INDEX "inspection_workflow_signers_pending_idx" ON "inspection_workflow_signers" USING btree ("signer_user_id") WHERE "status" = 'pending';
