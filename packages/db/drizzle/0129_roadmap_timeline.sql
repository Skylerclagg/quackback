-- Timeline view for roadmaps. Every roadmap gains a second, date-based
-- presentation alongside the status columns:
--   - post_roadmaps grows timeline placement fields. NULL timeline_date
--     (the backfill) means "not placed on the timeline yet", so this
--     migration changes nothing visible for existing roadmaps.
--   - roadmap_milestones holds free-text timeline entries not tied to
--     any feedback post.
-- timeline_date is normalized to its bucket start (month -> 1st,
-- quarter -> first month, year -> Jan 1) with timeline_precision
-- recording how vaguely to render it ("March 2026", "Q2 2026", ...).
-- timeline_position orders items sharing a bucket, across both tables.
ALTER TABLE "post_roadmaps" ADD COLUMN "timeline_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "post_roadmaps" ADD COLUMN "timeline_precision" text;
--> statement-breakpoint
ALTER TABLE "post_roadmaps" ADD COLUMN "timeline_position" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE "roadmap_milestones" (
  "id" uuid PRIMARY KEY NOT NULL,
  "roadmap_id" uuid NOT NULL REFERENCES "roadmaps"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "timeline_date" timestamp with time zone NOT NULL,
  "timeline_precision" text DEFAULT 'month' NOT NULL,
  "timeline_position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "roadmap_milestones_roadmap_id_idx" ON "roadmap_milestones" ("roadmap_id");
--> statement-breakpoint
CREATE INDEX "roadmap_milestones_timeline_date_idx" ON "roadmap_milestones" ("timeline_date");
