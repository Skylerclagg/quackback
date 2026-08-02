import { PostCard } from '@/components/public/post-card'
import { Square2StackIcon } from '@heroicons/react/24/outline'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/shared/utils'
import type { PostListItem, PostStatusEntity } from '@/lib/shared/db-types'

interface FeedbackRowProps {
  post: PostListItem
  statuses: PostStatusEntity[]
  duplicateCount?: number
  onClick: () => void
  /** Whether this row is selected (bulk actions) */
  selected?: boolean
  /** Whether any post is selected — keeps the checkbox visible on every row */
  selectionActive?: boolean
  onToggleSelected?: () => void
}

export function FeedbackRow({
  post,
  statuses,
  duplicateCount,
  onClick,
  selected = false,
  selectionActive = false,
  onToggleSelected,
}: FeedbackRowProps) {
  return (
    <div className="group relative flex">
      {onToggleSelected && (
        <div
          className={cn(
            'flex items-center overflow-hidden transition-[width] duration-150',
            selectionActive ? 'w-10' : 'w-0 group-hover:w-10 focus-within:w-10'
          )}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelected()}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${post.title}`}
            className="ml-4"
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <PostCard
          // Core post data
          id={post.id}
          title={post.title}
          content={post.content}
          statusId={post.statusId}
          statuses={statuses}
          voteCount={post.voteCount}
          commentCount={post.commentCount}
          authorName={post.authorName}
          createdAt={post.createdAt}
          boardSlug={post.board.slug}
          tags={post.tags}
          // Admin mode - click to open modal
          onClick={onClick}
          // Admin doesn't need avatars in list view
          showAvatar={false}
        />
      </div>
      {duplicateCount != null && duplicateCount > 0 && (
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border text-muted-foreground bg-muted/40 border-border/40">
          <Square2StackIcon className="h-3.5 w-3.5" />
          {duplicateCount === 1 ? '1 duplicate' : `${duplicateCount} duplicates`}
        </span>
      )}
    </div>
  )
}
