/**
 * Roadmap mutations
 *
 * Mutation hooks for roadmap CRUD operations.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  BoardId,
  PostStatusId,
  PostTagId,
  RoadmapColumnId,
  RoadmapId,
  SegmentId,
  PrincipalId,
} from '@quackback/ids'
import type { RoadmapView } from '@/lib/client/hooks/use-roadmaps-query'
import type { RoadmapFrequency, RoadmapType, RoadmapVisibility } from '@/lib/shared/roadmap-config'
import type { EtaDisclosure, TimelinePrecision } from '@/lib/shared/db-types'
import {
  createRoadmapFn,
  updateRoadmapFn,
  deleteRoadmapFn,
  reorderRoadmapsFn,
  createMilestoneFn,
  updateMilestoneFn,
  deleteMilestoneFn,
} from '@/lib/server/functions/roadmaps'
import { roadmapsKeys } from '@/lib/client/hooks/use-roadmaps-query'

// ============================================================================
// Types
// ============================================================================

interface CreateRoadmapInput {
  name: string
  slug: string
  description?: string
  type: RoadmapType
  baseFilter: {
    statusIds?: PostStatusId[]
    boardIds?: BoardId[]
    tagIds?: PostTagId[]
    segmentIds?: SegmentId[]
  }
  frequency: RoadmapFrequency | null
  visibility: RoadmapVisibility
  visibleSegmentIds: SegmentId[] | null
  allowedTeamPrincipalIds?: PrincipalId[] | null
  etaDisclosure?: EtaDisclosure
  timelineEnabled?: boolean
  columns: RoadmapColumnMutationInput[]
}

interface RoadmapColumnMutationInput {
  id?: RoadmapColumnId
  statusId: PostStatusId
  name: string
  icon?: string | null
  color: string
  position: number
}

interface UpdateRoadmapInput {
  name?: string
  description?: string
  type?: RoadmapType
  baseFilter?: CreateRoadmapInput['baseFilter']
  frequency?: RoadmapFrequency | null
  visibility?: RoadmapVisibility
  visibleSegmentIds?: SegmentId[] | null
  allowedTeamPrincipalIds?: PrincipalId[] | null
  etaDisclosure?: EtaDisclosure
  timelineEnabled?: boolean
  columns?: RoadmapColumnMutationInput[]
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new roadmap
 */
export function useCreateRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateRoadmapInput) =>
      createRoadmapFn({
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description,
          type: input.type,
          baseFilter: input.baseFilter,
          dateSource: input.type === 'date' ? 'eta' : null,
          frequency: input.type === 'date' ? input.frequency : null,
          visibility: input.visibility,
          visibleSegmentIds: input.visibleSegmentIds,
          allowedTeamPrincipalIds: input.allowedTeamPrincipalIds,
          columns: input.type === 'column' ? input.columns : [],
        },
      }) as unknown as Promise<RoadmapView>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list() })
    },
  })
}

/**
 * Hook to update a roadmap
 */
export function useUpdateRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ roadmapId, input }: { roadmapId: RoadmapId; input: UpdateRoadmapInput }) =>
      updateRoadmapFn({
        data: {
          id: roadmapId,
          name: input.name,
          description: input.description,
          type: input.type,
          baseFilter: input.baseFilter,
          dateSource: input.type === undefined ? undefined : input.type === 'date' ? 'eta' : null,
          frequency: input.frequency,
          visibility: input.visibility,
          visibleSegmentIds: input.visibleSegmentIds,
          allowedTeamPrincipalIds: input.allowedTeamPrincipalIds,
          columns: input.columns,
        },
      }) as unknown as Promise<RoadmapView>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list() })
    },
  })
}

/**
 * Hook to delete a roadmap
 */
export function useDeleteRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (roadmapId: RoadmapId) => deleteRoadmapFn({ data: { id: roadmapId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list() })
    },
  })
}

/**
 * Hook to reorder roadmaps
 */
export function useReorderRoadmaps() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (roadmapIds: string[]) => reorderRoadmapsFn({ data: { roadmapIds } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list() })
    },
  })
}

// ============================================================================
// Milestones
// ============================================================================

/**
 * Milestones live under the roadmap's detail key, so any change invalidates the
 * whole roadmap subtree — payloads are small and buckets interact.
 */
function useInvalidateMilestones() {
  const queryClient = useQueryClient()
  return (roadmapId: RoadmapId) => {
    queryClient.invalidateQueries({ queryKey: roadmapsKeys.detail(roadmapId) })
  }
}

export function useCreateMilestone() {
  const invalidate = useInvalidateMilestones()
  return useMutation({
    mutationFn: (input: {
      roadmapId: RoadmapId
      title: string
      description?: string
      date: Date
      precision: TimelinePrecision
    }) => createMilestoneFn({ data: input }),
    onSuccess: (_result, input) => invalidate(input.roadmapId),
  })
}

export function useUpdateMilestone() {
  const invalidate = useInvalidateMilestones()
  return useMutation({
    mutationFn: (input: {
      roadmapId: RoadmapId
      milestoneId: string
      title?: string
      description?: string | null
      date?: Date
      precision?: TimelinePrecision
    }) => {
      const { roadmapId: _roadmapId, ...data } = input
      return updateMilestoneFn({ data: data as Parameters<typeof updateMilestoneFn>[0]['data'] })
    },
    onSuccess: (_result, input) => invalidate(input.roadmapId),
  })
}

export function useDeleteMilestone() {
  const invalidate = useInvalidateMilestones()
  return useMutation({
    mutationFn: (input: { roadmapId: RoadmapId; milestoneId: string }) =>
      deleteMilestoneFn({
        data: {
          milestoneId: input.milestoneId as Parameters<
            typeof deleteMilestoneFn
          >[0]['data']['milestoneId'],
        },
      }),
    onSuccess: (_result, input) => invalidate(input.roadmapId),
  })
}
