-- CUTOVER PHASE 1 — run BEFORE the upstream migrator.
--
-- Upstream migration 0199_drop_roadmap_curation.sql DROPS post_roadmaps, and
-- its own header calls the conversion "LOSSY, IRREVERSIBLE". Everything else
-- the fork added survives the upgrade untouched (verified: none of the fork's
-- 2 tables or 13 columns collides with an upstream name), so this is the only
-- data that must be captured beforehand.
--
-- Copies the curated post→roadmap membership into a plain table that upstream
-- knows nothing about, so it rides through the migration and Phase 3 can
-- rebuild the same membership as roadmap tags.
CREATE TABLE IF NOT EXISTS cutover_post_roadmaps (
  post_id uuid NOT NULL,
  roadmap_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  timeline_date timestamptz,
  timeline_precision text,
  timeline_position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, roadmap_id)
);

INSERT INTO cutover_post_roadmaps
  (post_id, roadmap_id, position, timeline_date, timeline_precision, timeline_position)
SELECT post_id, roadmap_id, position, timeline_date, timeline_precision, timeline_position
FROM post_roadmaps
ON CONFLICT (post_id, roadmap_id) DO NOTHING;

-- Same treatment for the fork's roadmap milestones: the table survives, but
-- capturing a copy costs nothing and makes Phase 3 independent of it.
CREATE TABLE IF NOT EXISTS cutover_roadmap_milestones AS
  SELECT * FROM roadmap_milestones;
