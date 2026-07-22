/**
 * Roadmap timeline mutations. Every mutation invalidates the whole
 * timeline key space — the payloads are small and positions/buckets
 * interact, so a refetch is simpler than surgical cache edits.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  setPostTimelinePlacementFn,
  createMilestoneFn,
  updateMilestoneFn,
  deleteMilestoneFn,
  reorderTimelineBucketFn,
} from '@/lib/server/functions/roadmap-timeline'
import { timelineKeys } from '@/lib/client/hooks/use-roadmap-timeline'
import { roadmapPostsKeys } from '@/lib/client/hooks/use-roadmap-posts-query'
import type { TimelinePrecision } from '@/lib/shared/timeline'

function useInvalidateTimeline() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: timelineKeys.all })
    // Column cards render the placement label from the roadmap-posts
    // payload, so placements must refresh that cache too.
    queryClient.invalidateQueries({ queryKey: roadmapPostsKeys.all })
  }
}

export function useSetTimelinePlacement() {
  const invalidate = useInvalidateTimeline()
  return useMutation({
    mutationFn: (input: {
      roadmapId: string
      postId: string
      placement: { date: Date; precision: TimelinePrecision } | null
    }) =>
      setPostTimelinePlacementFn({
        data: {
          roadmapId: input.roadmapId,
          postId: input.postId,
          date: input.placement?.date ?? null,
          precision: input.placement?.precision ?? null,
        },
      }),
    onSuccess: invalidate,
  })
}

export function useCreateMilestone() {
  const invalidate = useInvalidateTimeline()
  return useMutation({
    mutationFn: (input: {
      roadmapId: string
      title: string
      description?: string
      date: Date
      precision: TimelinePrecision
    }) => createMilestoneFn({ data: input }),
    onSuccess: invalidate,
  })
}

export function useUpdateMilestone() {
  const invalidate = useInvalidateTimeline()
  return useMutation({
    mutationFn: (input: {
      milestoneId: string
      title?: string
      description?: string | null
      date?: Date
      precision?: TimelinePrecision
    }) => updateMilestoneFn({ data: input }),
    onSuccess: invalidate,
  })
}

export function useDeleteMilestone() {
  const invalidate = useInvalidateTimeline()
  return useMutation({
    mutationFn: (milestoneId: string) => deleteMilestoneFn({ data: { milestoneId } }),
    onSuccess: invalidate,
  })
}

export function useReorderTimelineBucket() {
  const invalidate = useInvalidateTimeline()
  return useMutation({
    mutationFn: (input: {
      roadmapId: string
      items: Array<{ kind: 'post' | 'milestone'; id: string }>
    }) => reorderTimelineBucketFn({ data: input }),
    onSuccess: invalidate,
  })
}
