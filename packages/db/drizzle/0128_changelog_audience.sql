-- Audience controls for changelog entries, mirroring the roadmap model
-- (0126/0127). All three columns are honored only while an entry is
-- private (is_public = false); publication state (published_at) gates
-- independently. The backfill (public, empty lists) leaves every
-- existing entry visible to everyone — this migration changes nothing
-- for current data. A private entry is visible to admins, member-role
-- principals in allowed_team_principal_ids, and portal users belonging
-- to at least one allowed_segment_ids segment.
ALTER TABLE "changelog_entries" ADD COLUMN "is_public" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN "allowed_segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN "allowed_team_principal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
