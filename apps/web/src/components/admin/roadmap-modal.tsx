'use client'

import { Suspense, useState } from 'react'
import { useSuspenseQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ModalHeader } from '@/components/shared/modal-header'
import { UrlModalShell } from '@/components/shared/url-modal-shell'
import { useUrlModal } from '@/lib/client/hooks/use-url-modal'
import { adminQueries } from '@/lib/client/queries/admin'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import { VoteButton } from '@/components/public/vote-button'
import { PostContentSection } from '@/components/public/post-detail/post-content-section'
import {
  MetadataSidebar,
  MetadataSidebarSkeleton,
} from '@/components/public/post-detail/metadata-sidebar'
import {
  CommentsSection,
  CommentsSectionSkeleton,
} from '@/components/public/post-detail/comments-section'
import { PinnedCommentSection } from '@/components/public/post-detail/official-response-section'
import {
  useChangePostStatusId,
  useUpdatePostTags,
  usePinComment,
  useUnpinComment,
} from '@/lib/client/mutations'
import { addPostToRoadmapFn, removePostFromRoadmapFn } from '@/lib/server/functions/roadmaps'
import { CalendarDaysIcon } from '@heroicons/react/24/solid'
import { PlacementPopover } from './roadmap/placement-popover'
import { useRoadmapTimeline } from '@/lib/client/hooks/use-roadmap-timeline'
import { useSetTimelinePlacement } from '@/lib/client/mutations/roadmap-timeline'
import { formatTimelineLabel, type TimelinePrecision } from '@/lib/shared/timeline'
import { Route } from '@/routes/admin/roadmap'
import { type PostId, type StatusId, type TagId, type RoadmapId } from '@quackback/ids'
import type { PostDetails, CurrentUser } from '@/lib/shared/types'
import type { PublicPostDetailView } from '@/lib/client/queries/portal-detail'
import { toPortalComments } from '@/components/admin/feedback/detail/post-utils'

interface RoadmapModalProps {
  postId: string | undefined
  currentUser: CurrentUser
}

interface RoadmapModalContentProps {
  postId: PostId
  currentUser: CurrentUser
  onClose: () => void
}

/** Convert admin PostDetails to portal-compatible view */
function toPortalPostView(post: PostDetails): PublicPostDetailView {
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    contentJson: post.contentJson ?? { type: 'doc' },
    statusId: post.statusId,
    voteCount: post.voteCount,
    authorName: post.authorName,
    principalId: post.principalId as `principal_${string}` | null,
    authorAvatarUrl: (post.principalId && post.avatarUrls?.[post.principalId]) || null,
    createdAt: post.createdAt,
    board: post.board,
    tags: post.tags,
    roadmaps: [],
    comments: toPortalComments(post),
    pinnedComment: post.pinnedComment,
    pinnedCommentId: post.pinnedCommentId,
  }
}

