import { useState, useCallback, useEffect } from 'react'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { ModalFooter } from '@/components/shared/modal-footer'
import { useUrlModal } from '@/lib/client/hooks/use-url-modal'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Loader2 } from 'lucide-react'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { ModalHeader } from '@/components/shared/modal-header'
import { UrlModalShell } from '@/components/shared/url-modal-shell'
import { updateChangelogSchema } from '@/lib/shared/schemas/changelog'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import { useDeleteChangelog, useUpdateChangelog } from '@/lib/client/mutations/changelog'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { toast } from 'sonner'
import { LockClosedIcon } from '@heroicons/react/24/outline'
import { listChangelogSourcesFn } from '@/lib/server/functions/changelog-sources'
import { TrashIcon } from '@heroicons/react/24/solid'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { ChangelogFormFields } from './changelog-form-fields'
import { ChangelogMetadataSidebar } from './changelog-metadata-sidebar'
import { ChangelogMetadataSidebarContent } from './changelog-metadata-sidebar-content'
import type { AudienceVisibility } from '@/lib/server/policy/audience'
import { toPublishState, type PublishState } from '@/lib/shared/schemas/changelog'
import { Route } from '@/routes/admin/changelog'
import {
  type ChangelogId,
  type PostId,
  type ChangelogCategoryId,
  type SegmentId,
  type PrincipalId,
} from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'

interface ChangelogModalProps {
  entryId: string | undefined
}

interface ChangelogModalContentProps {
  entryId: ChangelogId
  onClose: () => void
}

