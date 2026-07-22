-- Reshape timeline visibility (0130's binary model, never released)
-- into a per-audience specificity cap: roadmaps.timeline_access holds
-- { default: 'hidden'|'year'|'quarter'|'month'|'day',
--   segments: [{ segmentId, specificity }] }.
-- A viewer takes the finest cap among the default and their matching
-- segment overrides; items are coarsened server-side to the cap
-- ("Mar 14, 2026" renders as "Q1 2026" to a quarter-capped viewer) and
-- 'hidden' removes the timeline view entirely. Team always sees full
-- specificity. Backfill 'day' (fully public dates) preserves current
-- behavior for existing roadmaps.
ALTER TABLE "roadmaps" DROP COLUMN IF EXISTS "timeline_visibility";
--> statement-breakpoint
ALTER TABLE "roadmaps" DROP COLUMN IF EXISTS "timeline_allowed_segment_ids";
--> statement-breakpoint
ALTER TABLE "roadmaps" ADD COLUMN "timeline_access" jsonb DEFAULT '{"default":"day","segments":[]}'::jsonb NOT NULL;
