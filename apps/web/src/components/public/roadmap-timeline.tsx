/**
 * Portal timeline view for a roadmap — read-only date buckets of
 * roadmap posts and milestones. Server-side the payload is already
 * audience-filtered (canViewRoadmap + boardViewFilter + published).
 */
import { useIntl } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { CalendarDaysIcon, FlagIcon, ChevronUpIcon } from '@heroicons/react/24/solid'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { usePublicRoadmapTimeline } from '@/lib/client/hooks/use-roadmap-timeline'
import { groupTimelineItems, type TimelinePrecision } from '@/lib/shared/timeline'
import type { PostStatusEntity } from '@/lib/shared/db-types'

interface RoadmapTimelineProps {
  roadmapId: string
  statuses: PostStatusEntity[]
}

export function RoadmapTimeline({ roadmapId, statuses }: RoadmapTimelineProps) {
  const intl = useIntl()
  const { data, isLoading } = usePublicRoadmapTimeline(roadmapId)

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <ArrowPathIcon className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const statusMap = new Map(statuses.map((s) => [String(s.id), s]))
  const placed = [
    ...data.posts
      .filter((p) => p.timelineDate && p.timelinePrecision)
      .map((p) => ({
        ...p,
        kind: 'post' as const,
        timelineDate: new Date(p.timelineDate as string),
        timelinePrecision: p.timelinePrecision as TimelinePrecision,
      })),
    ...data.milestones.map((m) => ({
      ...m,
      kind: 'milestone' as const,
      timelineDate: new Date(m.timelineDate),
    })),
  ]
  const buckets = groupTimelineItems(placed, (i) => `${i.kind}:${i.id}`)

  if (buckets.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <CalendarDaysIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground">
            {intl.formatMessage({
              id: 'portal.roadmap.timeline.empty.title',
              defaultMessage: 'No timeline yet',
            })}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {intl.formatMessage({
              id: 'portal.roadmap.timeline.empty.description',
              defaultMessage: 'Check back later to see what’s planned.',
            })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto w-full relative space-y-8 py-2 before:absolute before:left-[7px] before:top-4 before:bottom-4 before:w-px before:bg-border">
      {buckets.map((bucket, bucketIndex) => (
        <div
          key={bucket.key}
          className="relative pl-8 animate-in fade-in duration-200 fill-mode-backwards"
          style={{ animationDelay: `${bucketIndex * 60}ms` }}
        >
          <span className="absolute left-0 top-1 h-[15px] w-[15px] rounded-full border-2 border-primary bg-background" />
          <h3 className="text-sm font-semibold mb-2">{bucket.label}</h3>
          <div className="space-y-1.5">
            {bucket.items.map((item) =>
              item.kind === 'post' ? (
                <Link
                  key={`post:${item.id}`}
                  to="/b/$slug/posts/$postId"
                  params={{ slug: item.board.slug, postId: item.id }}
                  className="flex items-center gap-2.5 rounded-md border border-border/60 bg-card px-3 py-2 hover:border-border hover:bg-muted/40 transition-colors"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: item.statusId
                        ? (statusMap.get(item.statusId)?.color ?? '#94a3b8')
                        : '#94a3b8',
                    }}
                  />
                  <span className="flex-1 min-w-0 text-sm truncate">{item.title}</span>
                  <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
                    <ChevronUpIcon className="h-3 w-3" />
                    {item.voteCount}
                  </span>
                </Link>
              ) : (
                <div
                  key={`milestone:${item.id}`}
                  className="flex items-start gap-2.5 rounded-md border border-primary/20 bg-primary/5 px-3 py-2"
                >
                  <FlagIcon className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" />
                  <div className="min-w-0">
                    <span className="block text-sm font-medium">{item.title}</span>
                    {item.description && (
                      <span className="block text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
