/**
 * Roadmap view authorization.
 *
 * Thin wrapper over the shared audience gate (see audience.ts for the
 * full semantics). Unlike boards there is no SQL filter twin: every
 * roadmap list is one small unpaginated query whose rows are filtered
 * in memory with this exact predicate, so single-row and list
 * decisions share one code path by construction.
 */
import { type Actor, type Decision } from './types'
import { canViewAudienceGated, type AudienceGated } from './audience'

export type RoadmapVisibility = AudienceGated

/**
 * Whether the actor may see a roadmap — used by BOTH the portal and
 * the admin surfaces (list, board posts, mutations).
 */
export function canViewRoadmap(actor: Actor, roadmap: RoadmapVisibility): Decision {
  return canViewAudienceGated(actor, roadmap)
}
