/**
 * Admin timeline view for a roadmap.
 *
 * Vertical list of date buckets ("March 2026", "Q2 2026", …) holding
 * roadmap posts and free-text milestones. Admins date items with a
 * date + vagueness picker, reorder within a bucket via up/down
 * controls, and manage milestones inline. Undated roadmap posts wait
 * in the Unscheduled lane at the bottom.
 */
import { useState } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowPathIcon,
  CalendarDaysIcon,
  ChevronUpIcon,
  FlagIcon,
  PencilIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { PlacementPopover } from './placement-popover'
import { EmptyState } from '@/components/shared/empty-state'
import { cn } from '@/lib/shared/utils'
import {
  TIMELINE_PRECISIONS,
  TIMELINE_PRECISION_LABELS,
  formatTimelineLabel,
  groupTimelineItems,
  type TimelinePrecision,
} from '@/lib/shared/timeline'
import {
  useRoadmapTimeline,
  type TimelineMilestoneData,
  type TimelinePostData,
} from '@/lib/client/hooks/use-roadmap-timeline'
import {
  useCreateMilestone,
  useDeleteMilestone,
  useReorderTimelineBucket,
  useSetTimelinePlacement,
  useUpdateMilestone,
} from '@/lib/client/mutations/roadmap-timeline'
import type { PostStatusEntity } from '@/lib/shared/db-types'

type PlacedItem =
  | (Omit<TimelinePostData, 'timelineDate' | 'timelinePrecision'> & {
      kind: 'post'
      timelineDate: Date
      timelinePrecision: TimelinePrecision
      timelinePosition: number
    })
  | (Omit<TimelineMilestoneData, 'timelineDate'> & {
      kind: 'milestone'
      timelineDate: Date
      timelinePrecision: TimelinePrecision
      timelinePosition: number
    })

interface RoadmapTimelineAdminProps {
  roadmapId: string
  statuses: PostStatusEntity[]
  onCardClick: (postId: string) => void
}

