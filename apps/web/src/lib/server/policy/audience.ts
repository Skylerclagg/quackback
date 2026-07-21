/**
 * Shared audience gate for resources carrying the isPublic +
 * allowedSegmentIds + allowedTeamPrincipalIds trio (roadmaps,
 * changelog entries).
 *
 * Public resources are visible to every viewer. Private resources
 * admit: admins always; member-role team accounts only when listed in
 * the team allowlist; portal users only via the segment allowlist.
 * Empty lists make a private resource admin-only. Anonymous and
 * service principals fail closed on the segment branch, matching the
 * `segments` tier semantics in tierAllows().
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
  if (actor.role === 'member') {
    const teamAllowlist = resource.allowedTeamPrincipalIds ?? []
    return actor.principalId !== null && teamAllowlist.includes(actor.principalId)
      ? allowDecision()
      : denyDecision('This content is restricted')
  }
  const allowlist = resource.allowedSegmentIds ?? []
  const inSegment =
    actor.principalType === 'user' && allowlist.some((id) => actor.segmentIds.has(id as never))
  return inSegment ? allowDecision() : denyDecision('This content is restricted')
}
