import type { SQL } from 'drizzle-orm'
import {
  db,
  boards,
  changelogs,
  changelogEntries,
  changelogEntryPosts,
  posts,
  principal,
  postStatuses,
  eq,
  and,
  isNull,
  isNotNull,
  lt,
  lte,
  gt,
  or,
  desc,
  inArray,
  sql,
} from '@/lib/server/db'
import type {
  BoardId,
  ChangelogCollectionId,
  ChangelogId,
  PrincipalId,
  PostId,
  StatusId,
} from '@quackback/ids'
import {
  changelogAudienceFilter,
  changelogCollectionVisibleFilter,
  type Actor,
} from '@/lib/server/policy'
import { computeStatus } from './changelog.service'
import type {
  ListChangelogParams,
  ChangelogEntryWithDetails,
  ChangelogListResult,
  ChangelogAuthor,
} from './changelog.types'

/**
 * List changelog entries with filtering and pagination
 *
 * @param params - List parameters
 * @returns Paginated list of changelog entries
 */
export async function listChangelogs(
  params: ListChangelogParams,
  actor?: Actor
): Promise<ChangelogListResult> {
  const { status = 'all', changelogId, cursor, limit = 20 } = params
  const now = new Date()

  // Build where conditions - always exclude soft-deleted entries.
  // When an actor is supplied (the admin server fn passes the caller),
  // audience-restricted entries are filtered in SQL so member-role
  // callers only page through entries they may see — the entry's own
  // audience AND its collection's. Filtering must be SQL-side — this
  // list is cursor-paginated.
  const conditions: SQL<unknown>[] = [isNull(changelogEntries.deletedAt)]
  if (actor) {
    conditions.push(changelogAudienceFilter(actor))
    conditions.push(changelogCollectionVisibleFilter(actor))
  }

  // Filter by collection ('general' = entries without a collection)
  if (changelogId === 'general') {
    conditions.push(isNull(changelogEntries.changelogId))
  } else if (changelogId) {
    conditions.push(eq(changelogEntries.changelogId, changelogId))
  }

  // Filter by status
  if (status === 'draft') {
    conditions.push(isNull(changelogEntries.publishedAt))
  } else if (status === 'scheduled') {
    conditions.push(isNotNull(changelogEntries.publishedAt))
    conditions.push(gt(changelogEntries.publishedAt, now))
  } else if (status === 'published') {
    conditions.push(isNotNull(changelogEntries.publishedAt))
    conditions.push(lte(changelogEntries.publishedAt, now))
  }

  // Cursor-based pagination (cursor is the last entry ID)
  if (cursor) {
    const cursorEntry = await db.query.changelogEntries.findFirst({
      where: eq(changelogEntries.id, cursor as ChangelogId),
      columns: { createdAt: true },
    })
    if (cursorEntry) {
      conditions.push(
        or(
          lt(changelogEntries.createdAt, cursorEntry.createdAt),
          and(
            eq(changelogEntries.createdAt, cursorEntry.createdAt),
            lt(changelogEntries.id, cursor as ChangelogId)
          )
        )!
      )
    }
  }

  // Fetch entries
  const entries = await db.query.changelogEntries.findMany({
    where: and(...conditions),
    orderBy: [desc(changelogEntries.createdAt), desc(changelogEntries.id)],
    limit: limit + 1, // Fetch one extra to check hasMore
  })

  const hasMore = entries.length > limit
  const items = hasMore ? entries.slice(0, limit) : entries

  // Get principal IDs for author lookup
  const principalIds = items
    .map((e) => e.principalId)
    .filter((id): id is PrincipalId => id !== null)
  const authorMap = new Map<PrincipalId, ChangelogAuthor>()

  if (principalIds.length > 0) {
    const principals = await db.query.principal.findMany({
      where: inArray(principal.id, principalIds),
      columns: { id: true, displayName: true, avatarUrl: true },
    })
    for (const p of principals) {
      if (p.displayName) {
        authorMap.set(p.id, {
          id: p.id,
          name: p.displayName,
          avatarUrl: p.avatarUrl,
        })
      }
    }
  }

  // Batch-load collection refs for the page (live collections only —
  // entries pointing at a soft-deleted collection render as General)
  const collectionIds = Array.from(
    new Set(items.map((e) => e.changelogId).filter((id): id is ChangelogCollectionId => id != null))
  )
  const collectionMap = new Map<
    ChangelogCollectionId,
    { id: ChangelogCollectionId; slug: string; name: string }
  >()
  if (collectionIds.length > 0) {
    const collections = await db.query.changelogs.findMany({
      where: and(inArray(changelogs.id, collectionIds), isNull(changelogs.deletedAt)),
      columns: { id: true, slug: true, name: true },
    })
    collections.forEach((c) => collectionMap.set(c.id, c))
  }

  // Get linked posts for all entries
  const entryIds = items.map((e) => e.id)
  const allLinkedPosts =
    entryIds.length > 0
      ? await db.query.changelogEntryPosts.findMany({
          where: inArray(changelogEntryPosts.changelogEntryId, entryIds),
          with: {
            post: {
              columns: {
                id: true,
                title: true,
                voteCount: true,
                statusId: true,
              },
            },
          },
        })
      : []

  // Group linked posts by changelog entry
  const linkedPostsMap = new Map<ChangelogId, typeof allLinkedPosts>()
  for (const lp of allLinkedPosts) {
    const existing = linkedPostsMap.get(lp.changelogEntryId) ?? []
    existing.push(lp)
    linkedPostsMap.set(lp.changelogEntryId, existing)
  }

  // Get status info for all linked posts
  const statusIds = new Set<StatusId>()
  allLinkedPosts.forEach((lp) => {
    if (lp.post.statusId) statusIds.add(lp.post.statusId)
  })

  const statusMap = new Map<StatusId, { name: string; color: string }>()
  if (statusIds.size > 0) {
    const statuses = await db.query.postStatuses.findMany({
      where: inArray(postStatuses.id, Array.from(statusIds) as StatusId[]),
      columns: { id: true, name: true, color: true },
    })
    statuses.forEach((s) => statusMap.set(s.id, { name: s.name, color: s.color }))
  }

  // Transform to output format
  const result: ChangelogEntryWithDetails[] = items.map((entry) => {
    const entryLinkedPosts = linkedPostsMap.get(entry.id) ?? []
    const changelog = entry.changelogId ? (collectionMap.get(entry.changelogId) ?? null) : null
    return {
      id: entry.id,
      title: entry.title,
      content: entry.content,
      contentJson: entry.contentJson,
      changelogId: changelog?.id ?? null,
      changelog,
      principalId: entry.principalId,
      publishedAt: entry.publishedAt,
      displayDate: entry.displayDate,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      isPublic: entry.isPublic,
      allowedSegmentIds: entry.allowedSegmentIds,
      allowedTeamPrincipalIds: entry.allowedTeamPrincipalIds,
      author: entry.principalId ? (authorMap.get(entry.principalId) ?? null) : null,
      linkedPosts: entryLinkedPosts.map((lp) => ({
        id: lp.post.id,
        title: lp.post.title,
        voteCount: lp.post.voteCount,
        status: lp.post.statusId ? (statusMap.get(lp.post.statusId) ?? null) : null,
      })),
      status: computeStatus(entry.publishedAt),
    }
  })

  return {
    items: result,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    hasMore,
  }
}

