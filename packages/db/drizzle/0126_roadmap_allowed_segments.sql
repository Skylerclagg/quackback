-- Per-roadmap segment allowlist, honored only while a roadmap is
-- private (is_public = false). Empty array (the default, and the value
-- backfilled onto every existing row) keeps a private roadmap
-- team-only — so this migration changes nothing for existing roadmaps.
-- A non-empty list additionally shows the private roadmap to portal
-- users belonging to at least one listed segment.
ALTER TABLE "roadmaps" ADD COLUMN "allowed_segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
