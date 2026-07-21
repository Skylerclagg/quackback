-- Per-roadmap team allowlist, honored only while a roadmap is private
-- (is_public = false). Admin-role principals always see every roadmap;
-- member-role principals now see a private roadmap only when their
-- principal id is listed here. Empty array (the default and backfill)
-- means admins only — which tightens the previous behavior where every
-- team member saw every private roadmap.
ALTER TABLE "roadmaps" ADD COLUMN "allowed_team_principal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
