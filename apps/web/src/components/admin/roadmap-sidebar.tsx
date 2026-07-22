import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  PlusIcon,
  MapIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
  ArrowPathIcon,
  LockClosedIcon,
  UserGroupIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PageHeader } from '@/components/shared/page-header'
import { FilterSection } from '@/components/shared/filter-section'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { cn, slugify } from '@/lib/shared/utils'
import { useRoadmaps } from '@/lib/client/hooks/use-roadmaps-query'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { useCreateRoadmap, useUpdateRoadmap, useDeleteRoadmap } from '@/lib/client/mutations'
import { AudienceFields } from '@/components/admin/audience-fields'
import {
  TIMELINE_SPECIFICITIES,
  TIMELINE_SPECIFICITY_LABELS,
  type TimelineSpecificity,
} from '@/lib/shared/timeline'
import { DEFAULT_TIMELINE_ACCESS } from '@/lib/shared/db-types'
import type { Roadmap, TimelineAccess } from '@/lib/shared/db-types'

interface RoadmapSidebarProps {
  selectedRoadmapId: string | null
  onSelectRoadmap: (roadmapId: string | null) => void
}

export function RoadmapSidebar({ selectedRoadmapId, onSelectRoadmap }: RoadmapSidebarProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [editingRoadmap, setEditingRoadmap] = useState<Roadmap | null>(null)
  const [deletingRoadmap, setDeletingRoadmap] = useState<Roadmap | null>(null)
  const [createIsPublic, setCreateIsPublic] = useState(true)
  const [createSegmentIds, setCreateSegmentIds] = useState<string[]>([])
  const [createTeamIds, setCreateTeamIds] = useState<string[]>([])
  const [createTimelineAccess, setCreateTimelineAccess] =
    useState<TimelineAccess>(DEFAULT_TIMELINE_ACCESS)
  const [editIsPublic, setEditIsPublic] = useState(true)
  const [editSegmentIds, setEditSegmentIds] = useState<string[]>([])
  const [editTeamIds, setEditTeamIds] = useState<string[]>([])
  const [editTimelineAccess, setEditTimelineAccess] =
    useState<TimelineAccess>(DEFAULT_TIMELINE_ACCESS)

  const { data: roadmaps, isLoading } = useRoadmaps()
  const createRoadmap = useCreateRoadmap()
  const updateRoadmap = useUpdateRoadmap()
  const deleteRoadmap = useDeleteRoadmap()

  const handleCreateDialogChange = (open: boolean) => {
    setIsCreateDialogOpen(open)
    if (!open) {
      setCreateIsPublic(true)
      setCreateSegmentIds([])
      setCreateTeamIds([])
      setCreateTimelineAccess(DEFAULT_TIMELINE_ACCESS)
    }
  }

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const description = formData.get('description') as string

    try {
      const newRoadmap = await createRoadmap.mutateAsync({
        name,
        slug: slugify(name),
        description: description || undefined,
        isPublic: createIsPublic,
        allowedSegmentIds: createIsPublic ? [] : createSegmentIds,
        allowedTeamPrincipalIds: createIsPublic ? [] : createTeamIds,
        timelineAccess: createTimelineAccess,
      })
      handleCreateDialogChange(false)
      onSelectRoadmap(newRoadmap.id)
    } catch (error) {
      console.error('Failed to create roadmap:', error)
    }
  }

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingRoadmap) return

    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const description = formData.get('description') as string

    try {
      await updateRoadmap.mutateAsync({
        roadmapId: editingRoadmap.id,
        input: {
          name,
          description,
          isPublic: editIsPublic,
          allowedSegmentIds: editIsPublic ? [] : editSegmentIds,
          allowedTeamPrincipalIds: editIsPublic ? [] : editTeamIds,
          timelineAccess: editTimelineAccess,
        },
      })
      setIsEditDialogOpen(false)
      setEditingRoadmap(null)
    } catch (error) {
      console.error('Failed to update roadmap:', error)
    }
  }

  const handleDelete = async () => {
    if (!deletingRoadmap) return

    try {
      await deleteRoadmap.mutateAsync(deletingRoadmap.id)
      setIsDeleteDialogOpen(false)
      setDeletingRoadmap(null)
      if (selectedRoadmapId === deletingRoadmap.id) {
        onSelectRoadmap(roadmaps?.[0]?.id ?? null)
      }
    } catch (error) {
      console.error('Failed to delete roadmap:', error)
    }
  }

  const openEditDialog = (roadmap: Roadmap) => {
    setEditingRoadmap(roadmap)
    setEditIsPublic(roadmap.isPublic)
    setEditSegmentIds(roadmap.allowedSegmentIds ?? [])
    setEditTeamIds(roadmap.allowedTeamPrincipalIds ?? [])
    setEditTimelineAccess(roadmap.timelineAccess ?? DEFAULT_TIMELINE_ACCESS)
    setIsEditDialogOpen(true)
  }

  const openDeleteDialog = (roadmap: Roadmap) => {
    setDeletingRoadmap(roadmap)
    setIsDeleteDialogOpen(true)
  }

  return (
    <aside className="w-64 xl:w-72 shrink-0 flex flex-col border-r border-border/50 bg-card/30 overflow-hidden">
      <div className="shrink-0 px-4 py-3.5">
        <PageHeader icon={MapIcon} title="Roadmap" />
      </div>

      {/* Selector + list — the "Roadmaps" subheading routes through the shared
          FilterSection (static label + create button in the action slot) so it
          matches every other admin left pane. */}
      <ScrollArea className="flex-1">
        <div className="px-5 pb-5">
          <FilterSection
            title="Roadmaps"
            collapsible={false}
            action={
              <Dialog open={isCreateDialogOpen} onOpenChange={handleCreateDialogChange}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <PlusIcon className="h-3 w-3" />
                  </button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Create Roadmap</DialogTitle>
                    <DialogDescription>
                      Create a new roadmap to organize your posts into a public timeline.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleCreateSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Name</Label>
                      <Input id="name" name="name" placeholder="Product Roadmap" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description (optional)</Label>
                      <Input
                        id="description"
                        name="description"
                        placeholder="Our upcoming features and improvements"
                      />
                    </div>
                    <AudienceFields
                      idPrefix="create"
                      entityLabel="roadmap"
                      isPublic={createIsPublic}
                      onIsPublicChange={setCreateIsPublic}
                      segmentIds={createSegmentIds}
                      onSegmentIdsChange={setCreateSegmentIds}
                      teamPrincipalIds={createTeamIds}
                      onTeamPrincipalIdsChange={setCreateTeamIds}
                    />
                    <TimelineAccessFields
                      value={createTimelineAccess}
                      onChange={setCreateTimelineAccess}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleCreateDialogChange(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createRoadmap.isPending}>
                        {createRoadmap.isPending && (
                          <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        Create
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            }
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <ArrowPathIcon className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : roadmaps?.length === 0 ? (
              <EmptyState
                icon={MapIcon}
                title="No roadmaps yet"
                description="Create your first roadmap to get started"
                className="py-12"
              />
            ) : (
              <div className="space-y-1">
                {roadmaps?.map((roadmap) => (
                  <div
                    key={roadmap.id}
                    className={cn(
                      'group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer font-medium transition-colors',
                      selectedRoadmapId === roadmap.id
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                    onClick={() => onSelectRoadmap(roadmap.id)}
                  >
                    <MapIcon
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        selectedRoadmapId === roadmap.id ? 'text-primary' : ''
                      )}
                    />
                    <span className="flex-1 text-xs truncate">{roadmap.name}</span>
                    {!roadmap.isPublic &&
                      ((roadmap.allowedSegmentIds?.length ?? 0) +
                        (roadmap.allowedTeamPrincipalIds?.length ?? 0) >
                      0 ? (
                        <span title="Private — shared with selected people" className="shrink-0">
                          <UserGroupIcon className="h-3 w-3 text-muted-foreground/60" />
                        </span>
                      ) : (
                        <span title="Private — admins only" className="shrink-0">
                          <LockClosedIcon className="h-3 w-3 text-muted-foreground/60" />
                        </span>
                      ))}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 -mr-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <EllipsisVerticalIcon className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditDialog(roadmap)}>
                          <PencilIcon className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => openDeleteDialog(roadmap)}
                        >
                          <TrashIcon className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </FilterSection>
        </div>
      </ScrollArea>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Roadmap</DialogTitle>
            <DialogDescription>Update your roadmap settings.</DialogDescription>
          </DialogHeader>
          {editingRoadmap && (
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input id="edit-name" name="name" defaultValue={editingRoadmap.name} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description (optional)</Label>
                <Input
                  id="edit-description"
                  name="description"
                  defaultValue={editingRoadmap.description || ''}
                />
              </div>
              <AudienceFields
                idPrefix="edit"
                entityLabel="roadmap"
                isPublic={editIsPublic}
                onIsPublicChange={setEditIsPublic}
                segmentIds={editSegmentIds}
                onSegmentIdsChange={setEditSegmentIds}
                teamPrincipalIds={editTeamIds}
                onTeamPrincipalIdsChange={setEditTeamIds}
              />
              <TimelineAccessFields value={editTimelineAccess} onChange={setEditTimelineAccess} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateRoadmap.isPending}>
                  {updateRoadmap.isPending && (
                    <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete Roadmap"
        description={`Are you sure you want to delete "${deletingRoadmap?.name}"? This will remove all posts from this roadmap. The posts themselves will not be deleted.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteRoadmap.isPending}
        onConfirm={handleDelete}
      />
    </aside>
  )
}

/**
 * Per-audience cap on timeline date specificity. "Everyone else" is
 * the default cap (Hidden … Exact day); per-segment overrides grant a
 * finer view to chosen segments (a viewer takes the finest matching
 * cap). The team always sees exact placements.
 */
function TimelineAccessFields({
  value,
  onChange,
}: {
  value: TimelineAccess
  onChange: (next: TimelineAccess) => void
}) {
  const { data: segments } = useSegments()
  const { data: teamMembers } = useQuery(adminQueries.teamMembers())
  const segmentOptions = (segments ?? []).map((s) => ({ id: String(s.id), name: s.name }))
  const overridden = new Set(value.segments.map((s) => s.segmentId))
  const available = segmentOptions.filter((s) => !overridden.has(s.id))
  const memberOptions = (teamMembers ?? [])
    .filter((m) => m.role === 'member')
    .map((m) => ({ id: String(m.id), name: m.name || m.email || 'Team member' }))
  const memberOverrides = value.teamMembers ?? []
  const overriddenMembers = new Set(memberOverrides.map((o) => o.principalId))
  const availableMembers = memberOptions.filter((m) => !overriddenMembers.has(m.id))

  return (
    <div className="space-y-2">
      <Label>Timeline dates</Label>
      <p className="text-xs text-muted-foreground">
        How specific the timeline view is for portal visitors. Your team always sees exact
        placements; &ldquo;Hidden&rdquo; removes the timeline view for that audience.
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Everyone else</span>
        <SpecificitySelect
          value={value.default}
          onChange={(next) => onChange({ ...value, default: next })}
        />
      </div>
      {value.segments.map((override) => (
        <div key={override.segmentId} className="flex items-center justify-between gap-2">
          <span className="flex-1 min-w-0 truncate text-xs">
            {segmentOptions.find((s) => s.id === override.segmentId)?.name ?? 'Unknown segment'}
          </span>
          <SpecificitySelect
            value={override.specificity}
            onChange={(next) =>
              onChange({
                ...value,
                segments: value.segments.map((s) =>
                  s.segmentId === override.segmentId ? { ...s, specificity: next } : s
                ),
              })
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label="Remove segment override"
            onClick={() =>
              onChange({
                ...value,
                segments: value.segments.filter((s) => s.segmentId !== override.segmentId),
              })
            }
          >
            <XMarkIcon className="h-3 w-3" />
          </Button>
        </div>
      ))}
      {available.length > 0 && (
        <Select
          value=""
          onValueChange={(segmentId) =>
            onChange({
              ...value,
              segments: [...value.segments, { segmentId, specificity: 'day' }],
            })
          }
        >
          <SelectTrigger className="h-7 w-full text-xs text-muted-foreground">
            <SelectValue placeholder="Add segment override…" />
          </SelectTrigger>
          <SelectContent>
            {available.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-xs">
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {memberOverrides.map((override) => (
        <div key={override.principalId} className="flex items-center justify-between gap-2">
          <span className="flex-1 min-w-0 truncate text-xs">
            {memberOptions.find((m) => m.id === override.principalId)?.name ?? 'Unknown member'}
          </span>
          <SpecificitySelect
            value={override.specificity}
            onChange={(next) =>
              onChange({
                ...value,
                teamMembers: memberOverrides.map((o) =>
                  o.principalId === override.principalId ? { ...o, specificity: next } : o
                ),
              })
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label="Remove member override"
            onClick={() =>
              onChange({
                ...value,
                teamMembers: memberOverrides.filter((o) => o.principalId !== override.principalId),
              })
            }
          >
            <XMarkIcon className="h-3 w-3" />
          </Button>
        </div>
      ))}
      {availableMembers.length > 0 && (
        <Select
          value=""
          onValueChange={(principalId) =>
            onChange({
              ...value,
              teamMembers: [...memberOverrides, { principalId, specificity: 'hidden' }],
            })
          }
        >
          <SelectTrigger className="h-7 w-full text-xs text-muted-foreground">
            <SelectValue placeholder="Cap a team member…" />
          </SelectTrigger>
          <SelectContent>
            {availableMembers.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

function SpecificitySelect({
  value,
  onChange,
}: {
  value: TimelineSpecificity
  onChange: (next: TimelineSpecificity) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TimelineSpecificity)}>
      <SelectTrigger className="h-7 w-32 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TIMELINE_SPECIFICITIES.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {TIMELINE_SPECIFICITY_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
