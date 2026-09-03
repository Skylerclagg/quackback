import { isNull, sql, type SQL } from 'drizzle-orm'
import { roadmaps } from '@/lib/server/db'
import { allowDecision, denyDecision, isTeamActor, type Actor, type Decision } from './types'
import { audienceAllows, audienceViewFilter } from './audience'
import { TIMELINE_SPECIFICITY_RANK } from '@/lib/shared/timeline'
import type { EtaDisclosure, TimelineSpecificity } from '@/lib/shared/db-types'

export interface RoadmapVisibilityResource {
  visibility: 'public' | 'team' | 'segment'
  visibleSegmentIds: readonly string[] | null
  /**
   * Tri-state; null (the default, and what every pre-existing roadmap carries)
   * means every team actor, preserving the behaviour this gate had before the
   * column existed. See policy/audience.ts.
   */
  allowedTeamPrincipalIds?: readonly string[] | null
  deletedAt?: Date | string | null
}

/**
 * Delegates to the shared audience gate so roadmaps and changelog entries
 * cannot drift apart on who may see restricted content. The denial *messages*
 * stay roadmap-specific: a 'team' roadmap says so, while a segment-gated one
 * is indistinguishable from one that does not exist.
 */
export function canViewRoadmap(actor: Actor, roadmap: RoadmapVisibilityResource): Decision {
  if (roadmap.deletedAt) return denyDecision('Roadmap not found')
  if (audienceAllows(actor, roadmap).allowed) return allowDecision()
  return denyDecision(
    roadmap.visibility === 'team' ? 'This roadmap is internal' : 'Roadmap not found'
  )
}

export function roadmapViewFilter(actor: Actor): SQL {
  // Fast path preserved verbatim: with no allowlist in play an admin sees every
  // non-deleted roadmap, and this avoids rendering the fuller predicate.
  if (actor.role === 'admin') return sql`${isNull(roadmaps.deletedAt)}`

  return audienceViewFilter(actor, {
    visibility: roadmaps.visibility,
    visibleSegmentIds: roadmaps.visibleSegmentIds,
    allowedTeamPrincipalIds: roadmaps.allowedTeamPrincipalIds,
    deletedAt: roadmaps.deletedAt,
  })
}

export interface RoadmapDisclosureResource {
  etaDisclosure?: EtaDisclosure | null
}

/**
 * How specific this viewer may see the roadmap's dates.
 *
 * Admins always get full specificity. Portal viewers start at the roadmap's
 * `default` cap and any segment override they match can only RAISE it: a
 * segment entry exists to show a trusted audience more, never less. Anonymous
 * and service principals match no segment. Member-role teammates keep full
 * specificity unless named in `teamMembers`, in which case that entry is their
 * cap — the same coarsening the portal applies, so a capped member never sees
 * finer dates through the admin surface either.
 *
 * Coarsening happens server-side in the query layer using this cap, so the
 * precise date never leaves the server for a viewer who is not entitled to it.
 */
export function etaDisclosureFor(
  actor: Actor,
  roadmap: RoadmapDisclosureResource
): TimelineSpecificity {
  const access: EtaDisclosure = roadmap.etaDisclosure ?? { default: 'day', segments: [] }
  if (actor.role === 'admin') return 'day'

  let bySegment: TimelineSpecificity = access.default ?? 'day'
  if (actor.principalType === 'user') {
    for (const override of access.segments ?? []) {
      if (
        actor.segmentIds.has(override.segmentId as never) &&
        TIMELINE_SPECIFICITY_RANK[override.specificity] > TIMELINE_SPECIFICITY_RANK[bySegment]
      ) {
        bySegment = override.specificity
      }
    }
  }

  if (isTeamActor(actor)) {
    const memberOverride = (access.teamMembers ?? []).find(
      (o) => actor.principalId !== null && o.principalId === String(actor.principalId)
    )
    if (memberOverride) return memberOverride.specificity
    // No explicit per-member cap: members keep the full specificity they have
    // always had, and a matching segment override can only add to it. Written as
    // a max so the property survives any future change to the ranking.
    return TIMELINE_SPECIFICITY_RANK[bySegment] > TIMELINE_SPECIFICITY_RANK.day ? bySegment : 'day'
  }
  return bySegment
}

/** Whether the timeline view exists at all for this actor. */
export function canViewRoadmapTimeline(actor: Actor, roadmap: RoadmapDisclosureResource): Decision {
  return etaDisclosureFor(actor, roadmap) === 'hidden'
    ? denyDecision('Timeline is restricted')
    : allowDecision()
}
