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
  CheckIcon,
  ChevronUpDownIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import { cn, slugify } from '@/lib/shared/utils'
import { useRoadmaps } from '@/lib/client/hooks/use-roadmaps-query'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { useCreateRoadmap, useUpdateRoadmap, useDeleteRoadmap } from '@/lib/client/mutations'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import type { Roadmap } from '@/lib/shared/db-types'

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
  const [editIsPublic, setEditIsPublic] = useState(true)
  const [editSegmentIds, setEditSegmentIds] = useState<string[]>([])
  const [editTeamIds, setEditTeamIds] = useState<string[]>([])

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
                    <RoadmapVisibilityFields
                      idPrefix="create"
                      isPublic={createIsPublic}
                      onIsPublicChange={setCreateIsPublic}
                      segmentIds={createSegmentIds}
                      onSegmentIdsChange={setCreateSegmentIds}
                      teamPrincipalIds={createTeamIds}
                      onTeamPrincipalIdsChange={setCreateTeamIds}
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
              <RoadmapVisibilityFields
                idPrefix="edit"
                isPublic={editIsPublic}
                onIsPublicChange={setEditIsPublic}
                segmentIds={editSegmentIds}
                onSegmentIdsChange={setEditSegmentIds}
                teamPrincipalIds={editTeamIds}
                onTeamPrincipalIdsChange={setEditTeamIds}
              />
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

interface RoadmapVisibilityFieldsProps {
  idPrefix: string
  isPublic: boolean
  onIsPublicChange: (next: boolean) => void
  segmentIds: string[]
  onSegmentIdsChange: (next: string[]) => void
  teamPrincipalIds: string[]
  onTeamPrincipalIdsChange: (next: string[]) => void
}

/**
 * Public switch + private-roadmap access pickers for the create/edit
 * dialogs. Public roadmaps are visible to everyone, so both pickers
 * only show for private roadmaps: admins always have access, selected
 * team members and selected segments' customers also gain it.
 */
function RoadmapVisibilityFields({
  idPrefix,
  isPublic,
  onIsPublicChange,
  segmentIds,
  onSegmentIdsChange,
  teamPrincipalIds,
  onTeamPrincipalIdsChange,
}: RoadmapVisibilityFieldsProps) {
  const { data: segments } = useSegments()
  const { data: teamMembers } = useQuery(adminQueries.teamMembers())
  const segmentItems = (segments ?? []).map((seg) => ({
    id: String(seg.id),
    name: seg.name,
    memberCount: seg.memberCount,
  }))
  // Admins bypass the allowlist, so only member-role teammates are pickable.
  const memberItems = (teamMembers ?? [])
    .filter((m) => m.role === 'member')
    .map((m) => ({
      id: String(m.id),
      name: m.name || m.email || 'Team member',
      email: m.email ?? undefined,
    }))

  return (
    <>
      <div className="flex items-center space-x-2">
        <Switch id={`${idPrefix}-isPublic`} checked={isPublic} onCheckedChange={onIsPublicChange} />
        <Label htmlFor={`${idPrefix}-isPublic`}>Public</Label>
      </div>
      {!isPublic && (
        <div className="space-y-2">
          <Label>Team access</Label>
          <p className="text-xs text-muted-foreground">
            {memberItems.length > 0
              ? 'Admins always see this roadmap. Select team members who can also view it.'
              : 'Admins always see this roadmap. Team members you invite later can be granted access here.'}
          </p>
          {memberItems.length > 0 && (
            <TeamMemberPicker
              options={memberItems}
              value={teamPrincipalIds}
              onChange={onTeamPrincipalIdsChange}
            />
          )}
        </div>
      )}
      {!isPublic && (
        <div className="space-y-2">
          <Label>Share with segments</Label>
          <p className="text-xs text-muted-foreground">
            {segmentItems.length > 0
              ? 'Select segments to share this roadmap with their members on the portal.'
              : 'Create segments under Settings → People to share private roadmaps with specific customers.'}
          </p>
          {segmentItems.length > 0 && (
            <div className="max-h-36 overflow-y-auto pr-1">
              <SegmentMultiSelect
                segments={segmentItems}
                value={segmentIds}
                onChange={onSegmentIdsChange}
                ariaLabel="Roadmap segment allowlist"
              />
            </div>
          )}
        </div>
      )}
    </>
  )
}

interface TeamMemberOption {
  id: string
  name: string
  email?: string
}

/**
 * Searchable multi-select for granting team members roadmap access:
 * a combobox (Popover + cmdk) to find people by name or email, with
 * the current grants shown as removable chips. Stays open on select
 * so several people can be added in one pass.
 */
function TeamMemberPicker({
  options,
  value,
  onChange,
}: {
  options: TeamMemberOption[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = new Set(value)
  const selectedOptions = options.filter((o) => selected.has(o.id))

  const toggle = (id: string) => {
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label="Add team members"
            className="w-full justify-between font-normal text-muted-foreground"
          >
            Search team members…
            <ChevronUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
          {/* Remount Command on each open so the search input is empty. */}
          {open && (
            <Command>
              <CommandInput placeholder="Search by name or email…" />
              <CommandList>
                <CommandEmpty>No team members found.</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option.id}
                      value={`${option.name} ${option.email ?? ''}`}
                      onSelect={() => toggle(option.id)}
                    >
                      <CheckIcon
                        className={cn(
                          'mr-2 h-4 w-4',
                          selected.has(option.id) ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="truncate">{option.name}</span>
                        {option.email && (
                          <span className="text-xs text-muted-foreground truncate">
                            {option.email}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((o) => (
            <Badge key={o.id} variant="secondary" className="gap-1 pr-1">
              {o.name}
              <button
                type="button"
                aria-label={`Remove ${o.name}`}
                className="rounded-sm hover:bg-muted-foreground/20 p-0.5"
                onClick={() => toggle(o.id)}
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
