/**
 * Create / edit a roadmap milestone: a title, an optional description, and a
 * date plus how vaguely to show it. The server snaps the date to the start of
 * the chosen period, and the live preview shows exactly how the bucket reads.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { RoadmapId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateMilestone, useUpdateMilestone } from '@/lib/client/mutations/roadmaps'
import {
  TIMELINE_PRECISIONS,
  TIMELINE_PRECISION_LABELS,
  formatTimelineLabel,
  type TimelinePrecision,
} from '@/lib/shared/timeline'

export interface MilestoneDialogItem {
  id: string
  title: string
  description: string | null
  timelineDate: string
  timelinePrecision: string
}

export function MilestoneDialog({
  open,
  onOpenChange,
  roadmapId,
  editing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roadmapId: RoadmapId
  /** When set, the dialog edits this milestone instead of creating one. */
  editing: MilestoneDialogItem | null
}) {
  const create = useCreateMilestone()
  const update = useUpdateMilestone()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [precision, setPrecision] = useState<TimelinePrecision>('month')

  useEffect(() => {
    if (!open) return
    setTitle(editing?.title ?? '')
    setDescription(editing?.description ?? '')
    setDate(editing ? new Date(editing.timelineDate) : undefined)
    setPrecision((editing?.timelinePrecision as TimelinePrecision | undefined) ?? 'month')
  }, [open, editing])

  const pending = create.isPending || update.isPending
  const canSubmit = title.trim().length > 0 && !!date && !pending

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!date) return
    try {
      if (editing) {
        await update.mutateAsync({
          roadmapId,
          milestoneId: editing.id,
          title: title.trim(),
          description: description.trim() || null,
          date,
          precision,
        })
        toast.success('Milestone updated')
      } else {
        await create.mutateAsync({
          roadmapId,
          title: title.trim(),
          description: description.trim() || undefined,
          date,
          precision,
        })
        toast.success('Milestone added')
      }
      onOpenChange(false)
    } catch {
      toast.error(editing ? 'Could not update the milestone.' : 'Could not add the milestone.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit milestone' : 'Add milestone'}</DialogTitle>
            <DialogDescription>
              A dated marker on the timeline that isn&apos;t a post — a launch, a beta closing, a
              deadline.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="milestone-title">Title</Label>
            <Input
              id="milestone-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="GA launch"
              maxLength={200}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="milestone-description">Description</Label>
            <Textarea
              id="milestone-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              maxLength={2000}
              rows={2}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Date</Label>
              <DateTimePicker value={date} onChange={setDate} dateOnly className="w-full" />
            </div>
            <div className="space-y-2">
              <Label>Shown as</Label>
              <Select value={precision} onValueChange={(v) => setPrecision(v as TimelinePrecision)}>
                <SelectTrigger>
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

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {editing ? 'Save' : 'Add milestone'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
