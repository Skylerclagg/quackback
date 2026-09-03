-- Roadmap timeline: vague dates, per-audience disclosure, milestones, and a
-- timeline view alongside a column roadmap.
--
-- Upstream's date roadmap buckets posts by a roadmap-level frequency and shows
-- every viewer the same bucket. This adds what the fork had on top:
--
--   posts.eta_precision      — how vaguely this post's ETA is shown (day | month
--                              | quarter | year). The eta is normalised to the
--                              start of that period on write. Defaults to
--                              'month' because that is the granularity upstream
--                              already presents every ETA at — so no existing
--                              post changes how it reads.
--   roadmaps.eta_disclosure  — per-audience cap: portal viewers can be shown
--                              "Q3 2026" where the team sees "Sept 14". Default
--                              is fully public dates, so existing roadmaps do
--                              not change.
--   roadmaps.timeline_enabled — offer a date-bucketed timeline tab on a COLUMN
--                              roadmap. Upstream made `type` exclusive; this is
--                              the additive way to give one roadmap both views
--                              without touching that check constraint.
--   roadmap_milestones       — dated free-text entries. Content, not periods:
--                              since 0199 everything on a roadmap must be a post
--                              matched by base_filter, so this is the only home
--                              for "GA launch" or "Beta closes".
--
-- roadmap_milestones matches the fork's table column-for-column, so a database
-- migrated from the fork (where it already exists) is compatible and the
-- CREATE TABLE IF NOT EXISTS is a no-op there.
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "eta_precision" text DEFAULT 'month' NOT NULL;
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD COLUMN IF NOT EXISTS "eta_disclosure" jsonb DEFAULT '{"default":"day","segments":[]}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD COLUMN IF NOT EXISTS "timeline_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roadmap_milestones" (
  "id" uuid PRIMARY KEY NOT NULL,
  "roadmap_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "timeline_date" timestamp with time zone NOT NULL,
  "timeline_precision" text DEFAULT 'month' NOT NULL,
  "timeline_position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roadmap_milestones_roadmap_id_idx" ON "roadmap_milestones" ("roadmap_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roadmap_milestones_timeline_date_idx" ON "roadmap_milestones" ("timeline_date");
--> statement-breakpoint
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS. The guard is by COLUMN rather
-- than by constraint name on purpose: a database migrated from the fork already
-- carries this foreign key under Postgres's default name
-- (roadmap_milestones_roadmap_id_fkey), and a name-based guard would add a
-- second, redundant FK there. Same shape as 0260 and 0276.
-- @replay: guarded-by IF NOT EXISTS on a pg_constraint of contype 'f' over
-- roadmap_milestones.roadmap_id; the block's only action is adding that
-- foreign key, so a second run — or a run against a fork-migrated database
-- that already has one — does nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.roadmap_milestones'::regclass
      AND c.contype = 'f'
      AND a.attname = 'roadmap_id'
  ) THEN
    ALTER TABLE "roadmap_milestones"
      ADD CONSTRAINT "roadmap_milestones_roadmap_id_roadmaps_id_fk"
      FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
