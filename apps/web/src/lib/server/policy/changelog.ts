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
import { changelogEntries } from '@/lib/server/db'
import { type Actor, type Decision } from './types'
import { canViewAudienceGated, type AudienceGated } from './audience'

export type ChangelogAudience = AudienceGated

/** Single-row changelog audience decision. */
export function canViewChangelogEntry(actor: Actor, entry: ChangelogAudience): Decision {
  return canViewAudienceGated(actor, entry)
}

/**
 * SQL predicate mirroring canViewChangelogEntry for list queries.
 *
 * Admin → every row. Member → public rows plus rows whose team
 * allowlist contains their principal id (jsonb containment). Portal
 * user → public rows plus rows whose segment allowlist intersects
 * their memberships. Anonymous/service → public rows only. Empty
 * membership collapses to a constant, avoiding `ANY(()::text[])`
 * which Postgres rejects (same note as boardViewFilter).
 */
export function changelogAudienceFilter(actor: Actor): SQL {
  if (actor.role === 'admin') {
    return sql`true`
  }
  if (actor.role === 'member') {
    return actor.principalId !== null
      ? sql`(${changelogEntries.isPublic} = true OR ${changelogEntries.allowedTeamPrincipalIds} @> ${JSON.stringify([String(actor.principalId)])}::jsonb)`
      : sql`${changelogEntries.isPublic} = true`
  }
  const memberIds = Array.from(actor.segmentIds) as string[]
  const isUser = actor.principalType === 'user'
  const segmentsMatch =
    memberIds.length > 0 && isUser
      ? sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${changelogEntries.allowedSegmentIds}) seg
          WHERE seg = ANY(ARRAY[${sql.join(
            memberIds.map((id) => sql`${id}`),
            sql`, `
          )}]::text[])
        )`
      : sql`false`
  return sql`(${changelogEntries.isPublic} = true OR ${segmentsMatch})`
}
