/**
 * The milestones of a roadmap timeline, rendered as a strip above the bucket
 * columns. Grouped into the same buckets the columns use, so a milestone sits
 * visually with the posts it dates. Read-only on the portal; editable in admin.
 *
 * Dates arrive already coarsened to the viewer's disclosure cap on the portal,
 * so rendering them verbatim is safe.
 */
import { FlagIcon, PlusIcon } from '@heroicons/react/24/solid'
import { PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { formatTimelineLabel, type TimelinePrecision } from '@/lib/shared/timeline'

export interface MilestoneStripItem {
  id: string
  title: string
  description: string | null
  timelineDate: string
  timelinePrecision: string
}

export function RoadmapMilestonesStrip({
  milestones,
  onAdd,
  onEdit,
  onDelete,
}: {
  milestones: MilestoneStripItem[]
  /** Present in admin only; renders the "Add milestone" affordance. */
  onAdd?: () => void
  onEdit?: (milestone: MilestoneStripItem) => void
  onDelete?: (milestone: MilestoneStripItem) => void
}) {
  const editable = !!onEdit || !!onDelete
  if (milestones.length === 0 && !onAdd) return null

  const sorted = [...milestones].sort(
    (a, b) =>
      new Date(a.timelineDate).getTime() - new Date(b.timelineDate).getTime() ||
      a.title.localeCompare(b.title)
  )

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="roadmap-milestones">
      {sorted.map((m) => (
        <div
          key={m.id}
          className="group inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 ps-2.5 pe-1.5 py-1 text-xs"
          title={m.description ?? undefined}
        >
          <FlagIcon className="h-3 w-3 shrink-0 text-primary" aria-hidden />
          <span className="font-medium">{m.title}</span>
          <span className="text-muted-foreground">
            ·{' '}
            {formatTimelineLabel(
              new Date(m.timelineDate),
              m.timelinePrecision as TimelinePrecision
            )}
          </span>
          {editable && (
            <span className="ms-0.5 inline-flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              {onEdit && (
                <button
                  type="button"
                  aria-label={`Edit milestone ${m.title}`}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => onEdit(m)}
                >
                  <PencilSquareIcon className="h-3.5 w-3.5" />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  aria-label={`Delete milestone ${m.title}`}
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(m)}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          )}
        </div>
      ))}
      {onAdd && (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAdd}>
          <PlusIcon className="h-3.5 w-3.5 me-1" />
          Add milestone
        </Button>
      )}
    </div>
  )
}
