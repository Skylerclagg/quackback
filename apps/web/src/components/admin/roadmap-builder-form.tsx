import { useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { RoadmapView } from '@/lib/client/hooks/use-roadmaps-query'
import {
  TIMELINE_SPECIFICITIES,
  type EtaDisclosure,
  type PostStatusEntity,
  type TimelineSpecificity,
} from '@/lib/shared/db-types'
import { TIMELINE_SPECIFICITY_LABELS } from '@/lib/shared/timeline'
import type {
  BoardId,
  PostStatusId,
  PostTagId,
  RoadmapColumnId,
  SegmentId,
  PrincipalId,
} from '@quackback/ids'
import { TeamAccessField } from '@/components/admin/audience-fields'
import type { RoadmapFrequency, RoadmapType, RoadmapVisibility } from '@/lib/shared/roadmap-config'

export interface RoadmapBuilderValue {
  name: string
  description?: string
  type: RoadmapType
  baseFilter: {
    statusIds?: PostStatusId[]
    boardIds?: BoardId[]
    tagIds?: PostTagId[]
    segmentIds?: SegmentId[]
  }
  frequency: RoadmapFrequency | null
  visibility: RoadmapVisibility
  visibleSegmentIds: SegmentId[] | null
  /** null = every team actor; [] = admins only; [ids] = admins plus those principals. */
  allowedTeamPrincipalIds: PrincipalId[] | null
  etaDisclosure: EtaDisclosure
  timelineEnabled: boolean
  columns: Array<{
    id?: RoadmapColumnId
    statusId: PostStatusId
    name: string
    icon: string | null
    color: string
    position: number
  }>
}

interface NamedOption {
  id: string
  name: string
}

interface RoadmapBuilderFormProps {
  roadmap?: RoadmapView | null
  statuses: PostStatusEntity[]
  boards: NamedOption[]
  tags: NamedOption[]
  segments: NamedOption[]
  isPending: boolean
  submitLabel: string
  onCancel: () => void
  onSubmit: (value: RoadmapBuilderValue) => Promise<void>
}

function initialColumns(roadmap: RoadmapView | null | undefined, statuses: PostStatusEntity[]) {
  if (roadmap) {
    return roadmap.columns.map(({ roadmapId: _roadmapId, ...column }) => column)
  }
  return statuses
    .filter((status) => status.showOnRoadmap)
    .map((status, position) => ({
      statusId: status.id,
      name: status.name,
      icon: null,
      color: status.color,
      position,
    }))
}

function FilterOptions({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: NamedOption[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  if (!options.length) return null
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {options.map((option) => {
          const checked = selected.includes(option.id)
          return (
            <label key={option.id} className="flex items-center gap-1.5 text-[13px]">
              <Checkbox
                checked={checked}
                onCheckedChange={(next) =>
                  onChange(
                    next ? [...selected, option.id] : selected.filter((id) => id !== option.id)
                  )
                }
              />
              {option.name}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function RoadmapBuilderForm({
  roadmap,
  statuses,
  boards,
  tags,
  segments,
  isPending,
  submitLabel,
  onCancel,
  onSubmit,
}: RoadmapBuilderFormProps) {
  const [name, setName] = useState(roadmap?.name ?? '')
  const [description, setDescription] = useState(roadmap?.description ?? '')
  const [type, setType] = useState<RoadmapType>(roadmap?.type ?? 'column')
  const [frequency, setFrequency] = useState<RoadmapFrequency>(roadmap?.frequency ?? 'monthly')
  const [visibility, setVisibility] = useState<RoadmapVisibility>(roadmap?.visibility ?? 'public')
  const [visibleSegmentIds, setVisibleSegmentIds] = useState<string[]>(
    roadmap?.visibleSegmentIds ?? []
  )
  const [allowedTeamPrincipalIds, setAllowedTeamPrincipalIds] = useState<string[] | null>(
    roadmap?.allowedTeamPrincipalIds ?? null
  )
  const [timelineEnabled, setTimelineEnabled] = useState<boolean>(roadmap?.timelineEnabled ?? false)
  const [disclosureDefault, setDisclosureDefault] = useState<TimelineSpecificity>(
    roadmap?.etaDisclosure?.default ?? 'day'
  )
  const [disclosureSegments, setDisclosureSegments] = useState<
    Array<{ segmentId: string; specificity: TimelineSpecificity }>
  >(roadmap?.etaDisclosure?.segments ?? [])
  const [statusIds, setStatusIds] = useState<string[]>(roadmap?.baseFilter.statusIds ?? [])
  const [boardIds, setBoardIds] = useState<string[]>(roadmap?.baseFilter.boardIds ?? [])
  const [tagIds, setTagIds] = useState<string[]>(roadmap?.baseFilter.tagIds ?? [])
  const [segmentIds, setSegmentIds] = useState<string[]>(roadmap?.baseFilter.segmentIds ?? [])
  const [columns, setColumns] = useState<RoadmapBuilderValue['columns']>(() =>
    initialColumns(roadmap, statuses)
  )

  function toggleColumn(status: PostStatusEntity, checked: boolean) {
    if (!checked) {
      setColumns((current) =>
        current
          .filter((column) => column.statusId !== status.id)
          .map((column, position) => ({ ...column, position }))
      )
      return
    }
    setColumns((current) => [
      ...current,
      {
        statusId: status.id,
        name: status.name,
        icon: null,
        color: status.color,
        position: current.length,
      },
    ])
  }

  function moveColumn(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= columns.length) return
    setColumns((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((column, position) => ({ ...column, position }))
    })
  }

  function addDisclosureRow() {
    const used = new Set(disclosureSegments.map((row) => row.segmentId))
    const next = segments.find((segment) => !used.has(segment.id))
    if (!next) return
    setDisclosureSegments((current) => [...current, { segmentId: next.id, specificity: 'day' }])
  }

  function updateDisclosureRow(
    index: number,
    patch: Partial<{ segmentId: string; specificity: TimelineSpecificity }>
  ) {
    setDisclosureSegments((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row))
    )
  }

  function removeDisclosureRow(index: number) {
    setDisclosureSegments((current) => current.filter((_, i) => i !== index))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    await onSubmit({
      name,
      description: description || undefined,
      type,
      baseFilter: {
        ...(statusIds.length ? { statusIds: statusIds as PostStatusId[] } : {}),
        ...(boardIds.length ? { boardIds: boardIds as BoardId[] } : {}),
        ...(tagIds.length ? { tagIds: tagIds as PostTagId[] } : {}),
        ...(segmentIds.length ? { segmentIds: segmentIds as SegmentId[] } : {}),
      },
      frequency: type === 'date' ? frequency : null,
      visibility,
      visibleSegmentIds: visibility === 'segment' ? (visibleSegmentIds as SegmentId[]) : null,
      allowedTeamPrincipalIds:
        visibility === 'public' ? null : (allowedTeamPrincipalIds as PrincipalId[] | null),
      etaDisclosure: { default: disclosureDefault, segments: disclosureSegments },
      // A date roadmap IS the timeline; the toggle only means something on columns.
      timelineEnabled: type === 'column' ? timelineEnabled : false,
      columns:
        type === 'column' ? columns.map((column, position) => ({ ...column, position })) : [],
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ScrollArea className="max-h-[65vh] overflow-hidden -mx-1 px-1">
        <div className="space-y-5 pe-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="roadmap-name">Name</Label>
              <Input
                id="roadmap-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Product roadmap"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="roadmap-type">Layout</Label>
              <select
                id="roadmap-type"
                className={selectClass}
                value={type}
                onChange={(event) => setType(event.target.value as RoadmapType)}
              >
                <option value="column">Status columns</option>
                <option value="date">Date periods</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="roadmap-description">Description</Label>
            <Input
              id="roadmap-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this view communicates"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {type === 'date' && (
              <div className="space-y-2">
                <Label htmlFor="roadmap-frequency">Frequency</Label>
                <select
                  id="roadmap-frequency"
                  className={selectClass}
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value as RoadmapFrequency)}
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="semiannual">Semiannual</option>
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="roadmap-visibility">Visibility</Label>
              <select
                id="roadmap-visibility"
                className={selectClass}
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as RoadmapVisibility)}
              >
                <option value="public">Public</option>
                <option value="team">Team only</option>
                <option value="segment">Customer segments</option>
              </select>
            </div>
          </div>

          {visibility === 'segment' && (
            <div className="rounded-lg border border-border/60 p-3">
              <FilterOptions
                label="Visible to"
                options={segments}
                selected={visibleSegmentIds}
                onChange={setVisibleSegmentIds}
              />
              {!visibleSegmentIds.length && (
                <p className="mt-2 text-xs text-destructive">Select at least one segment.</p>
              )}
            </div>
          )}

          {visibility !== 'public' && (
            <div className="rounded-lg border border-border/60 p-3">
              <TeamAccessField
                idPrefix="roadmap"
                entityLabel="roadmap"
                value={allowedTeamPrincipalIds}
                onChange={setAllowedTeamPrincipalIds}
              />
            </div>
          )}

          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <div>
              <h3 className="text-sm font-medium">Timeline</h3>
              <p className="text-xs text-muted-foreground">
                {type === 'date'
                  ? 'This roadmap is a timeline. Choose how precisely dates are shown to each audience.'
                  : 'Optionally offer a date-bucketed timeline view alongside the columns.'}
              </p>
            </div>
            {type === 'column' && (
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox
                  checked={timelineEnabled}
                  onCheckedChange={(next) => setTimelineEnabled(next === true)}
                />
                Also offer a timeline view
              </label>
            )}
            {(type === 'date' || timelineEnabled) && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="roadmap-disclosure">Dates shown to everyone as</Label>
                  <select
                    id="roadmap-disclosure"
                    className={selectClass}
                    value={disclosureDefault}
                    onChange={(event) =>
                      setDisclosureDefault(event.target.value as TimelineSpecificity)
                    }
                  >
                    {TIMELINE_SPECIFICITIES.map((specificity) => (
                      <option key={specificity} value={specificity}>
                        {TIMELINE_SPECIFICITY_LABELS[specificity]}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Team admins always see exact dates. &ldquo;Hidden&rdquo; removes the timeline
                    for viewers without an override below.
                  </p>
                </div>
                {segments.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Show more precise dates to
                    </span>
                    {disclosureSegments.map((row, index) => (
                      <div key={`${row.segmentId}-${index}`} className="flex items-center gap-2">
                        <select
                          aria-label="Segment"
                          className={selectClass}
                          value={row.segmentId}
                          onChange={(event) =>
                            updateDisclosureRow(index, { segmentId: event.target.value })
                          }
                        >
                          {segments.map((segment) => (
                            <option key={segment.id} value={segment.id}>
                              {segment.name}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Specificity"
                          className={selectClass}
                          value={row.specificity}
                          onChange={(event) =>
                            updateDisclosureRow(index, {
                              specificity: event.target.value as TimelineSpecificity,
                            })
                          }
                        >
                          {TIMELINE_SPECIFICITIES.map((specificity) => (
                            <option key={specificity} value={specificity}>
                              {TIMELINE_SPECIFICITY_LABELS[specificity]}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeDisclosureRow(index)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addDisclosureRow}
                      disabled={disclosureSegments.length >= segments.length}
                    >
                      Add segment override
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <div>
              <h3 className="text-sm font-medium">Base filter</h3>
              <p className="text-xs text-muted-foreground">
                Posts must match these constraints before placement.
              </p>
            </div>
            <FilterOptions
              label="Statuses"
              options={statuses}
              selected={statusIds}
              onChange={setStatusIds}
            />
            <FilterOptions
              label="Boards"
              options={boards}
              selected={boardIds}
              onChange={setBoardIds}
            />
            <FilterOptions label="Tags" options={tags} selected={tagIds} onChange={setTagIds} />
            <FilterOptions
              label="Author segments"
              options={segments}
              selected={segmentIds}
              onChange={setSegmentIds}
            />
          </div>

          {type === 'column' && (
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <div>
                <h3 className="text-sm font-medium">Columns</h3>
                <p className="text-xs text-muted-foreground">
                  Each status can appear once. Dragging a card changes only its status.
                </p>
              </div>
              <div className="space-y-2">
                {statuses.map((status) => {
                  const columnIndex = columns.findIndex((column) => column.statusId === status.id)
                  const column = columns[columnIndex]
                  return (
                    <div key={status.id} className="rounded-md bg-muted/35 p-2.5">
                      <label className="flex items-center gap-2 text-[13px] font-medium">
                        <Checkbox
                          checked={!!column}
                          onCheckedChange={(checked) => toggleColumn(status, !!checked)}
                        />
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: status.color }}
                        />
                        {status.name}
                      </label>
                      {column && (
                        <div className="mt-2 grid grid-cols-[1fr_90px_auto] gap-2 ps-6">
                          <Input
                            value={column.name}
                            aria-label={`${status.name} column name`}
                            onChange={(event) =>
                              setColumns((current) =>
                                current.map((item, index) =>
                                  index === columnIndex
                                    ? { ...item, name: event.target.value }
                                    : item
                                )
                              )
                            }
                          />
                          <Input
                            value={column.icon ?? ''}
                            aria-label={`${status.name} column icon`}
                            placeholder="Icon"
                            onChange={(event) =>
                              setColumns((current) =>
                                current.map((item, index) =>
                                  index === columnIndex
                                    ? { ...item, icon: event.target.value || null }
                                    : item
                                )
                              )
                            }
                          />
                          <div className="flex items-center gap-1">
                            <input
                              type="color"
                              value={column.color}
                              aria-label={`${status.name} column color`}
                              onChange={(event) =>
                                setColumns((current) =>
                                  current.map((item, index) =>
                                    index === columnIndex
                                      ? { ...item, color: event.target.value }
                                      : item
                                  )
                                )
                              }
                              className="size-8 rounded border border-input bg-background p-1"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={columnIndex === 0}
                              onClick={() => moveColumn(columnIndex, -1)}
                              aria-label={`Move ${status.name} left`}
                            >
                              <ChevronLeftIcon className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={columnIndex === columns.length - 1}
                              onClick={() => moveColumn(columnIndex, 1)}
                              aria-label={`Move ${status.name} right`}
                            >
                              <ChevronRightIcon className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={
            isPending ||
            (visibility === 'segment' && !visibleSegmentIds.length) ||
            (type === 'column' && !columns.length)
          }
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