/**
 * Search posts with status category 'complete' for linking to changelogs
 *
 * @param params - Search parameters
 * @returns List of shipped posts matching the search query
 */
export async function searchShippedPosts(params: {
  query?: string
  boardId?: BoardId
  limit?: number
}): Promise<
  Array<{
    id: PostId
    title: string
    voteCount: number
    boardSlug: string
    authorName: string | null
    createdAt: Date
  }>
> {
  const { query, boardId, limit = 20 } = params

  // Get all status IDs with category 'complete'
  const completeStatuses = await db.query.postStatuses.findMany({
    where: eq(postStatuses.category, 'complete'),
    columns: { id: true },
  })

  if (completeStatuses.length === 0) {
    return []
  }

  const statusIds = completeStatuses.map((s) => s.id)

  // Build conditions
  const conditions = [inArray(posts.statusId, statusIds), isNull(posts.deletedAt)]

  if (boardId) {
    conditions.push(eq(posts.boardId, boardId))
  }

  // Search by title if query provided
  if (query?.trim()) {
    const searchTerm = `%${query.trim().toLowerCase()}%`
    conditions.push(sql`LOWER(${posts.title}) LIKE ${searchTerm}`)
  }

  // Fetch posts with board slug and author info
  const results = await db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      boardSlug: boards.slug,
      authorName: sql<string | null>`(
        SELECT m.display_name FROM ${principal} m
        WHERE m.id = ${posts.principalId}
      )`.as('author_name'),
      createdAt: posts.createdAt,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(and(...conditions))
    .orderBy(desc(posts.voteCount), desc(posts.createdAt))
    .limit(limit)

  return results
}
