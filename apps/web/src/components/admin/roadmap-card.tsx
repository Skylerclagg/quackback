import { memo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronUpIcon, Squares2X2Icon, CalendarIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { PlacementPopover } from './roadmap/placement-popover'
import { formatMonthYear } from '@/lib/shared/utils'
import { formatTimelineLabel, type TimelinePrecision } from '@/lib/shared/timeline'
import type { RoadmapViewPost } from '@/lib/shared/types'

interface RoadmapCardProps {
  post: RoadmapViewPost
  placementId: string
  onClick?: () => void
  /**
   * When provided, the ETA chip opens a date + vagueness picker. Dragging a
   * card between buckets sets the month; this is how an admin sets an exact
   * day, or deliberately shows only a quarter or a year.
   */
  onSetEta?: (date: Date, precision: TimelinePrecision) => void
  onClearEta?: () => void
}

export const RoadmapCard = memo(function RoadmapCard({
  post,
  placementId,
  onClick,
  onSetEta,
  onClearEta,
}: RoadmapCardProps) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: post.id,
    data: { type: 'Task', post, placementId },
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
      <CardContent post={post} onSetEta={onSetEta} onClearEta={onClearEta} />
    </div>
  )
})

function etaLabelFor(post: RoadmapViewPost): string | null {
  if (!post.eta) return null
  return post.etaPrecision
    ? formatTimelineLabel(new Date(post.eta), post.etaPrecision)
    : formatMonthYear(post.eta)
}

function CardContent({
  post,
  onSetEta,
  onClearEta,
}: {
  post: RoadmapViewPost
  onSetEta?: (date: Date, precision: TimelinePrecision) => void
  onClearEta?: () => void
}) {
  const etaLabel = etaLabelFor(post)
  const etaChip = etaLabel ? (
    <Badge variant="secondary" className="text-xs inline-flex items-center gap-0.5">
      <CalendarIcon className="h-3 w-3 text-muted-foreground/40" />
      {etaLabel}
    </Badge>
  ) : onSetEta ? (
    <Badge
      variant="outline"
      className="text-xs inline-flex items-center gap-0.5 text-muted-foreground border-dashed"
    >
      <CalendarIcon className="h-3 w-3" />
      Set date
    </Badge>
  ) : null

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
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          <Badge variant="secondary" className="text-xs inline-flex items-center gap-0.5">
            <Squares2X2Icon className="h-3 w-3 text-muted-foreground/40" />
            {post.board.name}
          </Badge>
          {etaChip &&
            (onSetEta ? (
              // Stop the click reaching the card (which opens the post) and the
              // pointer-down reaching dnd-kit (which would start a drag).
              <span
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <PlacementPopover
                  initialDate={post.eta ? new Date(post.eta) : undefined}
                  initialPrecision={post.etaPrecision ?? 'month'}
                  onApply={onSetEta}
                  onClear={post.eta && onClearEta ? onClearEta : undefined}
                >
                  <button
                    type="button"
                    aria-label={etaLabel ? `Change ETA (${etaLabel})` : 'Set ETA'}
                    className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {etaChip}
                  </button>
                </PlacementPopover>
              </span>
            ) : (
              etaChip
            ))}
        </div>
      </div>
    </>
  )
}

export function RoadmapCardOverlay({ post }: { post: RoadmapViewPost }) {
  return (
    <div className="flex bg-card rounded-lg border border-border/50 shadow-lg cursor-grabbing w-[320px]">
      <CardContent post={post} />
    </div>
  )
}
