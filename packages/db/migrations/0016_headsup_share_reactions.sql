-- Phase 5 redesign: external share link, comment/reaction toggles, emoji reactions.
--
-- 1. Three new columns on heads_ups.
-- 2. New heads_up_reactions table.

ALTER TABLE "heads_ups"
  ADD COLUMN "share_token" text,
  ADD COLUMN "allow_comments" boolean NOT NULL DEFAULT true,
  ADD COLUMN "allow_reactions" boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "heads_ups_share_token_unique" ON "heads_ups" ("share_token");

--> statement-breakpoint
CREATE TABLE "heads_up_reactions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "heads_up_id" text NOT NULL,
  "user_id" text NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "heads_up_reactions_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "heads_up_reactions_heads_up_id_heads_ups_id_fk"
    FOREIGN KEY ("heads_up_id") REFERENCES "public"."heads_ups"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "heads_up_reactions_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE UNIQUE INDEX "heads_up_reactions_unique_idx"
  ON "heads_up_reactions" ("heads_up_id", "user_id", "emoji");
--> statement-breakpoint
CREATE INDEX "heads_up_reactions_heads_up_idx"
  ON "heads_up_reactions" ("heads_up_id");
