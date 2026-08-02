import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowPathIcon,
  LockClosedIcon,
  MapIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { AudienceFields } from '@/components/admin/audience-fields'
import { changelogQueries } from '@/lib/client/queries/changelog'
import {
  useCreateChangelogCollection,
  useUpdateChangelogCollection,
  useDeleteChangelogCollection,
} from '@/lib/client/mutations/changelog'
import { useRoadmaps } from '@/lib/client/hooks/use-roadmaps-query'
import { slugify } from '@/lib/shared/utils'
import type { ChangelogCollectionId } from '@quackback/ids'

interface CollectionRow {
  id: string
  slug: string
  name: string
  description: string | null
  roadmapId: string | null
  roadmapName: string | null
  isPublic: boolean
  allowedSegmentIds: string[]
  allowedTeamPrincipalIds: string[]
  entryCount: number
}

/**
 * Admin management for named changelog collections: create, edit
 * (including a roadmap link and the audience trio), and delete.
 * Deleting a collection moves its entries back to General.
 */
export function ManageChangelogsDialog() {
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<CollectionRow | null>(null)
  const [deleting, setDeleting] = useState<CollectionRow | null>(null)

  // Shared form state for the create/edit sub-dialogs
  const [roadmapId, setRoadmapId] = useState<string | null>(null)
  const [isPublic, setIsPublic] = useState(true)
  const [segmentIds, setSegmentIds] = useState<string[]>([])
  const [teamIds, setTeamIds] = useState<string[]>([])

  const { data: collections = [], isLoading } = useQuery(changelogQueries.collections())
  const { data: roadmaps = [] } = useRoadmaps({ enabled: open })
  const createCollection = useCreateChangelogCollection()
  const updateCollection = useUpdateChangelogCollection()
  const deleteCollection = useDeleteChangelogCollection()

  function resetFormState() {
    setRoadmapId(null)
    setIsPublic(true)
    setSegmentIds([])
    setTeamIds([])
  }

  const handleCreateOpenChange = (isOpen: boolean) => {
    setCreateOpen(isOpen)
    if (!isOpen) {
      resetFormState()
      createCollection.reset()
    }
  }

  const openEdit = (collection: CollectionRow) => {
    setEditing(collection)
    setRoadmapId(collection.roadmapId)
    setIsPublic(collection.isPublic)
    setSegmentIds(collection.allowedSegmentIds ?? [])
    setTeamIds(collection.allowedTeamPrincipalIds ?? [])
  }

  const handleEditOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setEditing(null)
      resetFormState()
      updateCollection.reset()
    }
  }

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const description = formData.get('description') as string

    try {
      await createCollection.mutateAsync({
        name,
        slug: slugify(name),
        description: description || undefined,
        roadmapId,
        isPublic,
        allowedSegmentIds: isPublic ? [] : segmentIds,
        allowedTeamPrincipalIds: isPublic ? [] : teamIds,
      })
      handleCreateOpenChange(false)
    } catch (error) {
      console.error('Failed to create changelog:', error)
    }
  }

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editing) return
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const description = formData.get('description') as string

    try {
      await updateCollection.mutateAsync({
        id: editing.id,
        name,
        description: description || null,
        roadmapId,
        isPublic,
        allowedSegmentIds: isPublic ? [] : segmentIds,
        allowedTeamPrincipalIds: isPublic ? [] : teamIds,
      })
      handleEditOpenChange(false)
    } catch (error) {
      console.error('Failed to update changelog:', error)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await deleteCollection.mutateAsync(deleting.id as ChangelogCollectionId)
      setDeleting(null)
    } catch (error) {
      console.error('Failed to delete changelog:', error)
    }
  }

  const roadmapSelect = (
    <div className="space-y-2">
      <Label>Roadmap (optional)</Label>
      <Select
        value={roadmapId ?? 'none'}
        onValueChange={(value) => setRoadmapId(value === 'none' ? null : value)}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="No roadmap" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No roadmap</SelectItem>
          {roadmaps.map((roadmap) => (
            <SelectItem key={roadmap.id} value={roadmap.id}>
              {roadmap.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Link this changelog to the roadmap it documents.
      </p>
    </div>
  )

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Cog6ToothIcon className="h-4 w-4 mr-1.5" />
            Manage
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Changelogs</DialogTitle>
            <DialogDescription>
              Create additional changelogs — for example one per roadmap or product area. Entries
              not filed under a changelog appear in General.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <ArrowPathIcon className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-1">
              {collections.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No changelogs yet — all entries live in General.
                </p>
              ) : (
                collections.map((collection) => (
                  <div
                    key={collection.id}
                    className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{collection.name}</span>
                        {!collection.isPublic && (
                          <LockClosedIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>
                          {collection.entryCount}{' '}
                          {collection.entryCount === 1 ? 'entry' : 'entries'}
                        </span>
                        {collection.roadmapName && (
                          <>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="flex items-center gap-1 truncate">
                              <MapIcon className="h-3 w-3 shrink-0" />
                              {collection.roadmapName}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <EllipsisHorizontalIcon className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(collection)}>
                          <PencilIcon className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeleting(collection)}
                          className="text-destructive focus:text-destructive"
                        >
                          <TrashIcon className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))
              )}

              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground"
                onClick={() => setCreateOpen(true)}
              >
                <PlusIcon className="h-4 w-4 mr-1.5" />
                New changelog
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Changelog</DialogTitle>
            <DialogDescription>
              A separate changelog with its own portal tab, RSS feed, and audience.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="changelog-name">Name</Label>
              <Input id="changelog-name" name="name" placeholder="Mobile App" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="changelog-description">Description (optional)</Label>
              <Input
                id="changelog-description"
                name="description"
                placeholder="Updates to our mobile apps"
              />
            </div>
            {roadmapSelect}
            <AudienceFields
              idPrefix="create-changelog"
              entityLabel="changelog"
              isPublic={isPublic}
              onIsPublicChange={setIsPublic}
              segmentIds={segmentIds}
              onSegmentIdsChange={setSegmentIds}
              teamPrincipalIds={teamIds}
              onTeamPrincipalIdsChange={setTeamIds}
            />
            {createCollection.isError && (
              <p className="text-sm text-destructive">{createCollection.error.message}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => handleCreateOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createCollection.isPending}>
                {createCollection.isPending && (
                  <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={handleEditOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Changelog</DialogTitle>
            <DialogDescription>Update this changelog's details and audience.</DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-changelog-name">Name</Label>
                <Input id="edit-changelog-name" name="name" defaultValue={editing.name} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-changelog-description">Description (optional)</Label>
                <Input
                  id="edit-changelog-description"
                  name="description"
                  defaultValue={editing.description ?? ''}
                />
              </div>
              {roadmapSelect}
              <AudienceFields
                idPrefix="edit-changelog"
                entityLabel="changelog"
                isPublic={isPublic}
                onIsPublicChange={setIsPublic}
                segmentIds={segmentIds}
                onSegmentIdsChange={setSegmentIds}
                teamPrincipalIds={teamIds}
                onTeamPrincipalIdsChange={setTeamIds}
              />
              {updateCollection.isError && (
                <p className="text-sm text-destructive">{updateCollection.error.message}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => handleEditOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateCollection.isPending}>
                  {updateCollection.isPending && (
                    <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(isOpen) => !isOpen && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="Entries in this changelog are not deleted — they move back to the General changelog."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteCollection.isPending}
        onConfirm={handleDelete}
      />
    </>
  )
}
