-- External changelog sources: sites Quackback imports releases from (e.g. a
-- product's VitePress changelog page), one changelog entry per release.
-- Additive and replay-safe.
CREATE TABLE IF NOT EXISTS "changelog_sources" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "kind" text DEFAULT 'vitepress' NOT NULL,
  "category_id" uuid,
  "visibility" text DEFAULT 'public' NOT NULL,
  "publish_as" text DEFAULT 'published' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by_principal_id" uuid,
  "last_run_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "changelog_sources_enabled_idx" ON "changelog_sources" ("enabled");

-- Which source and release an imported entry came from; the importer upserts
-- on this pair, so a re-run never creates a duplicate.
ALTER TABLE "changelog_entries" ADD COLUMN IF NOT EXISTS "source_id" uuid;
ALTER TABLE "changelog_entries" ADD COLUMN IF NOT EXISTS "source_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "changelog_entries_source_key_unique"
  ON "changelog_entries" ("source_id", "source_key") WHERE "source_id" IS NOT NULL;

-- Guarded so a fleet ledger heal replays this as a no-op.
-- @replay: guarded-by IF NOT EXISTS on pg_constraint.conname =
--   'changelog_sources_category_id_changelog_categories_id_fk'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'changelog_sources_category_id_changelog_categories_id_fk'
  ) THEN
    ALTER TABLE "changelog_sources"
      ADD CONSTRAINT "changelog_sources_category_id_changelog_categories_id_fk"
      FOREIGN KEY ("category_id") REFERENCES "public"."changelog_categories"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
