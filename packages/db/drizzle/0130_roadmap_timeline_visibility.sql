-- Per-roadmap visibility of the timeline view (the dates), independent
-- of roadmap visibility itself: 'public' (default, everyone who can see
-- the roadmap), 'segments' (team + timeline_allowed_segment_ids
-- members), or 'team' (internal only). Backfill 'public' preserves the
-- behavior every existing roadmap already has.
ALTER TABLE "roadmaps" ADD COLUMN "timeline_visibility" text DEFAULT 'public' NOT NULL;
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD COLUMN "timeline_allowed_segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
