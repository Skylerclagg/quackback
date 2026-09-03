/**
 * Shared audience gate for resources carrying visibility + a segment allowlist
 * + a team allowlist (roadmaps, changelog entries).
 *
 * This is the one place that knows how to restrict content to a SUBSET of the
 * team. Every other gate in `policy/` short-circuits on `isTeamActor` —
 * `segment-gate.ts` returns `true` and `roadmaps.ts` returns `allowDecision()`
 * for any team actor — which is correct for "is this hidden from customers"
 * and cannot express "is this hidden from most of the team". Both surfaces bind
 * their own columns to the functions here rather than growing a second
 * implementation, because two implementations of an access rule drift and the
 * drift is silent.
 *
 * ## The order of the doors is load-bearing
 *
 * Public first, then admin, then segments, then the team allowlist. Consulting
 * the team allowlist earlier looks equivalent and is not: a `public` row with an
 * empty team allowlist would then be visible to the entire internet and
 * invisible to every unlisted teammate — the exact inversion of what the author
 * asked for. The public/admin short-circuit makes that state unreachable.
 *
 * ## The segment door is NOT portal-only
 *
 * A team account whose segments intersect the allowlist is admitted by the
 * segment branch, before the team allowlist is consulted at all. Team members
 * can be segment members, so treating the segment branch as customers-only
 * would deny a teammate the very segment they were put in.
 *
 * ## `allowedTeamPrincipalIds` is a tri-state, and null is the important one
 *
 *   null  — every team actor, the DEFAULT and what every pre-existing row has.
 *           This is what preserves today's upstream behaviour: `canViewRoadmap`
 *           admits any team actor, so a column that defaulted to `[]` would
 *           silently turn every existing roadmap admin-only on deploy.
 *   []    — admins only. A row deliberately closed to the rest of the team.
 *   [ids] — admins plus the listed member-role principals.
 *
 * Read it with `?? null`, never `?? []`. The two differ by "the whole team" and
 * nothing in the type system will catch the substitution.
 *
 * The team allowlist stays team-only: a portal user whose principal id happens
 * to appear on it is never admitted by it.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { allowDecision, denyDecision, type Actor, type Decision } from './types'

/** Shared with `ROADMAP_VISIBILITIES`; `'public'` is the only ungated tier. */
export type AudienceVisibility = 'public' | 'team' | 'segment'

export interface AudienceResource {
  visibility: AudienceVisibility
  /** Consulted only when `visibility === 'segment'`. */
  visibleSegmentIds?: readonly string[] | null
  /** Tri-state — see the file header. null = every team actor. */
  allowedTeamPrincipalIds?: readonly string[] | null
  deletedAt?: Date | string | null
}

/**
 * Does this actor pass the team allowlist?
 *
 * Admins always do. Exported so a caller can explain a denial without
 * re-deriving the rule.
 */
export function teamAllowlistAllows(
  actor: Actor,
  allowed: readonly string[] | null | undefined
): boolean {
  if (actor.role === 'admin') return true
  if (allowed == null) return true // null = every team actor
  return actor.principalId !== null && allowed.includes(String(actor.principalId))
}

/** Single-row gate. Paired with {@link audienceViewFilter}; they must agree. */
export function audienceAllows(actor: Actor, resource: AudienceResource): Decision {
  if (resource.deletedAt) return denyDecision('Not found')
  if (resource.visibility === 'public') return allowDecision()
  if (actor.role === 'admin') return allowDecision()

  // Segment door — any human principal, team accounts included.
  if (resource.visibility === 'segment' && actor.principalType === 'user') {
    const segments = resource.visibleSegmentIds ?? []
    if (segments.some((id) => actor.segmentIds.has(id as never))) return allowDecision()
  }

  // Team door — strictly additive, and open to team roles only.
  if (actor.role === 'member' && teamAllowlistAllows(actor, resource.allowedTeamPrincipalIds)) {
    return allowDecision()
  }

  return denyDecision(
    resource.visibility === 'team' ? 'This content is internal' : 'This content is restricted'
  )
}

/** The columns a table binds to {@link audienceViewFilter}. */
export interface AudienceColumns {
  visibility: AnyPgColumn | SQL
  visibleSegmentIds: AnyPgColumn | SQL
  allowedTeamPrincipalIds: AnyPgColumn | SQL
  /** Passed separately so the caller keeps its own soft-delete convention. */
  deletedAt: AnyPgColumn | SQL
}

/**
 * SQL predicate matching {@link audienceAllows} row for row.
 *
 * `deletedAt IS NULL` is included on EVERY branch, admins included. Upstream's
 * `roadmapViewFilter` does the same, and its parity test asserts that soft
 * deleted rows stay hidden from team actors in both paths — returning a bare
 * `true` for admins would surface deleted rows in every team list query.
 */
export function audienceViewFilter(actor: Actor, cols: AudienceColumns): SQL {
  const notDeleted = sql`${cols.deletedAt} IS NULL`

  if (actor.role === 'admin') return notDeleted

  const memberIds = Array.from(actor.segmentIds) as string[]
  // See boardViewFilter: the empty case must collapse to a constant rather than
  // render `ANY(()::text[])`, which is a syntax error.
  const segmentDoor =
    actor.principalType === 'user' && memberIds.length > 0
      ? sql`(
          ${cols.visibility} = 'segment'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(${cols.visibleSegmentIds}, '[]'::jsonb)) seg
            WHERE seg = ANY(ARRAY[${sql.join(
              memberIds.map((id) => sql`${id}`),
              sql`, `
            )}]::text[])
          )
        )`
      : sql`false`

  const teamDoor =
    actor.role === 'member'
      ? actor.principalId !== null
        ? sql`(
            ${cols.allowedTeamPrincipalIds} IS NULL
            OR ${cols.allowedTeamPrincipalIds} @> ${JSON.stringify([String(actor.principalId)])}::jsonb
          )`
        : sql`${cols.allowedTeamPrincipalIds} IS NULL`
      : sql`false`

  return sql`${notDeleted} AND (${cols.visibility} = 'public' OR ${segmentDoor} OR ${teamDoor})`
}
