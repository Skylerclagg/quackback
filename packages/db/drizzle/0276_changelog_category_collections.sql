-- Bring changelog categories up to the fork's "named changelogs" model.
--
-- Upstream's categories already provide named grouping, per-group segment
-- gating, ordering, and a many-to-many link to entries — which is a superset of
-- the fork's single-collection-per-entry. Only four things were missing:
--
--   slug        — the public URL key (/changelog?changelog=<slug>)
--   description — shown on the collection's own page
--   roadmap_id  — informational link to a roadmap; ON DELETE SET NULL, because
--                 deleting a roadmap must not delete a changelog
--   allowed_team_principal_ids — narrows a collection to specific teammates,
--                 the capability upstream has nowhere (segment-gate.ts and
--                 policy/roadmaps.ts both short-circuit on isTeamActor)
--
-- The allowlist is NULLABLE with no default, matching roadmaps and
-- changelog_entries: NULL = every team actor, [] = admins only, [ids] = admins
-- plus those principals. A '[]' default would close every existing category to
-- non-admins on deploy.
--
-- slug is nullable rather than backfilled: existing categories have no public
-- page, and inventing slugs for them would create URLs nobody linked to. The
-- service generates one when a category is first given a slug.
--
-- Guarded so a fleet ledger heal replays this as a no-op.
ALTER TABLE "changelog_categories" ADD COLUMN IF NOT EXISTS "slug" text;
--> statement-breakpoint
ALTER TABLE "changelog_categories" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "changelog_categories" ADD COLUMN IF NOT EXISTS "roadmap_id" uuid;
--> statement-breakpoint
ALTER TABLE "changelog_categories" ADD COLUMN IF NOT EXISTS "allowed_team_principal_ids" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "changelog_category_slug_unique" ON "changelog_categories" ("slug") WHERE "slug" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changelog_category_roadmap_id_idx" ON "changelog_categories" ("roadmap_id");
--> statement-breakpoint
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS. A DROP + ADD pair would be
-- recognised as replay-safe but registers as destructive DDL; a guarded block
-- adds nothing destructive and is the same shape upstream's 0260 uses.
-- @replay: guarded-by IF NOT EXISTS on pg_constraint.conname =
-- 'changelog_categories_roadmap_id_roadmaps_id_fk'; the block's only action is
-- adding that constraint, so a second run does nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'changelog_categories_roadmap_id_roadmaps_id_fk'
  ) THEN
    ALTER TABLE "changelog_categories"
      ADD CONSTRAINT "changelog_categories_roadmap_id_roadmaps_id_fk"
      FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
