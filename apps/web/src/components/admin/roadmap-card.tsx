import { memo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronUpIcon, Squares2X2Icon, CalendarDaysIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { formatTimelineLabel, type TimelinePrecision } from '@/lib/shared/timeline'
import type { RoadmapPostEntry } from '@/lib/shared/types'

interface RoadmapCardProps {
  post: RoadmapPostEntry
  statusId: string
  onClick?: () => void
}

export const RoadmapCard = memo(function RoadmapCard({
  post,
  statusId,
  onClick,
}: RoadmapCardProps) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: post.id,
    data: { type: 'Task', post, statusId },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className="flex bg-card rounded-lg border border-border/50 shadow-sm cursor-pointer hover:bg-card/80 transition-opacity duration-150"
      {...attributes}
      {...listeners}
    >
      <CardContent post={post} />
    </div>
  )
})

/**
 * Read-only timeline chip: shows the placement ("Q2 2026") once a date
 * has been set (via the post modal or the timeline view). No controls
 * here — cards stay purely clickable/draggable.
 */
function CardPlacementChip({ post }: { post: RoadmapPostEntry }) {
  const entry = post.roadmapEntry
  if (!entry.timelineDate || !entry.timelinePrecision) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <CalendarDaysIcon className="h-3 w-3" />
      {formatTimelineLabel(
        new Date(entry.timelineDate),
        entry.timelinePrecision as TimelinePrecision
      )}
    </span>
  )
}

function CardContent({ post }: { post: RoadmapPostEntry }) {
  return (
    <>
      <div className="flex flex-col items-center justify-center w-14 shrink-0 border-r border-border/50 text-muted-foreground">
        <ChevronUpIcon className="h-4 w-4" />
        <span className="text-sm font-semibold text-foreground">{post.voteCount}</span>
      </div>
      <div className="flex-1 min-w-0 p-4">
        <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
          {post.title}
        </p>
        <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-xs inline-flex items-center gap-0.5">
            <Squares2X2Icon className="h-3 w-3 text-muted-foreground/40" />
            {post.board.name}
          </Badge>
          <CardPlacementChip post={post} />
        </div>
      </div>
    </>
  )
}

export function RoadmapCardOverlay({ post }: { post: RoadmapPostEntry }) {
  return (
    <div className="flex bg-card rounded-lg border border-border/50 shadow-lg cursor-grabbing w-[320px]">
      <CardContent post={post} />
    </div>
  )
}
