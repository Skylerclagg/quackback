/**
 * Date + vagueness picker for timeline placements. The admin picks any
 * date inside the period plus a precision; the server snaps the date
 * to the bucket start. A live preview shows exactly how the bucket
 * will read. Shared by the timeline admin view and the roadmap
 * column cards.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import {
  TIMELINE_PRECISIONS,
  TIMELINE_PRECISION_LABELS,
  formatTimelineLabel,
  type TimelinePrecision,
} from '@/lib/shared/timeline'

export function PlacementPopover({
  children,
  initialDate,
  initialPrecision,
  onApply,
  onClear,
}: {
  children: React.ReactNode
  initialDate?: Date
  initialPrecision?: TimelinePrecision
  onApply: (date: Date, precision: TimelinePrecision) => void
  /** When provided, shows a "Remove from timeline" action. */
  onClear?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState<Date | undefined>(initialDate)
  const [precision, setPrecision] = useState<TimelinePrecision>(initialPrecision ?? 'month')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1.5">
          <Label className="text-xs">Date</Label>
          <DateTimePicker value={date} onChange={setDate} dateOnly className="h-8 w-full text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Shown as</Label>
          <Select value={precision} onValueChange={(v) => setPrecision(v as TimelinePrecision)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMELINE_PRECISIONS.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {TIMELINE_PRECISION_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {date && (
          <p className="text-xs text-muted-foreground">
            Will appear under <strong>{formatTimelineLabel(date, precision)}</strong>
          </p>
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={!date}
          onClick={() => {
            if (date) {
              onApply(date, precision)
              setOpen(false)
            }
          }}
        >
          Apply
        </Button>
        {onClear && initialDate && (
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => {
              onClear()
              setOpen(false)
            }}
          >
            Remove from timeline
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