function ChangelogModalContent({ entryId, onClose }: ChangelogModalContentProps) {
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [linkedPostIds, setLinkedPostIds] = useState<PostId[]>([])
  const [categoryIds, setCategoryIds] = useState<ChangelogCategoryId[]>([])
  const [notify, setNotify] = useState(true)
  const [segmentIds, setSegmentIds] = useState<SegmentId[]>([])
  const [segmentIdsTouched, setSegmentIdsTouched] = useState(false)
  const [visibility, setVisibility] = useState<AudienceVisibility>('public')
  const [visibleSegmentIds, setVisibleSegmentIds] = useState<SegmentId[]>([])
  const [allowedTeamPrincipalIds, setAllowedTeamPrincipalIds] = useState<PrincipalId[] | null>(null)
  const [audienceTouched, setAudienceTouched] = useState(false)
  const handleVisibilityChange = (next: AudienceVisibility) => {
    setVisibility(next)
    setAudienceTouched(true)
  }
  const handleVisibleSegmentIdsChange = (next: SegmentId[]) => {
    setVisibleSegmentIds(next)
    setAudienceTouched(true)
  }
  const handleAllowedTeamPrincipalIdsChange = (next: PrincipalId[] | null) => {
    setAllowedTeamPrincipalIds(next)
    setAudienceTouched(true)
  }
  const [publishState, setPublishState] = useState<PublishState>({ type: 'draft' })
  const [displayDateOverride, setDisplayDateOverride] = useState<Date | undefined>(undefined)
  const [displayDateTouched, setDisplayDateTouched] = useState(false)
  const [featuredImageUrl, setFeaturedImageUrl] = useState<string | null>(null)
  const [featuredImageTouched, setFeaturedImageTouched] = useState(false)
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)

  const updateChangelogMutation = useUpdateChangelog()
  const deleteChangelogMutation = useDeleteChangelog()
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Fetch existing changelog data
  const { data: entry, isLoading } = useQuery({
    ...changelogQueries.detail(entryId),
  })

  // Source name for the imported-entry notice; shares the settings card's cache key.
  const sourcesQuery = useQuery({
    queryKey: ['admin', 'changelog', 'sources'],
    queryFn: () => listChangelogSourcesFn(),
    enabled: !!entry?.sourceId,
    staleTime: 60_000,
  })
  const importedFrom = entry?.sourceId
    ? (sourcesQuery.data?.find((src) => src.id === entry.sourceId)?.name ?? 'an external changelog')
    : null
  // A live entry is frozen; the footer's primary action becomes Unpublish.
  const locked = entry?.status === 'published'

  const form = useForm({
    resolver: standardSchemaResolver(updateChangelogSchema),
    defaultValues: {
      id: entryId as string,
      title: '',
      content: '',
      linkedPostIds: [] as string[],
      publishState: { type: 'draft' as const },
    },
  })

  // Initialize form with fetched data
  useEffect(() => {
    if (entry && !hasInitialized) {
      form.setValue('title', entry.title)
      form.setValue('content', entry.content)
      setContentJson(entry.contentJson as JSONContent | null)
      setLinkedPostIds(entry.linkedPosts.map((p) => p.id))
      setCategoryIds(entry.categories.map((c) => c.id))
      setPublishState(toPublishState(entry.status, entry.publishedAt))
      setDisplayDateOverride(entry.displayDate ? new Date(entry.displayDate) : undefined)
      setDisplayDateTouched(false)
      setFeaturedImageUrl(entry.featuredImageUrl)
      setFeaturedImageTouched(false)
      setSegmentIds((entry.segmentIds ?? []) as SegmentId[])
      setSegmentIdsTouched(false)
      setVisibility(entry.visibility ?? 'public')
      setVisibleSegmentIds((entry.visibleSegmentIds ?? []) as SegmentId[])
      setAllowedTeamPrincipalIds((entry.allowedTeamPrincipalIds ?? null) as PrincipalId[] | null)
      setAudienceTouched(false)
      setHasInitialized(true)
    }
  }, [entry, form, hasInitialized])

  const handleContentChange = useCallback(
    (json: JSONContent, _html: string, markdown: string) => {
      setContentJson(json)
      form.setValue('content', markdown, { shouldValidate: true })
    },
    [form]
  )

  function handleDisplayDateChange(value: Date | undefined) {
    if (value) {
      setDisplayDateOverride(value)
      setDisplayDateTouched(true)
    }
  }

  function handleDisplayDateClear() {
    setDisplayDateOverride(undefined)
    setDisplayDateTouched(true)
  }

  function handleFeaturedImageChange(url: string | null) {
    setFeaturedImageUrl(url)
    setFeaturedImageTouched(true)
  }

  function handleSegmentIdsChange(ids: SegmentId[]) {
    setSegmentIds(ids)
    setSegmentIdsTouched(true)
  }

  const submitEdits = form.handleSubmit((data) => {
    const displayDatePayload = displayDateTouched
      ? displayDateOverride === undefined
        ? null
        : displayDateOverride
      : undefined

    updateChangelogMutation.mutate(
      {
        id: entryId,
        title: data.title,
        content: data.content,
        contentJson: contentJson as TiptapContent | null,
        linkedPostIds,
        categoryIds,
        publishState,
        notify,
        ...(displayDatePayload !== undefined && { displayDate: displayDatePayload }),
        // Only send when the admin changed it, so an untouched value isn't
        // round-tripped and a cleared one is (null clears).
        ...(featuredImageTouched && { featuredImageUrl }),
        // Same touched-gate as featuredImageUrl: an untouched targeting list
        // isn't round-tripped; an edited one (including cleared to [])
        // replaces the stored list wholesale.
        ...(segmentIdsTouched && { segmentIds }),
        // Audience travels as a unit once touched: a 'segment' entry needs its
        // list, and going back to 'public' clears both narrowing fields.
        ...(audienceTouched && {
          visibility,
          visibleSegmentIds: visibility === 'segment' ? visibleSegmentIds : null,
          allowedTeamPrincipalIds: visibility === 'public' ? null : allowedTeamPrincipalIds,
        }),
      },
      {
        onSuccess: () => {
          onClose()
        },
      }
    )
  })

  const handleUnpublish = () => {
    updateChangelogMutation.mutate(
      { id: entryId, publishState: { type: 'draft' } },
      {
        onSuccess: () => {
          setPublishState({ type: 'draft' })
          toast.success('Entry unpublished', {
            description: 'It is a draft again. Edit it, then publish when you are ready.',
          })
        },
      }
    )
  }

  // While locked the form's submit is the unpublish action, so the primary
  // button and Cmd+Enter both do the one thing a live entry allows.
  const handleSubmit = (event?: React.BaseSyntheticEvent) => {
    if (locked) {
      event?.preventDefault()
      handleUnpublish()
      return Promise.resolve()
    }
    return submitEdits(event)
  }

  const handleKeyDown = useKeyboardSubmit(handleSubmit)

  const getSubmitButtonText = () => {
    if (locked) return updateChangelogMutation.isPending ? 'Unpublishing...' : 'Unpublish'
    if (updateChangelogMutation.isPending) {
      return publishState.type === 'published' ? 'Publishing...' : 'Saving...'
    }
    switch (publishState.type) {
      case 'draft':
        return 'Save Draft'
      case 'scheduled':
        return 'Save Schedule'
      case 'published':
        return 'Update & Publish'
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="flex flex-col h-full">
        {/* Header */}
        <ModalHeader
          section="Changelog"
          title={entry?.title || 'Edit Entry'}
          onClose={onClose}
          viewUrl={entry?.status === 'published' ? `/changelog/${entryId}` : null}
        />

        {/* Main content area - 2 column layout on desktop */}
        <div className="flex flex-1 min-h-0">
          {/* Left: Content editor */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 sm:px-6 pt-4 space-y-2 empty:hidden">
              {locked && (
                <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <LockClosedIcon className="h-4 w-4 shrink-0" />
                  <p>
                    This entry is live, so its fields are read-only. Unpublish it to make changes;
                    it returns to a draft and leaves the public changelog until you publish it
                    again.
                  </p>
                </div>
              )}
              {importedFrom && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  Imported from {importedFrom}. Title, notes and date follow the source page and
                  refresh on each sync; status, labels and audience are yours to set here.
                </p>
              )}
            </div>
            <ChangelogFormFields
              form={form}
              disabled={locked}
              contentJson={contentJson}
              onContentChange={handleContentChange}
              error={
                updateChangelogMutation.isError ? updateChangelogMutation.error.message : undefined
              }
            />
          </div>

          {/* Right: Metadata sidebar (desktop only) */}
          <ChangelogMetadataSidebar
            publishState={publishState}
            onPublishStateChange={setPublishState}
            locked={locked}
            linkedPostIds={linkedPostIds}
            onLinkedPostsChange={setLinkedPostIds}
            categoryIds={categoryIds}
            onCategoriesChange={setCategoryIds}
            notify={notify}
            onNotifyChange={setNotify}
            segmentIds={segmentIds}
            onSegmentIdsChange={handleSegmentIdsChange}
            visibility={visibility}
            onVisibilityChange={handleVisibilityChange}
            visibleSegmentIds={visibleSegmentIds}
            onVisibleSegmentIdsChange={handleVisibleSegmentIdsChange}
            allowedTeamPrincipalIds={allowedTeamPrincipalIds}
            onAllowedTeamPrincipalIdsChange={handleAllowedTeamPrincipalIdsChange}
            authorName={entry?.author?.name}
            publishedAt={entry?.publishedAt}
            displayDateValue={displayDateOverride}
            onDisplayDateChange={handleDisplayDateChange}
            onDisplayDateClear={handleDisplayDateClear}
            featuredImageUrl={featuredImageUrl}
            onFeaturedImageChange={handleFeaturedImageChange}
          />
        </div>

        {/* Footer */}
        <ModalFooter
          onCancel={onClose}
          submitLabel={getSubmitButtonText()}
          hintAction={locked ? 'to unpublish' : 'to save'}
          isPending={updateChangelogMutation.isPending}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={deleteChangelogMutation.isPending}
          >
            <TrashIcon className="h-4 w-4 mr-1.5" />
            Delete
          </Button>
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title="Delete changelog entry?"
            description="This action cannot be undone. The changelog entry will be permanently deleted."
            confirmLabel="Delete"
            variant="destructive"
            isPending={deleteChangelogMutation.isPending}
            onConfirm={() =>
              deleteChangelogMutation.mutate(entryId, { onSuccess: () => onClose() })
            }
          />
          {/* Mobile settings button */}
          <Sheet open={mobileSettingsOpen} onOpenChange={setMobileSettingsOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="lg:hidden">
                <Cog6ToothIcon className="h-4 w-4 mr-1.5" />
                Settings
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[70vh]">
              <SheetHeader>
                <SheetTitle>Entry Settings</SheetTitle>
              </SheetHeader>
              <div className="py-4 overflow-y-auto">
                <ChangelogMetadataSidebarContent
                  publishState={publishState}
                  onPublishStateChange={setPublishState}
                  locked={locked}
                  linkedPostIds={linkedPostIds}
                  onLinkedPostsChange={setLinkedPostIds}
                  categoryIds={categoryIds}
                  onCategoriesChange={setCategoryIds}
                  notify={notify}
                  onNotifyChange={setNotify}
                  segmentIds={segmentIds}
                  onSegmentIdsChange={handleSegmentIdsChange}
                  visibility={visibility}
                  onVisibilityChange={handleVisibilityChange}
                  visibleSegmentIds={visibleSegmentIds}
                  onVisibleSegmentIdsChange={handleVisibleSegmentIdsChange}
                  allowedTeamPrincipalIds={allowedTeamPrincipalIds}
                  onAllowedTeamPrincipalIdsChange={handleAllowedTeamPrincipalIdsChange}
                  authorName={entry?.author?.name}
                  publishedAt={entry?.publishedAt}
                  displayDateValue={displayDateOverride}
                  onDisplayDateChange={handleDisplayDateChange}
                  onDisplayDateClear={handleDisplayDateClear}
                  featuredImageUrl={featuredImageUrl}
                  onFeaturedImageChange={handleFeaturedImageChange}
                />
              </div>
            </SheetContent>
          </Sheet>
        </ModalFooter>
      </form>
    </Form>
  )
}

export function ChangelogModal({ entryId: urlEntryId }: ChangelogModalProps) {
  const search = Route.useSearch()
  const { open, validatedId, close } = useUrlModal<ChangelogId>({
    urlId: urlEntryId,
    idPrefix: 'changelog',
    searchParam: 'entry',
    route: '/admin/changelog',
    search,
  })

  return (
    <UrlModalShell
      open={open}
      onOpenChange={(o) => !o && close()}
      srTitle="Edit changelog entry"
      hasValidId={!!validatedId}
    >
      {validatedId && <ChangelogModalContent entryId={validatedId} onClose={close} />}
    </UrlModalShell>
  )
}
