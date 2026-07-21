/**
 * Validation for the audience allowlists stored on roadmaps and
 * changelog entries (allowedSegmentIds / allowedTeamPrincipalIds).
 *
 * Both normalize helpers dedupe and drop ids that don't reference a
 * live row. Without this an admin could store garbage strings that
 * never match at runtime but re-display in the UI on every load (same
 * rationale as updatePortalAccessFn).
 */
import { db, and, inArray, isNull, segments, principal } from '@/lib/server/db'
import type { PrincipalId, SegmentId } from '@quackback/ids'

/** Keep only existing, non-deleted segment ids. */
export async function normalizeAllowedSegmentIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const requested = Array.from(new Set(ids))
  const found = await db
    .select({ id: segments.id })
    .from(segments)
    .where(and(inArray(segments.id, requested as SegmentId[]), isNull(segments.deletedAt)))
  const valid = new Set(found.map((r) => String(r.id)))
  return requested.filter((id) => valid.has(id))
}

/**
 * Keep only admin/member-role principal ids. Admins in the list are
 * redundant (they always see every audience-gated resource) but
 * harmless.
 */
export async function normalizeAllowedTeamPrincipalIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const requested = Array.from(new Set(ids))
  const found = await db
    .select({ id: principal.id })
    .from(principal)
    .where(
      and(
        inArray(principal.id, requested as PrincipalId[]),
        inArray(principal.role, ['admin', 'member'])
      )
    )
  const valid = new Set(found.map((r) => String(r.id)))
  return requested.filter((id) => valid.has(id))
}
