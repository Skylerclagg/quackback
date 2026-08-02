/**
 * Changelog entry audience authorization.
 *
 * Single-row decisions use canViewChangelogEntry (the shared audience
 * gate — see audience.ts). List queries use changelogAudienceFilter,
 * the SQL twin, because the public changelog list and RSS feed are
 * cursor-paginated — filtering rows in memory after LIMIT would break
 * page sizes and cursors. Row-by-row truthiness of the SQL must match
 * the predicate exactly; the execution-level parity test enforces it
 * (changelog-audience-filter-parity.test.ts).
 *
 * The filter is AUDIENCE-ONLY: callers must still apply
 * publicChangelogConditions (deletedAt / publishedAt) on public
 * surfaces. The predicate does check deletedAt defensively.
 */
import { sql, type SQL } from 'drizzle-orm'
import { changelogs, changelogEntries } from '@/lib/server/db'
import { allowDecision, type Actor, type Decision } from './types'
import { canViewAudienceGated, type AudienceGated } from './audience'

export type ChangelogAudience = AudienceGated

/** Single-row changelog entry audience decision. */
export function canViewChangelogEntry(actor: Actor, entry: ChangelogAudience): Decision {
  return canViewAudienceGated(actor, entry)
}

/** Single-row changelog collection audience decision. */
export function canViewChangelogCollection(actor: Actor, collection: AudienceGated): Decision {
  return canViewAudienceGated(actor, collection)
}

/**
 * Combined single-row decision for an entry inside a collection. The
 * collection's audience gates every entry in it IN ADDITION to the
 * entry's own audience; entries without a collection (the built-in
 * "General" changelog) are gated by their own audience alone.
 */
export function canViewChangelogEntryInCollection(
  actor: Actor,
  entry: ChangelogAudience,
  collection: AudienceGated | null | undefined
): Decision {
  const entryDecision = canViewChangelogEntry(actor, entry)
  if (!entryDecision.allowed) return entryDecision
  return collection ? canViewChangelogCollection(actor, collection) : allowDecision()
}

/** Column trio the audience SQL runs over — entries and collections share the shape. */
interface AudienceColumns {
  isPublic: typeof changelogEntries.isPublic | typeof changelogs.isPublic
  allowedSegmentIds: typeof changelogEntries.allowedSegmentIds | typeof changelogs.allowedSegmentIds
  allowedTeamPrincipalIds:
    | typeof changelogEntries.allowedTeamPrincipalIds
    | typeof changelogs.allowedTeamPrincipalIds
}

/**
 * Shared SQL body mirroring canViewAudienceGated for list queries.
 *
 * Admin → every row. Every other human principal → public rows plus
 * rows whose segment allowlist intersects their memberships (team
 * members can be segment members, so this is not portal-only). Member
 * → that, PLUS rows whose team allowlist contains their principal id
 * (jsonb containment). Anonymous/service → public rows, plus the team
 * allowlist when they carry role='member'. Empty membership collapses
 * to a constant, avoiding `ANY(()::text[])` which Postgres rejects
 * (same note as boardViewFilter).
 */
function audienceFilterOver(actor: Actor, cols: AudienceColumns): SQL {
  if (actor.role === 'admin') {
    return sql`true`
  }
  const memberIds = Array.from(actor.segmentIds) as string[]
  const isUser = actor.principalType === 'user'
  const segmentsMatch =
    memberIds.length > 0 && isUser
      ? sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${cols.allowedSegmentIds}) seg
          WHERE seg = ANY(ARRAY[${sql.join(
            memberIds.map((id) => sql`${id}`),
            sql`, `
          )}]::text[])
        )`
      : sql`false`
  if (actor.role === 'member' && actor.principalId !== null) {
    return sql`(${cols.isPublic} = true OR ${cols.allowedTeamPrincipalIds} @> ${JSON.stringify([String(actor.principalId)])}::jsonb OR ${segmentsMatch})`
  }
  return sql`(${cols.isPublic} = true OR ${segmentsMatch})`
}

/** SQL predicate mirroring canViewChangelogEntry for entry list queries. */
export function changelogAudienceFilter(actor: Actor): SQL {
  return audienceFilterOver(actor, changelogEntries)
}

/** SQL predicate mirroring canViewChangelogCollection for collection list queries. */
export function changelogCollectionAudienceFilter(actor: Actor): SQL {
  return audienceFilterOver(actor, changelogs)
}

/**
 * SQL predicate over changelog_entries admitting a row only when its
 * collection (if any) is visible to the actor: entries of the built-in
 * "General" changelog (changelog_id IS NULL) pass, otherwise the
 * collection must be live and pass the audience gate. An EXISTS
 * subquery rather than a join so callers can drop it into any WHERE
 * clause. Apply IN ADDITION to changelogAudienceFilter — the SQL twin
 * of canViewChangelogEntryInCollection.
 */
export function changelogCollectionVisibleFilter(actor: Actor): SQL {
  if (actor.role === 'admin') {
    return sql`true`
  }
  return sql`(${changelogEntries.changelogId} IS NULL OR EXISTS (
    SELECT 1 FROM ${changelogs}
    WHERE ${changelogs.id} = ${changelogEntries.changelogId}
      AND ${changelogs.deletedAt} IS NULL
      AND ${changelogCollectionAudienceFilter(actor)}
  ))`
}
