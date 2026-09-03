/**
 * CUTOVER PHASE 4 — run AFTER the upstream migrator.
 *
 * Translates the fork's audience model onto upstream's, and rebuilds the
 * curated roadmap membership that upstream's 0199 deliberately discarded.
 *
 * Why this is a script rather than a migration: it reads columns that exist
 * only on a database that came from the fork, so it must never run as part of
 * the normal migration chain. It is idempotent — safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... bun scripts/cutover/04-transform.ts [--apply]
 *
 * Without --apply it reports what it WOULD do and changes nothing.
 */
// Relative rather than the workspace alias: scripts/cutover has no package.json,
// so bun resolves it from disk instead.
import { createId, fromUuid, toUuid } from '../../packages/ids/src/index'
// oxlint-disable-next-line no-restricted-imports
import postgres from 'postgres'

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')

const sql = postgres(DATABASE_URL, { max: 2, prepare: false })
const log = (...args: unknown[]) => console.log(APPLY ? '[apply]' : '[dry-run]', ...args)

async function main() {
  // ---------------------------------------------------------------------
  // 1. Normalise the team-allowlist columns.
  //
  // The fork created these as `jsonb NOT NULL DEFAULT '[]'`. The upstream-side
  // migration adds them as nullable with no default, but `ADD COLUMN IF NOT
  // EXISTS` no-ops against the fork's existing column — so without this step a
  // migrated database keeps the fork's definition and diverges from a clean
  // install. `[]` means "admins only" and NULL means "every team actor", so
  // the default a NEW roadmap inherits differs between the two, which is
  // exactly the kind of drift nobody notices until someone is locked out.
  //
  // Existing VALUES are deliberately left alone: every fork row carries `[]`,
  // and under the fork's own gate that already meant admins-only for private
  // resources. Rewriting them to NULL here would silently widen access.
  // ---------------------------------------------------------------------
  for (const table of ['roadmaps', 'changelog_entries']) {
    const [col] = await sql`
      SELECT is_nullable, column_default FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = 'allowed_team_principal_ids'
    `
    if (!col) {
      log(`${table}.allowed_team_principal_ids: absent, skipping`)
      continue
    }
    if (col.is_nullable === 'YES' && col.column_default === null) {
      log(`${table}.allowed_team_principal_ids: already normalised`)
      continue
    }
    log(`${table}.allowed_team_principal_ids: dropping NOT NULL + '[]' default`)
    if (APPLY) {
      await sql.unsafe(
        `ALTER TABLE "${table}" ALTER COLUMN "allowed_team_principal_ids" DROP DEFAULT`
      )
      await sql.unsafe(
        `ALTER TABLE "${table}" ALTER COLUMN "allowed_team_principal_ids" DROP NOT NULL`
      )
    }
  }

  // ---------------------------------------------------------------------
  // 2. Roadmap audience.
  //
  // Upstream's 0198 already backfilled `visibility` from the fork's
  // `is_public`, which is right for the public/team split but blind to the
  // fork's `allowed_segment_ids` — so a roadmap restricted to segments landed
  // as 'team', locking out exactly the audience it was shared with.
  // ---------------------------------------------------------------------
  const roadmapFix = await sql`
    SELECT id, name, allowed_segment_ids, visibility
    FROM roadmaps
    WHERE jsonb_array_length(coalesce(allowed_segment_ids, '[]'::jsonb)) > 0
      AND visibility <> 'segment'
  `
  for (const r of roadmapFix) {
    log(
      `roadmap "${r.name}": visibility ${r.visibility} -> segment (${r.allowed_segment_ids.length} segments)`
    )
  }
  if (APPLY && roadmapFix.length > 0) {
    await sql`
      UPDATE roadmaps SET visibility = 'segment', visible_segment_ids = allowed_segment_ids
      WHERE jsonb_array_length(coalesce(allowed_segment_ids, '[]'::jsonb)) > 0
        AND visibility <> 'segment'
    `
  }

  // ---------------------------------------------------------------------
  // 3. Changelog audience.
  //
  // Nothing upstream backfills this one: `changelog_entries.visibility` is a
  // column this port adds, and it defaults to 'public'. Left untranslated,
  // every private fork entry becomes world-readable — the entries here are
  // gated to segments today, so this step is the difference between private
  // and published.
  // ---------------------------------------------------------------------
  const clFix = await sql`
    SELECT id, title, is_public, allowed_segment_ids, visibility
    FROM changelog_entries
  `
  for (const c of clFix) {
    const target = c.is_public
      ? 'public'
      : (c.allowed_segment_ids?.length ?? 0) > 0
        ? 'segment'
        : 'team'
    if (target !== c.visibility) {
      log(`changelog "${String(c.title).slice(0, 40)}": ${c.visibility} -> ${target}`)
    }
  }
  if (APPLY) {
    await sql`
      UPDATE changelog_entries SET
        visibility = CASE
          WHEN is_public THEN 'public'
          WHEN jsonb_array_length(coalesce(allowed_segment_ids, '[]'::jsonb)) > 0 THEN 'segment'
          ELSE 'team' END,
        visible_segment_ids = CASE
          WHEN NOT is_public AND jsonb_array_length(coalesce(allowed_segment_ids, '[]'::jsonb)) > 0
          THEN allowed_segment_ids ELSE NULL END
    `
  }

  // ---------------------------------------------------------------------
  // 4. Rebuild curated roadmap membership as tags.
  //
  // Upstream derives a roadmap's contents from `base_filter`, which selects by
  // status/board/tag/segment — there is no "these specific posts" option. A tag
  // per roadmap reproduces arbitrary membership exactly, including a post that
  // sat on two roadmaps, because tags are many-to-many.
  //
  // Manual ordering does NOT survive: upstream orders by votes/date. That was
  // an accepted loss, not an oversight.
  // ---------------------------------------------------------------------
  const placements = await sql`
    SELECT c.roadmap_id, r.name AS roadmap_name, count(*)::int AS posts
    FROM cutover_post_roadmaps c
    JOIN roadmaps r ON r.id = c.roadmap_id
    GROUP BY c.roadmap_id, r.name ORDER BY r.name
  `
  for (const p of placements) {
    const tagName = `Roadmap: ${p.roadmap_name}`
    const [existing] =
      await sql`SELECT id FROM post_tags WHERE name = ${tagName} AND deleted_at IS NULL`
    log(
      `roadmap "${p.roadmap_name}": ${p.posts} posts -> tag "${tagName}"${existing ? ' (exists)' : ''}`
    )

    if (!APPLY) continue

    let tagUuid: string = existing?.id
    if (!tagUuid) {
      // createId returns the TypeID; the column stores its uuid payload.
      const typeId = createId('post_tag')
      const [row] = await sql`
        INSERT INTO post_tags (id, name, description)
        VALUES (${toUuid(typeId)}, ${tagName}, 'Created at cutover to preserve curated roadmap membership.')
        RETURNING id
      `
      tagUuid = row.id
    }

    await sql`
      INSERT INTO post_tag_assignments (post_id, tag_id)
      SELECT c.post_id, ${tagUuid} FROM cutover_post_roadmaps c
      WHERE c.roadmap_id = ${p.roadmap_id}
      ON CONFLICT (post_id, tag_id) DO NOTHING
    `

    // base_filter.tagIds carries the TypeID string, not the raw uuid.
    const tagTypeId = fromUuid('post_tag', tagUuid)
    await sql`
      UPDATE roadmaps
      SET base_filter = jsonb_set(
        coalesce(base_filter, '{}'::jsonb), '{tagIds}',
        coalesce(base_filter->'tagIds', '[]'::jsonb) || ${sql.json([tagTypeId])}::jsonb, true)
      WHERE id = ${p.roadmap_id}
        AND NOT coalesce(base_filter->'tagIds', '[]'::jsonb) @> ${sql.json([tagTypeId])}::jsonb
    `
  }

  // ---------------------------------------------------------------------
  // 5. Timeline.
  //
  // The fork stored per-audience date disclosure at roadmaps.timeline_access,
  // in exactly the shape the port's roadmaps.eta_disclosure uses; copy it so a
  // roadmap that hid or coarsened its dates keeps doing so. The fork's
  // roadmap_milestones table survives with its rows, but its foreign key carries
  // Postgres's default name; renaming it to Drizzle's keeps a future drift check
  // against a production-derived database clean. Rescued placements that had a
  // timeline date land on posts.eta so a scheduled post stays scheduled.
  // ---------------------------------------------------------------------
  const [hasTimelineAccess] = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roadmaps' AND column_name = 'timeline_access'
  `
  if (hasTimelineAccess) {
    const rows = await sql`
      SELECT id, name FROM roadmaps
      WHERE timeline_access IS NOT NULL AND timeline_access::text <> eta_disclosure::text
    `
    for (const r of rows) log(`roadmap "${r.name}": eta_disclosure <- fork timeline_access`)
    if (APPLY && rows.length > 0) {
      await sql`UPDATE roadmaps SET eta_disclosure = timeline_access WHERE timeline_access IS NOT NULL`
    }
  } else {
    log('roadmaps.timeline_access absent (not a fork database); skipping disclosure copy')
  }

  const [forkFk] = await sql`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.roadmap_milestones'::regclass AND contype = 'f'
      AND conname <> 'roadmap_milestones_roadmap_id_roadmaps_id_fk'
  `
  if (forkFk) {
    log(`roadmap_milestones FK "${forkFk.conname}" -> roadmap_milestones_roadmap_id_roadmaps_id_fk`)
    if (APPLY) {
      await sql.unsafe(
        `ALTER TABLE "roadmap_milestones" RENAME CONSTRAINT "${forkFk.conname}" TO "roadmap_milestones_roadmap_id_roadmaps_id_fk"`
      )
    }
  }

  const dated = await sql`
    SELECT post_id, timeline_date, timeline_precision
    FROM cutover_post_roadmaps WHERE timeline_date IS NOT NULL
  `
  log(`${dated.length} rescued placement(s) carry a timeline date -> posts.eta / eta_precision`)
  if (APPLY) {
    for (const d of dated) {
      await sql`
        UPDATE posts SET eta = ${d.timeline_date}, eta_precision = ${d.timeline_precision ?? 'day'}
        WHERE id = ${d.post_id} AND eta IS NULL
      `
    }
  }

  // ── Phase 6: the fork's named changelogs ("collections") → slugged categories
  // Entries follow via their changelog_id. Production had none, so on this
  // database the phase only reports zero — but it is written for the general
  // case. The fork's roadmap link is a bare uuid that predates typeids, so it
  // cannot be mapped and is dropped with a note rather than guessed.
  const [{ t: collectionsTable }] = await sql`SELECT to_regclass('public.changelogs') AS t`
  if (collectionsTable) {
    const collections = await sql`
      SELECT id, slug, name, description, roadmap_id, is_public,
             allowed_segment_ids, allowed_team_principal_ids, position
      FROM changelogs WHERE deleted_at IS NULL ORDER BY position, created_at
    `
    log(`${collections.length} fork changelog collection(s) -> slugged categories`)
    for (const c of collections) {
      const [existing] = await sql`SELECT id FROM changelog_categories WHERE slug = ${c.slug}`
      let categoryId: string = existing?.id
      if (!categoryId) {
        categoryId = createId('changelog_category')
        if (c.roadmap_id)
          log(`  "${c.slug}": roadmap link ${c.roadmap_id} dropped (pre-typeid uuid)`)
        if (APPLY) {
          await sql`
            INSERT INTO changelog_categories
              (id, name, color, slug, description, roadmap_id, segment_ids, allowed_team_principal_ids, position)
            VALUES (${categoryId}, ${c.name}, '#6b7280', ${c.slug}, ${c.description}, NULL,
                    ${sql.json(c.is_public ? [] : (c.allowed_segment_ids ?? []))},
                    ${c.allowed_team_principal_ids == null ? null : sql.json(c.allowed_team_principal_ids)},
                    ${c.position ?? 0})
          `
        }
      }
      const entries = await sql`SELECT id FROM changelog_entries WHERE changelog_id = ${c.id}`
      log(`  "${c.slug}": ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} linked`)
      if (APPLY) {
        for (const e of entries) {
          await sql`
            INSERT INTO changelog_entry_categories (category_id, changelog_entry_id)
            VALUES (${categoryId}, ${e.id}) ON CONFLICT DO NOTHING
          `
        }
      }
    }
  }

  // ── Phase 7: placeholder display names → given + family
  // Entra External ID hands self-service sign-ups the literal displayName
  // "unknown". Where the parts exist, the display name is rebuilt from them;
  // the principal's cached copy follows when that column exists.
  const placeholders = await sql`
    SELECT id, name, given_name, family_name FROM "user"
    WHERE lower(trim(name)) IN ('unknown', '') AND coalesce(given_name, family_name) IS NOT NULL
  `
  log(`${placeholders.length} placeholder display name(s) -> given + family`)
  if (APPLY && placeholders.length > 0) {
    const [{ has_col }] = await sql`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'principal' AND column_name = 'display_name') AS has_col
    `
    for (const u of placeholders) {
      const derived = [u.given_name, u.family_name].filter(Boolean).join(' ').trim()
      await sql`UPDATE "user" SET name = ${derived} WHERE id = ${u.id}`
      if (has_col) await sql`UPDATE principal SET display_name = ${derived} WHERE user_id = ${u.id}`
    }
  }

  log('done.', APPLY ? 'Changes committed.' : 'Re-run with --apply to commit.')
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (error) => {
    console.error(error)
    await sql.end({ timeout: 5 })
    process.exit(1)
  })
