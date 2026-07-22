/**
 * Roadmap timeline query hooks. Mutations live in
 * @/lib/client/mutations/roadmap-timeline.
 */
import { useQuery } from '@tanstack/react-query'
import {
  getRoadmapTimelineFn,
  fetchPublicRoadmapTimeline,
} from '@/lib/server/functions/roadmap-timeline'

/** Serialized timeline payload (Dates are ISO strings on the wire). */
export type RoadmapTimelineData = Awaited<ReturnType<typeof getRoadmapTimelineFn>>
export type TimelinePostData = RoadmapTimelineData['posts'][number]
export type TimelineMilestoneData = RoadmapTimelineData['milestones'][number]

export const timelineKeys = {
  all: ['roadmap-timeline'] as const,
  admin: (roadmapId: string) => [...timelineKeys.all, 'admin', roadmapId] as const,
  public: (roadmapId: string) => [...timelineKeys.all, 'public', roadmapId] as const,
}

export function useRoadmapTimeline(roadmapId: string | null) {
  return useQuery({
    queryKey: timelineKeys.admin(roadmapId ?? 'none'),
    queryFn: () => getRoadmapTimelineFn({ data: { roadmapId: roadmapId as string } }),
    enabled: !!roadmapId,
  })
}

export function usePublicRoadmapTimeline(roadmapId: string | null) {
  return useQuery({
    queryKey: timelineKeys.public(roadmapId ?? 'none'),
    queryFn: () => fetchPublicRoadmapTimeline({ data: { roadmapId: roadmapId as string } }),
    enabled: !!roadmapId,
    staleTime: 2 * 60 * 1000,
  })
}