function RoadmapModalContent({ postId, currentUser, onClose }: RoadmapModalContentProps) {
  const queryClient = useQueryClient()

  // Queries
  const postQuery = useSuspenseQuery(adminQueries.postDetail(postId))
  const { data: tags = [] } = useQuery(adminQueries.tags())
  const { data: statuses = [] } = useQuery(adminQueries.statuses())
  const { data: roadmaps = [] } = useQuery(adminQueries.roadmaps())

  const post = postQuery.data as PostDetails

  // UI state
  const [isUpdating, setIsUpdating] = useState(false)
  const [pendingRoadmapId, setPendingRoadmapId] = useState<string | null>(null)

  // Mutations
  const updateStatus = useChangePostStatusId()
  const updateTags = useUpdatePostTags()
  const pinComment = usePinComment({ postId: post.id as PostId })
  const unpinComment = useUnpinComment({ postId: post.id as PostId })

  // Handlers
  const handleStatusChange = async (statusId: StatusId) => {
    setIsUpdating(true)
    try {
      await updateStatus.mutateAsync({ postId: post.id as PostId, statusId })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleTagsChange = async (tagIds: TagId[]) => {
    setIsUpdating(true)
    try {
      await updateTags.mutateAsync({ postId: post.id as PostId, tagIds, allTags: tags })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleRoadmapAdd = async (roadmapId: RoadmapId) => {
    setPendingRoadmapId(roadmapId)
    try {
      await addPostToRoadmapFn({ data: { roadmapId, postId: post.id } })
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(post.id as PostId) })
    } finally {
      setPendingRoadmapId(null)
    }
  }

  const handleRoadmapRemove = async (roadmapId: RoadmapId) => {
    setPendingRoadmapId(roadmapId)
    try {
      await removePostFromRoadmapFn({ data: { roadmapId, postId: post.id } })
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(post.id as PostId) })
    } finally {
      setPendingRoadmapId(null)
    }
  }

  // Convert post to portal-compatible view
  const portalPost = toPortalPostView(post)
  const postRoadmaps = (post.roadmapIds || [])
    .map((id) => roadmaps.find((r) => r.id === id))
    .filter(Boolean) as Array<{ id: string; name: string; slug: string }>

  portalPost.roadmaps = postRoadmaps

  const currentStatus = statuses.find((s) => s.id === post.statusId)

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <ModalHeader
        section="Roadmap"
        title={post.title}
        onClose={onClose}
        viewUrl={`/b/${post.board.slug}/posts/${post.id}`}
      />

      {/* Timeline placement — one control per roadmap this post is on. */}
      {postRoadmaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-6 py-2.5 border-b border-border/30 bg-muted/20">
          <span className="text-xs font-medium text-muted-foreground">Timeline</span>
          {postRoadmaps.map((roadmap) => (
            <RoadmapPlacementControl
              key={roadmap.id}
              roadmapId={roadmap.id}
              roadmapName={roadmap.name}
              postId={post.id as PostId}
              showName={postRoadmaps.length > 1}
            />
          ))}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {/* Post content layout */}
        <div className="flex">
          {/* Vote sidebar */}
          <div className="flex flex-col items-center justify-start py-6 px-4 border-r !border-r-[rgba(0,0,0,0.05)] dark:!border-r-[rgba(255,255,255,0.06)] bg-muted/10">
            <VoteButton postId={postId} voteCount={post.voteCount} />
          </div>

          {/* Main content */}
          <PostContentSection
            post={portalPost}
            currentStatus={currentStatus}
            authorAvatarUrl={(post.principalId && post.avatarUrls?.[post.principalId]) || null}
          />

          {/* Metadata sidebar */}
          <Suspense fallback={<MetadataSidebarSkeleton />}>
            <MetadataSidebar
              postId={postId}
              voteCount={post.voteCount}
              status={currentStatus}
              board={post.board}
              authorName={post.authorName}
              authorAvatarUrl={(post.principalId && post.avatarUrls?.[post.principalId]) || null}
              authorPrincipalId={post.principalId}
              createdAt={new Date(post.createdAt)}
              tags={post.tags}
              roadmaps={postRoadmaps}
              canEdit
              allStatuses={statuses}
              allTags={tags}
              allRoadmaps={roadmaps}
              onStatusChange={handleStatusChange}
              onTagsChange={handleTagsChange}
              onRoadmapAdd={handleRoadmapAdd}
              onRoadmapRemove={handleRoadmapRemove}
              isUpdating={isUpdating || !!pendingRoadmapId}
              hideSubscribe
              hideVote
            />
          </Suspense>
        </div>

        {/* Pinned comment section */}
        {post.pinnedComment && (
          <PinnedCommentSection comment={post.pinnedComment} workspaceName="Team" />
        )}

        {/* Comments section */}
        <div className="bg-muted/20 border-t border-border/30">
          <Suspense fallback={<CommentsSectionSkeleton />}>
            <CommentsSection
              postId={postId}
              comments={portalPost.comments}
              pinnedCommentId={post.pinnedCommentId}
              canPinComments
              onPinComment={(commentId) => pinComment.mutate(commentId)}
              onUnpinComment={() => unpinComment.mutate()}
              isPinPending={pinComment.isPending || unpinComment.isPending}
              adminUser={{ name: currentUser.name, email: currentUser.email }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

/**
 * "Set due date" control for one (roadmap, post) membership. Reads the
 * current placement from the roadmap's timeline query and opens the
 * shared date + vagueness picker. Cards only DISPLAY the date — this
 * modal is where it gets set.
 */
function RoadmapPlacementControl({
  roadmapId,
  roadmapName,
  postId,
  showName,
}: {
  roadmapId: string
  roadmapName: string
  postId: PostId
  showName: boolean
}) {
  const { data } = useRoadmapTimeline(roadmapId)
  const setPlacement = useSetTimelinePlacement()
  const entry = data?.posts.find((p) => p.id === String(postId))
  const placedDate = entry?.timelineDate ? new Date(entry.timelineDate) : undefined
  const precision = (entry?.timelinePrecision ?? undefined) as TimelinePrecision | undefined

  return (
    <span className="inline-flex items-center gap-1.5">
      {showName && <span className="text-xs text-muted-foreground">{roadmapName}:</span>}
      <PlacementPopover
        initialDate={placedDate}
        initialPrecision={precision}
        onApply={(date, prec) =>
          setPlacement.mutate({
            roadmapId,
            postId: String(postId),
            placement: { date, precision: prec },
          })
        }
        onClear={() => setPlacement.mutate({ roadmapId, postId: String(postId), placement: null })}
      >
        <button
          type="button"
          aria-label={placedDate ? 'Change due date' : 'Set due date'}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/40 transition-colors"
        >
          <CalendarDaysIcon className="h-3 w-3" />
          {placedDate && precision ? formatTimelineLabel(placedDate, precision) : 'Set due date'}
        </button>
      </PlacementPopover>
    </span>
  )
}

export function RoadmapModal({ postId: urlPostId, currentUser }: RoadmapModalProps) {
  const search = Route.useSearch()
  const { open, validatedId, close } = useUrlModal<PostId>({
    urlId: urlPostId,
    idPrefix: 'post',
    searchParam: 'post',
    route: '/admin/roadmap',
    search,
  })

  return (
    <UrlModalShell
      open={open}
      onOpenChange={(o) => !o && close()}
      srTitle="View post"
      hasValidId={!!validatedId}
    >
      {validatedId && (
        <RoadmapModalContent postId={validatedId} currentUser={currentUser} onClose={close} />
      )}
    </UrlModalShell>
  )
}
