import { SidebarContainer, SidebarSkeleton } from '@/components/shared/sidebar-primitives'
import { ChangelogMetadataSidebarContent } from './changelog-metadata-sidebar-content'
import type { PostId, ChangelogCategoryId, SegmentId, PrincipalId } from '@quackback/ids'
import type { PublishState } from '@/lib/shared/schemas/changelog'
import type { AudienceVisibility } from '@/lib/server/policy/audience'

export { SidebarSkeleton as ChangelogMetadataSidebarSkeleton }

interface ChangelogMetadataSidebarProps {
  publishState: PublishState
  onPublishStateChange: (state: PublishState) => void
  linkedPostIds: PostId[]
  onLinkedPostsChange: (postIds: PostId[]) => void
  categoryIds: ChangelogCategoryId[]
  onCategoriesChange: (categoryIds: ChangelogCategoryId[]) => void
  notify: boolean
  onNotifyChange: (notify: boolean) => void
  /** Publish-notification targeting; empty = notify every subscriber. */
  segmentIds?: SegmentId[]
  onSegmentIdsChange?: (segmentIds: SegmentId[]) => void
  /** Read audience; see AudienceFields. Omit `visibility` to hide the control. */
  visibility?: AudienceVisibility
  onVisibilityChange?: (visibility: AudienceVisibility) => void
  visibleSegmentIds?: SegmentId[]
  onVisibleSegmentIdsChange?: (segmentIds: SegmentId[]) => void
  allowedTeamPrincipalIds?: PrincipalId[] | null
  onAllowedTeamPrincipalIdsChange?: (ids: PrincipalId[] | null) => void
  authorName?: string | null
  publishedAt?: string | null
  displayDateValue?: Date
  onDisplayDateChange?: (value: Date | undefined) => void
  onDisplayDateClear?: () => void
  featuredImageUrl?: string | null
  onFeaturedImageChange?: (url: string | null) => void
  locked?: boolean
}

export function ChangelogMetadataSidebar({
  publishState,
  onPublishStateChange,
  linkedPostIds,
  onLinkedPostsChange,
  categoryIds,
  onCategoriesChange,
  notify,
  onNotifyChange,
  segmentIds,
  onSegmentIdsChange,
  visibility,
  onVisibilityChange,
  visibleSegmentIds,
  onVisibleSegmentIdsChange,
  allowedTeamPrincipalIds,
  onAllowedTeamPrincipalIdsChange,
  authorName,
  publishedAt,
  displayDateValue,
  onDisplayDateChange,
  onDisplayDateClear,
  featuredImageUrl,
  onFeaturedImageChange,
  locked,
}: ChangelogMetadataSidebarProps) {
  return (
    <SidebarContainer className="overflow-y-auto">
      <ChangelogMetadataSidebarContent
        publishState={publishState}
        onPublishStateChange={onPublishStateChange}
        linkedPostIds={linkedPostIds}
        onLinkedPostsChange={onLinkedPostsChange}
        categoryIds={categoryIds}
        onCategoriesChange={onCategoriesChange}
        notify={notify}
        onNotifyChange={onNotifyChange}
        segmentIds={segmentIds}
        onSegmentIdsChange={onSegmentIdsChange}
        visibility={visibility}
        onVisibilityChange={onVisibilityChange}
        visibleSegmentIds={visibleSegmentIds}
        onVisibleSegmentIdsChange={onVisibleSegmentIdsChange}
        allowedTeamPrincipalIds={allowedTeamPrincipalIds}
        onAllowedTeamPrincipalIdsChange={onAllowedTeamPrincipalIdsChange}
        authorName={authorName}
        publishedAt={publishedAt}
        displayDateValue={displayDateValue}
        onDisplayDateChange={onDisplayDateChange}
        onDisplayDateClear={onDisplayDateClear}
        featuredImageUrl={featuredImageUrl}
        onFeaturedImageChange={onFeaturedImageChange}
        locked={locked}
      />
    </SidebarContainer>
  )
}
