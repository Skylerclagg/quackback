/**
 * Roadmap view authorization.
 *
 * Thin wrapper over the shared audience gate (see audience.ts for the
 * full semantics). Unlike boards there is no SQL filter twin: every
 * roadmap list is one small unpaginated query whose rows are filtered
 * in memory with this exact predicate, so single-row and list
 * decisions share one code path by construction.
 */
import type { TimelineAccess, TimelineSpecificity } from '@/lib/server/db'
import { TIMELINE_SPECIFICITY_RANK } from '@/lib/shared/timeline'
import { allowDecision, denyDecision, isTeamActor, type Actor, type Decision } from './types'
import { canViewAudienceGated, type AudienceGated } from './audience'

export type RoadmapVisibility = AudienceGated

/**
 * Whether the actor may see a roadmap — used by BOTH the portal and
 * the admin surfaces (list, board posts, mutations).
 */
export function canViewRoadmap(actor: Actor, roadmap: RoadmapVisibility): Decision {
  return canViewAudienceGated(actor, roadmap)
}

export interface RoadmapTimelineGate {
  /** Tolerates null/undefined for rows read before the 0131 backfill ran. */
  timelineAccess?: TimelineAccess | null
}

/**
 * How specifically this actor may see the roadmap's timeline dates —
 * layered on top of canViewRoadmap, never replacing it.
 *
 * Admins always get full specificity. Every other viewer takes the
 * FINEST cap among the roadmap's default and their matching segment
 * overrides (a viewer in two overridden segments gets the more
 * specific one); team members are segment members like anyone else, so
 * they take part in that too. Member-role teammates additionally keep
 * their per-person rule: an explicit `teamMembers` entry is their cap,
 * and without one they retain full specificity — the segment result
 * can only raise a member, never coarsen them. Anonymous/service
 * principals never match segment overrides, mirroring tierAllows().
 */
export function timelineSpecificityFor(
  actor: Actor,
  roadmap: RoadmapTimelineGate
): TimelineSpecificity {
  const access = roadmap.timelineAccess ?? { default: 'day' as const, segments: [] }
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
      (o) => actor.principalId !== null && o.principalId === actor.principalId
    )
    if (memberOverride) return memberOverride.specificity
    // No explicit per-member cap: members keep the full specificity
    // they have always had, and a matching segment override can only
    // add to it. Taking the finest of the two keeps the change
    // monotone — 'day' is the top rank today, so this still resolves
    // to 'day'; written as a max so the property survives any future
    // change to the ranking or the member baseline.
    return TIMELINE_SPECIFICITY_RANK[bySegment] > TIMELINE_SPECIFICITY_RANK.day ? bySegment : 'day'
  }
  return bySegment
}

/** Whether the timeline view exists at all for this actor. */
export function canViewRoadmapTimeline(actor: Actor, roadmap: RoadmapTimelineGate): Decision {
  return timelineSpecificityFor(actor, roadmap) === 'hidden'
    ? denyDecision('Timeline is restricted')
    : allowDecision()
}
