/**
 * Roadmap view authorization.
 *
 * Roadmaps carry a coarse `isPublic` boolean plus two allowlists that
 * only apply to private roadmaps: `allowedSegmentIds` (portal users)
 * and `allowedTeamPrincipalIds` (member-role team accounts). Unlike
 * boards there is no SQL filter twin: every roadmap list is one small
 * query whose rows are filtered in memory with this exact predicate,
 * so single-row and list decisions share one code path by
 * construction.
 */
import { allowDecision, denyDecision, type Actor, type Decision } from './types'

export interface RoadmapVisibility {
  isPublic: boolean
  /** Tolerates null/undefined for rows read before the 0126 backfill ran. */
  allowedSegmentIds?: string[] | null
  /** Tolerates null/undefined for rows read before the 0127 backfill ran. */
  allowedTeamPrincipalIds?: string[] | null
  deletedAt?: Date | null
}

/**
 * Whether the actor may see a roadmap — used by BOTH the portal and
 * the admin surfaces (list, board posts, mutations).
 *
 * Public roadmaps are visible to everyone. Private roadmaps admit:
 *   - admins, always (they can edit roadmap settings anyway);
 *   - member-role team accounts listed in allowedTeamPrincipalIds;
 *   - portal users belonging to at least one segment in
 *     allowedSegmentIds.
 * Empty lists therefore make a private roadmap admin-only. Anonymous
 * and service principals fail closed on the segment branch, matching
 * the `segments` tier semantics in tierAllows().
 */
export function canViewRoadmap(actor: Actor, roadmap: RoadmapVisibility): Decision {
  if (roadmap.deletedAt) {
    return denyDecision('Roadmap not found')
  }
  if (roadmap.isPublic || actor.role === 'admin') {
    return allowDecision()
  }
  if (actor.role === 'member') {
    const teamAllowlist = roadmap.allowedTeamPrincipalIds ?? []
    return actor.principalId !== null && teamAllowlist.includes(actor.principalId)
      ? allowDecision()
      : denyDecision('This roadmap is restricted')
  }
  const allowlist = roadmap.allowedSegmentIds ?? []
  const inSegment =
    actor.principalType === 'user' && allowlist.some((id) => actor.segmentIds.has(id as never))
  return inSegment ? allowDecision() : denyDecision('This roadmap is restricted')
}
