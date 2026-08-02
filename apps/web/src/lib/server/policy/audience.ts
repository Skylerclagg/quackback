/**
 * Shared audience gate for resources carrying the isPublic +
 * allowedSegmentIds + allowedTeamPrincipalIds trio (roadmaps,
 * changelog entries).
 *
 * Public resources are visible to every viewer. Private resources
 * admit: admins always; ANY human principal (portal user or team
 * account) whose segments intersect the segment allowlist — segments
 * are open to team members, so the segment branch is not portal-only;
 * and, additionally, member-role team accounts listed in the team
 * allowlist. Empty lists make a private resource admin-only. Anonymous
 * and service principals fail closed on the segment branch, matching
 * the `segments` tier semantics in tierAllows().
 *
 * The team allowlist stays team-only: a portal user whose principal id
 * happens to appear on it is never admitted by it.
 */
import { allowDecision, denyDecision, type Actor, type Decision } from './types'

export interface AudienceGated {
  isPublic: boolean
  /** Tolerates null/undefined for rows read before their backfill ran. */
  allowedSegmentIds?: string[] | null
  allowedTeamPrincipalIds?: string[] | null
  deletedAt?: Date | null
}

export function canViewAudienceGated(actor: Actor, resource: AudienceGated): Decision {
  if (resource.deletedAt) {
    return denyDecision('Not found')
  }
  if (resource.isPublic || actor.role === 'admin') {
    return allowDecision()
  }
  // Segment allowlist first, for every human principal — team members
  // can be segment members too, so this branch is not portal-only.
  const segmentAllowlist = resource.allowedSegmentIds ?? []
  const inSegment =
    actor.principalType === 'user' &&
    segmentAllowlist.some((id) => actor.segmentIds.has(id as never))
  if (inSegment) {
    return allowDecision()
  }
  // The team allowlist is an ADDITIONAL door, open to member-role
  // accounts only — strictly additive to the segment check above.
  if (actor.role === 'member') {
    const teamAllowlist = resource.allowedTeamPrincipalIds ?? []
    if (actor.principalId !== null && teamAllowlist.includes(actor.principalId)) {
      return allowDecision()
    }
  }
  return denyDecision('This content is restricted')
}
