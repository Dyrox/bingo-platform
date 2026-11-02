ALTER TABLE "matches" ADD COLUMN "source" text DEFAULT 'reporter' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "partial" boolean DEFAULT false NOT NULL;