/**
 * Input/Output types for Changelog Service operations
 */

import type { TiptapContent } from '@/lib/server/db'
import type {
  ChangelogCollectionId,
  ChangelogId,
  PrincipalId,
  PostId,
  RoadmapId,
} from '@quackback/ids'
import type { PublishState } from '@/lib/shared/schemas/changelog'

export type { PublishState } from '@/lib/shared/schemas/changelog'

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for creating a new changelog entry
 */
export interface CreateChangelogInput {
  title: string
  content: string
  contentJson?: TiptapContent | null
  /** Collection the entry belongs to; null/undefined = the built-in "General" changelog. */
  changelogId?: ChangelogCollectionId | null
  /** IDs of posts to link to this changelog entry */
  linkedPostIds?: PostId[]
  /** Publish state */
  publishState: PublishState
  displayDate?: Date | null
  /** Audience — false restricts the entry to admins + allowlists. */
  isPublic?: boolean
  /** Segments whose members may view the entry while private. */
  allowedSegmentIds?: string[]
  /** Member-role principals who may view the entry while private (admins always can). */
  allowedTeamPrincipalIds?: string[]
}

/**
 * Input for updating an existing changelog entry
 */
export interface UpdateChangelogInput {
  title?: string
  content?: string
  contentJson?: TiptapContent | null
  /** Collection to move the entry to; null = the built-in "General" changelog. */
  changelogId?: ChangelogCollectionId | null
  /** IDs of posts to link (replaces existing links) */
  linkedPostIds?: PostId[]
  /** Publish state (if changing) */
  publishState?: PublishState
  displayDate?: Date | null
  /** Audience — false restricts the entry to admins + allowlists. */
  isPublic?: boolean
  /** Segments whose members may view the entry while private — [] clears. */
  allowedSegmentIds?: string[]
  /** Member-role principals who may view the entry while private — [] clears. */
  allowedTeamPrincipalIds?: string[]
}

/**
 * Parameters for listing changelog entries
 */
export interface ListChangelogParams {
  /** Filter by status */
  status?: 'draft' | 'scheduled' | 'published' | 'all'
  /**
   * Filter by collection: a collection id, 'general' for entries
   * without a collection, or undefined for all entries.
   */
  changelogId?: ChangelogCollectionId | 'general'
  /** Cursor-based pagination */
  cursor?: string
  /** Number of items to return */
  limit?: number
}

/**
 * Input for creating a changelog collection
 */
export interface CreateChangelogCollectionInput {
  name: string
  slug: string
  description?: string | null
  /** Roadmap this changelog documents (informational link). */
  roadmapId?: RoadmapId | null
  /** Audience — false restricts every entry in the collection to admins + allowlists. */
  isPublic?: boolean
  allowedSegmentIds?: string[]
  allowedTeamPrincipalIds?: string[]
}

/**
 * Input for updating a changelog collection
 */
export interface UpdateChangelogCollectionInput {
  name?: string
  description?: string | null
  roadmapId?: RoadmapId | null
  isPublic?: boolean
  allowedSegmentIds?: string[]
  allowedTeamPrincipalIds?: string[]
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * Changelog entry with author and linked posts (admin view)
 */
export interface ChangelogEntryWithDetails {
  id: ChangelogId
  title: string
  content: string
  contentJson: TiptapContent | null
  /** Collection the entry belongs to; null = the built-in "General" changelog. */
  changelogId: ChangelogCollectionId | null
  changelog: ChangelogCollectionRef | null
  principalId: PrincipalId | null
  publishedAt: Date | null
  displayDate: Date | null
  createdAt: Date
  updatedAt: Date
  /** Audience controls (see policy/audience.ts) */
  isPublic: boolean
  allowedSegmentIds: string[]
  allowedTeamPrincipalIds: string[]
  /** Author information - only shown in admin views */
  author: ChangelogAuthor | null
  /** Linked posts */
  linkedPosts: ChangelogLinkedPost[]
  /** Computed status based on publishedAt */
  status: 'draft' | 'scheduled' | 'published'
}

/**
 * Changelog author information
 */
export interface ChangelogAuthor {
  id: PrincipalId
  name: string
  avatarUrl: string | null
}

/**
 * Linked post summary for changelog
 */
export interface ChangelogLinkedPost {
  id: PostId
  title: string
  voteCount: number
  status: {
    name: string
    color: string
  } | null
}

/**
 * Paginated changelog list result
 */
export interface ChangelogListResult {
  items: ChangelogEntryWithDetails[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * Public changelog entry for portal view (no author info)
 */
export interface PublicChangelogEntry {
  id: ChangelogId
  title: string
  content: string
  contentJson: TiptapContent | null
  publishedAt: Date
  /** Collection the entry belongs to; null = the built-in "General" changelog. */
  changelog: ChangelogCollectionRef | null
  linkedPosts: PublicChangelogLinkedPost[]
}

/**
 * Slim collection reference embedded on entries
 */
export interface ChangelogCollectionRef {
  id: ChangelogCollectionId
  slug: string
  name: string
}

/**
 * Changelog collection with details (admin view)
 */
export interface ChangelogCollectionWithDetails {
  id: ChangelogCollectionId
  slug: string
  name: string
  description: string | null
  roadmapId: RoadmapId | null
  roadmapName: string | null
  isPublic: boolean
  allowedSegmentIds: string[]
  allowedTeamPrincipalIds: string[]
  position: number
  entryCount: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Public changelog collection for portal tabs
 */
export interface PublicChangelogCollection {
  id: ChangelogCollectionId
  slug: string
  name: string
  description: string | null
}

/**
 * Public linked post for changelog portal
 */
export interface PublicChangelogLinkedPost {
  id: PostId
  title: string
  voteCount: number
  boardSlug: string
  status: {
    name: string
    color: string
  } | null
}

/**
 * Public changelog list result
 */
export interface PublicChangelogListResult {
  items: PublicChangelogEntry[]
  nextCursor: string | null
  hasMore: boolean
}
