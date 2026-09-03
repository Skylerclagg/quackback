-- Per-entry read audience for changelog entries.
--
-- NOT to be confused with the existing `segment_ids` column on this table,
-- which is publish-notification targeting (who gets emailed) and has never
-- gated reads. Before this migration the only per-entry read gate was
-- indirect, through a linked category's own segment list, so an entry with no
-- category was readable by anyone who could reach the portal.
--
-- `visibility` mirrors roadmaps' tiers exactly ('public' | 'team' | 'segment')
-- so one policy primitive serves both surfaces.
--
-- `allowed_team_principal_ids` is deliberately NULLABLE and defaults to NULL:
--   NULL  = every team actor (what every existing row means, and what upstream
--           already does today — defaulting to '[]' would silently close every
--           existing entry to everyone but admins on deploy)
--   []    = admins only
--   [ids] = admins plus the listed member-role principals
--
-- Guarded with IF NOT EXISTS so the migration replays as a no-op: a fleet
-- ledger heal re-runs the whole span.
ALTER TABLE "changelog_entries" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;
--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN IF NOT EXISTS "visible_segment_ids" jsonb;
--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN IF NOT EXISTS "allowed_team_principal_ids" jsonb;
