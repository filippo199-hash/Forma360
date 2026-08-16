-- NR3-10: a fire marshal who is not a platform user.
--
-- The marshal picker deliberately refused free text ("marshals need an
-- account — training matrix, coverage maths") while the PEEP person, PEEP
-- buddy and FRA assessor pickers all accept a typed name. Practitioners
-- run buildings where the day marshal is a concierge or a contractor with
-- no seat, so the account requirement forced either a wrong name or an
-- empty register. Reversal is deliberate and carries a cost that stays
-- visible: a free-text marshal can never be training-matrix backed, so on
-- a tenant that has designated marshal tickets (FS-X01) their competence
-- reads unbacked/not-trained until they get an account.
ALTER TABLE "fire_marshals" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "fire_marshals" ADD COLUMN IF NOT EXISTS "person_name" text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- Every marshal row names somebody: an account id, a typed name, or both.
ALTER TABLE "fire_marshals" ADD CONSTRAINT "fire_marshals_person_check" CHECK ("user_id" IS NOT NULL OR "person_name" <> '');
