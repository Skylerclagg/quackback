-- Team-only tags. An internal tag (e.g. the "Roadmap: <name>" tags that carry
-- curated roadmap membership) is never offered to portal users, never listed in
-- public filters, and cannot be set on a public submission. Additive; the
-- default keeps every existing tag public.
ALTER TABLE "post_tags" ADD COLUMN IF NOT EXISTS "internal" boolean DEFAULT false NOT NULL;
