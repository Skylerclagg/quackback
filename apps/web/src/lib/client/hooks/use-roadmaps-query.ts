import type { EtaDisclosure } from '@/lib/shared/db-types'
/**
 * Roadmap query hooks
 *
 * Query hooks for fetching roadmap data.
 * Mutations are in @/lib/client/mutations/roadmaps.
 */

import { useQuery } from '@tanstack/react-query'
import type {
  BoardId,
  PostStatusId,
  PostTagId,
  RoadmapColumnId,
  RoadmapId,
  SegmentId,
} from '@quackback/ids'
import {
  fetchRoadmaps,
  getRoadmapDateBucketsFn,
  getRoadmapMilestonesFn,
} from '@/lib/server/functions/roadmaps'
import { listPublicRoadmapsFn } from '@/lib/server/functions/public-posts'
import {
  fetchPublicRoadmapDateBuckets,
  fetchPublicRoadmapMilestones,
} from '@/lib/server/functions/portal'
import type {
  RoadmapDateBucket,
  RoadmapFrequency,
  RoadmapType,
  RoadmapVisibility,
} from '@/lib/shared/roadmap-config'

// ============================================================================
// Types
// ============================================================================

/** Roadmap type for client components (Date fields may be strings after serialization) */
export interface RoadmapView {
  id: RoadmapId
  name: string
  description: string | null
  slug: string
  type: RoadmapType
  baseFilter: {
    statusIds?: PostStatusId[]
    boardIds?: BoardId[]
    tagIds?: PostTagId[]
    segmentIds?: SegmentId[]
  }
  dateSource: 'eta' | null
  frequency: RoadmapFrequency | null
  visibility: RoadmapVisibility
  visibleSegmentIds: SegmentId[] | null
  /** null = every team actor; [] = admins only; [ids] = admins plus those principals. */
  /** Admin-only fields: the public serializer omits them on purpose. */
  allowedTeamPrincipalIds?: string[] | null
  /** Per-audience cap on how precisely ETAs render. */
  etaDisclosure?: EtaDisclosure
  /** Column roadmap that also offers a timeline tab. */
  timelineEnabled: boolean
  position: number
  columns: Array<{
    id: RoadmapColumnId
    roadmapId: RoadmapId
    statusId: PostStatusId
    name: string
    icon: string | null
    color: string
    position: number
  }>
  createdAt: Date | string
  updatedAt: Date | string
}

interface UseRoadmapsOptions {
  enabled?: boolean
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapsKeys = {
  all: ['roadmaps'] as const,
  list: () => [...roadmapsKeys.all, 'list'] as const,
  publicList: () => [...roadmapsKeys.all, 'public'] as const,
  detail: (roadmapId: RoadmapId) => [...roadmapsKeys.all, 'detail', roadmapId] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Hook to fetch all roadmaps (admin)
 */
export function useRoadmaps({ enabled = true }: UseRoadmapsOptions = {}) {
  return useQuery({
    queryKey: roadmapsKeys.list(),
    queryFn: fetchRoadmaps as unknown as () => Promise<RoadmapView[]>,
    enabled,
  })
}

export function useRoadmapDateBuckets(
  roadmapId: RoadmapId,
  options: { public?: boolean; enabled?: boolean } = {}
) {
  return useQuery<RoadmapDateBucket[]>({
    queryKey: [
      ...roadmapsKeys.detail(roadmapId),
      'date-buckets',
      options.public ? 'public' : 'admin',
    ],
    queryFn: () =>
      options.public
        ? fetchPublicRoadmapDateBuckets({ data: { roadmapId } })
        : getRoadmapDateBucketsFn({ data: { roadmapId } }),
    enabled: options.enabled ?? true,
  })
}

/**
 * Hook to fetch public roadmaps (portal)
 */
export function usePublicRoadmaps({ enabled = true }: UseRoadmapsOptions = {}) {
  return useQuery({
    queryKey: roadmapsKeys.publicList(),
    queryFn: listPublicRoadmapsFn as () => Promise<RoadmapView[]>,
    enabled,
  })
}

/** Serialized milestone (Dates are ISO strings on the wire). */
export interface RoadmapMilestoneView {
  id: string
  roadmapId: string
  title: string
  description: string | null
  timelineDate: string
  timelinePrecision: string
  timelinePosition: number
}

/**
 * Milestones for a roadmap's timeline. Keyed under the roadmap detail so the
 * milestone mutations' single invalidation refreshes them.
 */
export function useRoadmapMilestones(
  roadmapId: RoadmapId,
  options: { public?: boolean; enabled?: boolean } = {}
) {
  return useQuery<RoadmapMilestoneView[]>({
    queryKey: [
      ...roadmapsKeys.detail(roadmapId),
      'milestones',
      options.public ? 'public' : 'admin',
    ],
    queryFn: () =>
      options.public
        ? fetchPublicRoadmapMilestones({ data: { roadmapId } })
        : getRoadmapMilestonesFn({ data: { roadmapId } }),
    enabled: options.enabled ?? true,
  })
}
