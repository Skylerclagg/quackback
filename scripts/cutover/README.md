# Fork → upstream cutover

Migrates a Quackback database created by the RECF fork (migration `0133`) onto
upstream's schema, preserving data the naive path would silently lose or expose.

Rehearsed end to end against a copy of production. Every step is guarded and
re-runnable.

## Why this exists

The fork and upstream share migration history through idx **125**, then diverge:
the fork's `0126`–`0133` are entirely different migrations from upstream's
`0126`+. Three things go wrong if you just point the new build at the old
database:

1. **The migrator silently skips migrations.** Drizzle applies journal entries
   newer than the newest `created_at` in `drizzle.__drizzle_migrations`. The
   fork's `0133` is dated 2026-08-20; upstream's `0126` and `0127` are dated
   2026-07-11 and 07-12. Those two would be skipped, and the 146 that follow
   assume the tables they create. No error — just a wrong schema.

2. **Private changelog entries become public.** Upstream has no per-entry read
   gate, so the port adds `changelog_entries.visibility`, defaulting to
   `'public'`. Both of production's entries are segment-gated today. Without
   step 4 they are world-readable the moment the app starts.

3. **A segment-restricted roadmap becomes team-only.** Upstream's `0198`
   backfills `visibility` from the fork's `is_public`, which is right for the
   public/team split but blind to the fork's `allowed_segment_ids` — so a
   roadmap shared with segments lands as `'team'`, locking out its audience.

Plus one that is lossy by upstream's own admission: `0199_drop_roadmap_curation`
**drops `post_roadmaps`**, discarding curated membership, manual ordering and
multi-roadmap placement. Its header says so. Step 1 rescues it.

## Running it

Take a backup first. These steps mutate the database in place.

```bash
export DATABASE_URL=postgresql://user:pass@host:5432/quackback
```

**1 — Extract what the upgrade destroys.** Must run BEFORE the migrator.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cutover/01-extract-pre-upgrade.sql
```

**2 — Rewind the migration ledger** to the last shared migration. Refuses to run
unless it finds exactly 134 applied migrations and removes exactly 8, so it
cannot be aimed at the wrong database.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cutover/02-rewind-ledger.sql
```

**3 — Run the upstream migrator.** Applies upstream's `0126`–`0272` plus this
port's `0273`+.

```bash
bun run db:migrate
```

**4 — Translate the audience model and rebuild roadmap membership.** Dry-run
first; it prints every change it would make and writes nothing.

```bash
bun scripts/cutover/04-transform.ts            # dry run
bun scripts/cutover/04-transform.ts --apply    # commit
```

## What step 4 does

- **Normalises `allowed_team_principal_ids`** on `roadmaps` and
  `changelog_entries`. The fork created these `NOT NULL DEFAULT '[]'`; the port
  adds them nullable. `ADD COLUMN IF NOT EXISTS` no-ops against the fork's
  existing column, so a migrated database would otherwise keep a _different
  definition_ from a clean install — and `[]` means "admins only" where `NULL`
  means "every team actor". Existing values are left alone: every fork row
  carries `[]`, which under the fork's own gate already meant admins-only for
  private resources. Rewriting them would silently widen access.
- **Fixes roadmap visibility** where the fork had segments.
- **Translates changelog visibility** from `is_public` + `allowed_segment_ids`.
- **Recreates curated roadmap membership as a tag per roadmap**, wired into
  `roadmaps.base_filter.tagIds`. Tags are many-to-many, so a post that sat on
  two roadmaps keeps both.
- **Carries the timeline across.** The fork's `roadmaps.timeline_access` (who
  sees how precise a date) is copied to the port's `roadmaps.eta_disclosure`,
  which has the same shape; the fork's `roadmap_milestones` rows survive as-is
  and only their foreign key is renamed to Drizzle's convention; any rescued
  placement that carried a timeline date lands on `posts.eta` /
  `posts.eta_precision`. Production had no timeline data, so on this database
  these are no-ops — but the script is written for the general case.
- **Turns the fork's named changelogs into collections.** The fork kept
  collections in their own `changelogs` table with entries pointing at one via
  `changelog_id`; the port models a collection as a category with a `slug`.
  Each fork collection becomes a slugged category and its entries are linked.
  Production had none, so here this only reports zero.

## What does not survive

**Manual ordering of posts on a roadmap.** The fork stored it on
`post_roadmaps.position`; upstream derives contents from `base_filter` and orders
by votes or date, with no per-(post, roadmap) row to hold an order. Production
had 19 posts hand-ordered 0–18 on "Competition Control". This was an accepted
loss, not an oversight — the original ordering is preserved in
`cutover_post_roadmaps` if it is ever needed.

## Afterwards

**Entra name write-back.** The portal asks people with no first/last name to
enter them and, for Entra accounts, writes the answer back to their own
directory profile. That uses the person's _own_ sign-in token, so the Entra
provider's **Scopes** (Admin → Settings → Authentication) must include
`User.ReadWrite` and `offline_access` alongside the existing scopes. Until an
admin adds them, names are still saved here; the write-back reports that the
provider doesn't grant permission to edit the profile.

The `cutover_*` tables and the fork's now-redundant columns (`is_public`,
`allowed_segment_ids`) are deliberately left in place as a rollback aid. Drop
them once the deployment is known good — they are inert, and nothing reads them.
