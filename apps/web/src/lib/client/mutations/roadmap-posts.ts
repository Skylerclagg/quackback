/**
 * Roadmap posts mutations
 *
 * Mutation hooks for adding/removing posts from roadmaps.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { RoadmapId, PostId } from '@quackback/ids'
import {
  addPostToRoadmapFn,
  removePostFromRoadmapFn,
  bulkAddPostsToRoadmapFn,
} from '@/lib/server/functions/roadmaps'
import { roadmapPostsKeys } from '@/lib/client/hooks/use-roadmap-posts-query'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'

/**
 * Hook to add a post to a roadmap.
 */
export function useAddPostToRoadmap(roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (postId: PostId) => addPostToRoadmapFn({ data: { roadmapId, postId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...roadmapPostsKeys.all, 'roadmap', roadmapId] })
    },
  })
}

/**
 * Hook to add many posts to a roadmap at once (bulk assign from the inbox).
 *
 * Posts already on the roadmap are reported as skipped, not errors.
 */
export function useBulkAddPostsToRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ roadmapId, postIds }: { roadmapId: RoadmapId; postIds: PostId[] }) =>
      bulkAddPostsToRoadmapFn({ data: { roadmapId, postIds } }),
    onSuccess: ({ added, skipped, failed }) => {
      queryClient.invalidateQueries({ queryKey: roadmapPostsKeys.all })
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
      toast.success(
        `Added ${added} ${added === 1 ? 'post' : 'posts'} to roadmap${
          skipped > 0 ? ` (${skipped} already on it)` : ''
        }`
      )
      if (failed.length > 0) {
        toast.error(`${failed.length} ${failed.length === 1 ? 'post' : 'posts'} could not be added`)
      }
    },
    onError: () => {
      toast.error('Failed to add posts to roadmap')
    },
  })
}

/**
 * Hook to remove a post from a roadmap.
 */
export function useRemovePostFromRoadmap(roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (postId: PostId) => removePostFromRoadmapFn({ data: { roadmapId, postId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...roadmapPostsKeys.all, 'roadmap', roadmapId] })
    },
  })
}
