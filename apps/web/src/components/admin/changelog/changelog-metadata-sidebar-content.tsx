import { useState } from 'react'
import { format } from 'date-fns'
import {
  DocumentTextIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ChevronUpIcon,
  UserIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline'
import { CheckIcon } from '@heroicons/react/24/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { useQuery } from '@tanstack/react-query'
import { searchShippedPostsFn } from '@/lib/server/functions/changelog'
import { changelogQueries } from '@/lib/client/queries/changelog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  SidebarRow,
  StatusSelect,
  ListItem,
  VoteCount,
  ListItemRemoveButton,
  type StatusOption,
} from '@/components/shared/sidebar-primitives'
import { cn } from '@/lib/shared/utils'
import { AudienceFields } from '@/components/admin/audience-fields'
import type { PostId } from '@quackback/ids'
import type { PublishState } from '@/lib/shared/schemas/changelog'

interface ChangelogMetadataSidebarContentProps {
  publishState: PublishState
  onPublishStateChange: (state: PublishState) => void
  /** Collection the entry belongs to; null = the built-in "General" changelog. */
  changelogId: string | null
  onChangelogIdChange: (next: string | null) => void
  linkedPostIds: PostId[]
  onLinkedPostsChange: (postIds: PostId[]) => void
  authorName?: string | null
  publishedAt?: string | null
  displayDateValue?: Date
  onDisplayDateChange?: (value: Date | undefined) => void
  onDisplayDateClear?: () => void
  isPublic: boolean
  onIsPublicChange: (next: boolean) => void
  allowedSegmentIds: string[]
  onAllowedSegmentIdsChange: (next: string[]) => void
  allowedTeamPrincipalIds: string[]
  onAllowedTeamPrincipalIdsChange: (next: string[]) => void
}

const PUBLISH_STATUS_OPTIONS: readonly StatusOption[] = [
  { value: 'draft', label: 'Draft', color: '#94a3b8' }, // slate-400
  { value: 'scheduled', label: 'Scheduled', color: '#f59e0b' }, // amber-500
  { value: 'published', label: 'Published', color: '#22c55e' }, // green-500
]

