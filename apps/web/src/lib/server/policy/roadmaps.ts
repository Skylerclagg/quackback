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
 * Admins always get full specificity. Member-role teammates get full
 * specificity unless an explicit per-member override caps them (the
 * same per-person granularity as the roadmap team allowlist). Portal
 * viewers take the FINEST cap among the roadmap's default and their
 * matching segment overrides (a viewer in two overridden segments
 * gets the more specific one). Anonymous/service principals never
 * match segment overrides, mirroring tierAllows().
 */
export function timelineSpecificityFor(
  actor: Actor,
  roadmap: RoadmapTimelineGate
): TimelineSpecificity {
  const access = roadmap.timelineAccess ?? { default: 'day' as const, segments: [] }
  if (actor.role === 'admin') return 'day'
  if (isTeamActor(actor)) {
    const memberOverride = (access.teamMembers ?? []).find(
      (o) => actor.principalId !== null && o.principalId === actor.principalId
    )
    return memberOverride ? memberOverride.specificity : 'day'
  }
  let best: TimelineSpecificity = access.default ?? 'day'
  if (actor.principalType === 'user') {
    for (const override of access.segments ?? []) {
      if (
        actor.segmentIds.has(override.segmentId as never) &&
        TIMELINE_SPECIFICITY_RANK[override.specificity] > TIMELINE_SPECIFICITY_RANK[best]
      ) {
        best = override.specificity
      }
    }
  }
  return best
}

/** Whether the timeline view exists at all for this actor. */
export function canViewRoadmapTimeline(actor: Actor, roadmap: RoadmapTimelineGate): Decision {
  return timelineSpecificityFor(actor, roadmap) === 'hidden'
    ? denyDecision('Timeline is restricted')
    : allowDecision()
}
