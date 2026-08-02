-- Named changelog collections ("multiple changelogs"). Entries keep working
-- with changelog_id = NULL, which means the built-in "General" changelog —
-- the backfill (NULL) therefore changes nothing for existing data. A
-- collection can optionally point at a roadmap (informational; deleting the
-- roadmap keeps the changelog). The audience trio mirrors roadmaps (0126/0127)
-- and changelog_entries (0128): honored only while is_public = false, and it
-- gates every entry in the collection IN ADDITION to the entry's own audience.
CREATE TABLE "changelogs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "roadmap_id" uuid REFERENCES "roadmaps"("id") ON DELETE SET NULL,
  "is_public" boolean DEFAULT true NOT NULL,
  "allowed_segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "allowed_team_principal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "changelogs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "changelogs_roadmap_id_idx" ON "changelogs" ("roadmap_id");
--> statement-breakpoint
CREATE INDEX "changelogs_position_idx" ON "changelogs" ("position");
--> statement-breakpoint
CREATE INDEX "changelogs_deleted_at_idx" ON "changelogs" ("deleted_at");
--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN "changelog_id" uuid REFERENCES "changelogs"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "changelog_entries_changelog_id_idx" ON "changelog_entries" ("changelog_id");