export function RoadmapTimelineAdmin({
  roadmapId,
  statuses,
  onCardClick,
}: RoadmapTimelineAdminProps) {
  const { data, isLoading, isError } = useRoadmapTimeline(roadmapId)
  const setPlacement = useSetTimelinePlacement()
  const reorderBucket = useReorderTimelineBucket()
  const deleteMilestoneMutation = useDeleteMilestone()
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState<TimelineMilestoneData | null>(null)
  const [deletingMilestone, setDeletingMilestone] = useState<TimelineMilestoneData | null>(null)

  // A member capped to 'hidden' in timelineAccess.teamMembers gets a
  // 404 from the timeline fetch — show that plainly instead of a
  // spinner that never resolves.
  if (isError) {
    return (
      <EmptyState
        icon={CalendarDaysIcon}
        title="Timeline not available"
        description="The timeline view for this roadmap is restricted for your account"
      />
    )
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <ArrowPathIcon className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const statusMap = new Map(statuses.map((s) => [String(s.id), s]))

  const placed: PlacedItem[] = [
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
  const unscheduled = data.posts.filter((p) => !p.timelineDate)

  const moveWithinBucket = (items: PlacedItem[], index: number, delta: number) => {
    const next = [...items]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    reorderBucket.mutate({
      roadmapId,
      items: next.map((i) => ({ kind: i.kind, id: i.id })),
    })
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setMilestoneDialogOpen(true)}>
          <PlusIcon className="h-4 w-4 mr-1.5" />
          Add milestone
        </Button>
      </div>

      {buckets.length === 0 && unscheduled.length === 0 ? (
        <EmptyState
          icon={CalendarDaysIcon}
          title="Nothing on the timeline yet"
          description="Date roadmap posts or add a milestone to build the timeline"
        />
      ) : (
        <div className="relative space-y-8 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-border">
          {buckets.map((bucket) => (
            <div key={bucket.key} className="relative pl-8">
              <span className="absolute left-0 top-1 h-[15px] w-[15px] rounded-full border-2 border-primary bg-background" />
              <h3 className="text-sm font-semibold mb-2">{bucket.label}</h3>
              <div className="space-y-1.5">
                {bucket.items.map((item, index) => (
                  <div
                    key={`${item.kind}:${item.id}`}
                    className="group flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2"
                  >
                    {item.kind === 'milestone' ? (
                      <FlagIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: item.statusId
                            ? (statusMap.get(item.statusId)?.color ?? '#94a3b8')
                            : '#94a3b8',
                        }}
                      />
                    )}
                    <button
                      type="button"
                      className={cn(
                        'flex-1 min-w-0 text-left text-sm truncate',
                        item.kind === 'post' && 'hover:underline cursor-pointer'
                      )}
                      onClick={() => item.kind === 'post' && onCardClick(item.id)}
                    >
                      {item.title}
                      {item.kind === 'post' && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                          <ChevronUpIcon className="h-3 w-3" />
                          {item.voteCount}
                        </span>
                      )}
                    </button>

                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label="Move up"
                        disabled={index === 0}
                        onClick={() => moveWithinBucket(bucket.items, index, -1)}
                      >
                        <ArrowUpIcon className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label="Move down"
                        disabled={index === bucket.items.length - 1}
                        onClick={() => moveWithinBucket(bucket.items, index, 1)}
                      >
                        <ArrowDownIcon className="h-3 w-3" />
                      </Button>
                      {item.kind === 'post' ? (
                        <>
                          <PlacementPopover
                            initialDate={item.timelineDate}
                            initialPrecision={item.timelinePrecision}
                            onApply={(date, precision) =>
                              setPlacement.mutate({
                                roadmapId,
                                postId: item.id,
                                placement: { date, precision },
                              })
                            }
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              aria-label="Change date"
                            >
                              <CalendarDaysIcon className="h-3 w-3" />
                            </Button>
                          </PlacementPopover>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-label="Remove from timeline"
                            onClick={() =>
                              setPlacement.mutate({ roadmapId, postId: item.id, placement: null })
                            }
                          >
                            <XMarkIcon className="h-3 w-3" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-label="Edit milestone"
                            onClick={() => {
                              const source = data.milestones.find((m) => m.id === item.id)
                              if (source) {
                                setEditingMilestone(source)
                                setMilestoneDialogOpen(true)
                              }
                            }}
                          >
                            <PencilIcon className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive"
                            aria-label="Delete milestone"
                            onClick={() => {
                              const source = data.milestones.find((m) => m.id === item.id)
                              if (source) setDeletingMilestone(source)
                            }}
                          >
                            <XMarkIcon className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {unscheduled.length > 0 && (
        <div className="border-t border-border/50 pt-5">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">Unscheduled</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Posts on this roadmap without a timeline date. Give one a date to place it.
          </p>
          <div className="space-y-1.5">
            {unscheduled.map((post) => (
              <div
                key={post.id}
                className="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-2"
              >
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left text-sm truncate hover:underline"
                  onClick={() => onCardClick(post.id)}
                >
                  {post.title}
                </button>
                <PlacementPopover
                  onApply={(date, precision) =>
                    setPlacement.mutate({
                      roadmapId,
                      postId: post.id,
                      placement: { date, precision },
                    })
                  }
                >
                  <Button variant="outline" size="sm" className="h-7 text-xs">
                    <CalendarDaysIcon className="h-3 w-3 mr-1" />
                    Schedule
                  </Button>
                </PlacementPopover>
              </div>
            ))}
          </div>
        </div>
      )}

      <MilestoneDialog
        roadmapId={roadmapId}
        open={milestoneDialogOpen}
        onOpenChange={(open) => {
          setMilestoneDialogOpen(open)
          if (!open) setEditingMilestone(null)
        }}
        editing={editingMilestone}
      />

      <ConfirmDialog
        open={deletingMilestone !== null}
        onOpenChange={(open) => !open && setDeletingMilestone(null)}
        title="Delete Milestone"
        description={`Delete "${deletingMilestone?.title}" from the timeline?`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMilestoneMutation.isPending}
        onConfirm={() => {
          if (deletingMilestone) {
            deleteMilestoneMutation.mutate(deletingMilestone.id, {
              onSuccess: () => setDeletingMilestone(null),
            })
          }
        }}
      />
    </div>
  )
}

function MilestoneDialog({
  roadmapId,
  open,
  onOpenChange,
  editing,
}: {
  roadmapId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: TimelineMilestoneData | null
}) {
  const createMilestone = useCreateMilestone()
  const updateMilestone = useUpdateMilestone()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [precision, setPrecision] = useState<TimelinePrecision>('month')
  const [seededFor, setSeededFor] = useState<string | null>(null)

  // Seed fields when the dialog opens (create = blank, edit = current values).
  const seedKey = open ? (editing?.id ?? 'create') : null
  if (seedKey && seedKey !== seededFor) {
    setSeededFor(seedKey)
    setTitle(editing?.title ?? '')
    setDescription(editing?.description ?? '')
    setDate(editing ? new Date(editing.timelineDate) : undefined)
    setPrecision(editing?.timelinePrecision ?? 'month')
  }
  if (!seedKey && seededFor) setSeededFor(null)

  const isPending = createMilestone.isPending || updateMilestone.isPending

  const handleSubmit = () => {
    if (!title.trim() || !date) return
    const common = { title: title.trim(), description: description.trim() || undefined }
    if (editing) {
      updateMilestone.mutate(
        { milestoneId: editing.id, ...common, date, precision },
        { onSuccess: () => onOpenChange(false) }
      )
    } else {
      createMilestone.mutate(
        { roadmapId, ...common, date, precision },
        { onSuccess: () => onOpenChange(false) }
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Milestone' : 'Add Milestone'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="milestone-title">Title</Label>
            <Input
              id="milestone-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Mobile app beta"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="milestone-description">Description (optional)</Label>
            <Input
              id="milestone-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What ships with this milestone"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Date</Label>
              <DateTimePicker value={date} onChange={setDate} dateOnly className="h-9 w-full" />
            </div>
            <div className="space-y-2">
              <Label>Shown as</Label>
              <Select value={precision} onValueChange={(v) => setPrecision(v as TimelinePrecision)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMELINE_PRECISIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {TIMELINE_PRECISION_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {date && (
            <p className="text-xs text-muted-foreground">
              Will appear under <strong>{formatTimelineLabel(date, precision)}</strong>
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!title.trim() || !date || isPending}
              onClick={handleSubmit}
            >
              {isPending && <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />}
              {editing ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