export function ChangelogMetadataSidebarContent({
  publishState,
  onPublishStateChange,
  changelogId,
  onChangelogIdChange,
  linkedPostIds,
  onLinkedPostsChange,
  authorName,
  publishedAt,
  displayDateValue,
  onDisplayDateChange = () => {},
  onDisplayDateClear = () => {},
  isPublic,
  onIsPublicChange,
  allowedSegmentIds,
  onAllowedSegmentIdsChange,
  allowedTeamPrincipalIds,
  onAllowedTeamPrincipalIdsChange,
}: ChangelogMetadataSidebarContentProps) {
  const [postsOpen, setPostsOpen] = useState(false)
  const [search, setSearch] = useState('')

  // Named changelog collections for the picker. The row is hidden when
  // none exist, so zero-collection installs see no new UI.
  const { data: collections = [] } = useQuery(changelogQueries.collections())

  // Default scheduled time to tomorrow at 9am
  const [scheduledDateTime, setScheduledDateTime] = useState<Date>(() => {
    if (publishState.type === 'scheduled') {
      return publishState.publishAt
    }
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    return tomorrow
  })

  const displayPlaceholder =
    publishedAt != null
      ? format(new Date(publishedAt), 'MMM d, yyyy')
      : publishState.type === 'published'
        ? format(publishState.publishAt ?? new Date(), 'MMM d, yyyy')
        : 'Pick a date'

  // Search shipped posts
  const { data: posts = [], isLoading: postsLoading } = useQuery({
    queryKey: ['shipped-posts', search],
    queryFn: () => searchShippedPostsFn({ data: { query: search || undefined, limit: 30 } }),
    staleTime: 30 * 1000,
  })

  // Get selected post details
  const selectedPosts = posts.filter((p) => linkedPostIds.includes(p.id))

  const handleStatusChange = (value: string) => {
    const type = value as 'draft' | 'scheduled' | 'published'
    if (type === 'draft') {
      onPublishStateChange({ type: 'draft' })
    } else if (type === 'scheduled') {
      onPublishStateChange({ type: 'scheduled', publishAt: new Date(scheduledDateTime) })
    } else {
      onPublishStateChange({ type: 'published' })
    }
  }

  const handleDateTimeChange = (date: Date | undefined) => {
    if (date) {
      setScheduledDateTime(date)
      if (publishState.type === 'scheduled') {
        onPublishStateChange({ type: 'scheduled', publishAt: date })
      }
    }
  }

  const handleDisplayDateChange = (date: Date | undefined) => {
    if (date) {
      onDisplayDateChange(date)
    }
  }

  const handleTogglePost = (postId: PostId) => {
    if (linkedPostIds.includes(postId)) {
      onLinkedPostsChange(linkedPostIds.filter((id) => id !== postId))
    } else {
      onLinkedPostsChange([...linkedPostIds, postId])
    }
  }

  const handleRemovePost = (postId: PostId) => {
    onLinkedPostsChange(linkedPostIds.filter((id) => id !== postId))
  }

  return (
    <div className="space-y-5">
      {/* Status - uses shared StatusSelect component */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Status</span>
        <StatusSelect
          value={publishState.type}
          options={PUBLISH_STATUS_OPTIONS}
          onChange={handleStatusChange}
        />
      </div>

      {/* Changelog collection - only shown once collections exist */}
      {collections.length > 0 && (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="text-sm text-muted-foreground shrink-0">Changelog</span>
          <Select
            value={changelogId ?? 'general'}
            onValueChange={(value) => onChangelogIdChange(value === 'general' ? null : value)}
          >
            <SelectTrigger size="sm" className="h-7 min-w-0 max-w-[11rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="general">General</SelectItem>
              {collections.map((collection) => (
                <SelectItem key={collection.id} value={collection.id}>
                  {collection.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Author */}
      {authorName && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserIcon className="h-4 w-4" />
            <span>Author</span>
          </div>
          <span className="text-sm font-medium text-foreground">{authorName}</span>
        </div>
      )}

      {/* Schedule Date - only show when scheduled */}
      {publishState.type === 'scheduled' && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Schedule</span>
          <DateTimePicker
            value={scheduledDateTime}
            onChange={handleDateTimeChange}
            minDate={new Date()}
            className="h-7 text-xs"
          />
        </div>
      )}

      {/* Published date shown on the public changelog - only when published */}
      {publishState.type === 'published' && (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
            Published date
            <Tooltip>
              <TooltipTrigger asChild>
                <InformationCircleIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[15rem]">
                <p>
                  The date shown on your public changelog. Changing it won&apos;t send
                  notifications.
                </p>
              </TooltipContent>
            </Tooltip>
          </span>
          <DateTimePicker
            value={displayDateValue}
            onChange={handleDisplayDateChange}
            onClear={displayDateValue !== undefined ? onDisplayDateClear : undefined}
            maxDate={new Date()}
            dateOnly
            placeholder={displayPlaceholder}
            className="h-7 min-w-0 max-w-[11rem] text-xs"
          />
        </div>
      )}

      {/* Audience — public switch + private-entry allowlists */}
      <div className="space-y-3 border-t border-border/50 pt-4">
        <AudienceFields
          idPrefix="changelog"
          entityLabel="entry"
          isPublic={isPublic}
          onIsPublicChange={onIsPublicChange}
          segmentIds={allowedSegmentIds}
          onSegmentIdsChange={onAllowedSegmentIdsChange}
          teamPrincipalIds={allowedTeamPrincipalIds}
          onTeamPrincipalIdsChange={onAllowedTeamPrincipalIdsChange}
        />
      </div>

      {/* Linked Posts - single unified section */}
      <div className="space-y-2">
        <SidebarRow icon={<DocumentTextIcon className="h-4 w-4" />} label="Linked Posts">
          <Popover open={postsOpen} onOpenChange={setPostsOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-0.5 px-1.5 py-0.5',
                  'rounded-md text-[11px] font-medium',
                  'text-muted-foreground/70 hover:text-muted-foreground',
                  'border border-dashed border-border/60 hover:border-border',
                  'hover:bg-muted/40',
                  'transition-all duration-150'
                )}
              >
                <PlusIcon className="h-2.5 w-2.5" />
                Add
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="end" sideOffset={4}>
              <div className="flex items-center border-b px-3">
                <MagnifyingGlassIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                <input
                  placeholder="Search shipped posts..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex h-9 w-full border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
                />
              </div>
              <ScrollArea className="h-[250px]">
                <div className="p-1">
                  {postsLoading ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
                  ) : posts.length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      {search ? 'No shipped posts found.' : 'No shipped posts yet.'}
                    </div>
                  ) : (
                    posts.map((post) => {
                      const isSelected = linkedPostIds.includes(post.id)
                      return (
                        <div
                          key={post.id}
                          onClick={() => handleTogglePost(post.id)}
                          className={cn(
                            'relative flex items-start gap-2.5 cursor-pointer select-none rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                            isSelected && 'bg-accent/50'
                          )}
                        >
                          <Checkbox checked={isSelected} className="mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-xs truncate">{post.title}</div>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span className="flex items-center gap-0.5">
                                <ChevronUpIcon className="h-2.5 w-2.5" />
                                {post.voteCount}
                              </span>
                              <span>·</span>
                              <span>{post.boardSlug}</span>
                            </div>
                          </div>
                          {isSelected && (
                            <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        </SidebarRow>

        {/* Selected posts as cards */}
        {selectedPosts.length > 0 ? (
          <div className="space-y-1.5">
            {selectedPosts.map((post) => (
              <ListItem
                key={post.id}
                left={<VoteCount count={post.voteCount} />}
                title={post.title}
                meta={[
                  <span key="author">{post.authorName || 'Anonymous'}</span>,
                  <TimeAgo key="date" date={post.createdAt} className="text-muted-foreground/70" />,
                  <span key="board">{post.boardSlug}</span>,
                ]}
                action={
                  <ListItemRemoveButton
                    onClick={() => handleRemovePost(post.id)}
                    label={`Remove ${post.title}`}
                  />
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/60 italic pl-6">No posts linked yet</p>
        )}
      </div>
    </div>
  )
}
