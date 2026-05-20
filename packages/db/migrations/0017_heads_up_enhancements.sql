ALTER TABLE "heads_up_recipients" ADD COLUMN "reminder_last_sent_at" timestamp with time zone;
ALTER TABLE "heads_ups" ADD COLUMN "recipient_spec" text;
