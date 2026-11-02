CREATE TABLE "match_events" (
	"match_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"t_ms" integer NOT NULL,
	"type" text NOT NULL,
	"team_id" text NOT NULL,
	"player_uuid" uuid,
	"objective_id" text,
	"value" integer,
	CONSTRAINT "match_events_match_id_seq_pk" PRIMARY KEY("match_id","seq")
);
--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;