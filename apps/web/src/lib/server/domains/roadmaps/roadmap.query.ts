import { etaDisclosureFor } from '@/lib/server/policy'
import {
  db,
  eq,
  and,
  isNull,
  inArray,
  asc,
  desc,
  gte,
  lt,
  sql,
  roadmaps,
  roadmapColumns,
  posts,
  postTagAssignments,
  boards,
  userSegments,
  type Roadmap,
} from '@/lib/server/db'
import { type RoadmapId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { ANONYMOUS_ACTOR, boardViewFilter, canViewRoadmap, type Actor } from '@/lib/server/policy'
import {
  parseRoadmapDateBucket,
  roadmapBaseFilterSchema,
  roadmapDateBucketsBetween,
  type RoadmapBaseFilter,
  type RoadmapDateBucket,
} from '@/lib/shared/roadmap-config'
import { clampTimelinePlacement } from '@/lib/shared/timeline'
import type { TimelineSpecificity } from '@/lib/shared/db-types'
import type { RoadmapFrequency } from '@/lib/shared/roadmap-config'
import type { SQL } from 'drizzle-orm'
import type {
  RoadmapPostsListResult,
  RoadmapPostsQueryOptions,
  RoadmapWithColumns,
} from './roadmap.types'

function parseBaseFilter(roadmap: Roadmap): RoadmapBaseFilter {
  const parsed = roadmapBaseFilterSchema.safeParse(roadmap.baseFilter)
  if (!parsed.success) {
    throw new ValidationError('INVALID_ROADMAP_FILTER', 'Roadmap base filter is invalid')
  }
  return parsed.data as RoadmapBaseFilter
}

function addDimensionConditions(conditions: SQL[], filter: RoadmapBaseFilter): void {
  if (filter.statusIds?.length) conditions.push(inArray(posts.statusId, filter.statusIds))
  if (filter.boardIds?.length) conditions.push(inArray(posts.boardId, filter.boardIds))
  if (filter.tagIds?.length) {
    conditions.push(
      inArray(
        posts.id,
        db
          .selectDistinct({ postId: postTagAssignments.postId })
          .from(postTagAssignments)
          .where(inArray(postTagAssignments.tagId, filter.tagIds))
      )
    )
  }
  if (filter.segmentIds?.length) {
    conditions.push(
      inArray(
        posts.principalId,
        db
          .select({ principalId: userSegments.principalId })
          .from(userSegments)
          .where(inArray(userSegments.segmentId, filter.segmentIds))
      )
    )
  }
}

function membershipConditions(
  roadmap: RoadmapWithColumns,
  options: RoadmapPostsQueryOptions
): SQL[] {
  const conditions: SQL[] = []
  addDimensionConditions(conditions, parseBaseFilter(roadmap))

  if (roadmap.type === 'column') {
    const configuredStatusIds = roadmap.columns.map((column) => column.statusId)
    if (options.statusId) {
      conditions.push(
        configuredStatusIds.includes(options.statusId)
          ? eq(posts.statusId, options.statusId)
          : sql`false`
      )
    } else {
      conditions.push(
        configuredStatusIds.length ? inArray(posts.statusId, configuredStatusIds) : sql`false`
      )
    }
  }

  // Independent of type: a column roadmap with `timelineEnabled` serves its
  // timeline tab through the same bucket ids a date roadmap uses, so the tab
  // shows exactly the posts the columns show, arranged by ETA.
  if (options.bucketId) {
    const bucket = parseRoadmapDateBucket(options.bucketId, roadmap.frequency ?? 'monthly')
    if (!bucket) {
      throw new ValidationError('INVALID_ROADMAP_BUCKET', 'Invalid roadmap date bucket')
    }
    if (bucket.noEta) {
      conditions.push(isNull(posts.eta))
    } else {
      conditions.push(gte(posts.eta, new Date(bucket.start!)))
      conditions.push(lt(posts.eta, new Date(bucket.end!)))
    }
  }

  return conditions
}

function runtimeFilterConditions(options: RoadmapPostsQueryOptions): SQL[] {
  const conditions: SQL[] = []
  if (options.search) {
    conditions.push(
      sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${options.search})`
    )
  }
  addDimensionConditions(conditions, {
    boardIds: options.boardIds,
    tagIds: options.tagIds,
    segmentIds: options.segmentIds,
  })
  return conditions
}

function sortFor(options: RoadmapPostsQueryOptions): SQL {
  if (options.sort === 'newest') return desc(posts.createdAt)
  if (options.sort === 'oldest') return asc(posts.createdAt)
  return desc(posts.voteCount)
}

async function loadRoadmap(roadmapId: RoadmapId): Promise<RoadmapWithColumns> {
  const roadmap = await db.query.roadmaps.findFirst({
    where: and(eq(roadmaps.id, roadmapId), isNull(roadmaps.deletedAt)),
    with: { columns: { orderBy: [asc(roadmapColumns.position)] } },
  })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }
  return roadmap
}

async function queryRoadmapPosts(
  roadmap: RoadmapWithColumns,
  options: RoadmapPostsQueryOptions,
  publicActor?: Actor
): Promise<RoadmapPostsListResult> {
  const { limit = 20, offset = 0 } = options
  const conditions: SQL[] = [isNull(posts.deletedAt), isNull(posts.canonicalPostId)]
  if (publicActor) {
    conditions.push(eq(posts.moderationState, 'published'), boardViewFilter(publicActor))
  } else {
    conditions.push(isNull(boards.deletedAt))
  }
  conditions.push(...membershipConditions(roadmap, options), ...runtimeFilterConditions(options))
  const orderBy = sortFor(options)

  const [results, countResult] = await Promise.all([
    db
      .select({
        post: {
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          commentCount: posts.commentCount,
          statusId: posts.statusId,
          eta: posts.eta,
          etaPrecision: posts.etaPrecision,
        },
        board: { id: boards.id, name: boards.name, slug: boards.slug },
      })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...conditions))
      .orderBy(orderBy, desc(posts.createdAt), asc(posts.id))
      .limit(limit + 1)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...conditions)),
  ])

  const hasMore = results.length > limit
  // Coarsen server-side to the viewer's disclosure cap so a precise date never
  // leaves the server for someone who is not entitled to it. Admin callers have
  // no actor here and see stored values.
  const cap: TimelineSpecificity = publicActor ? etaDisclosureFor(publicActor, roadmap) : 'day'
  return {
    items: (hasMore ? results.slice(0, limit) : results).map((result) => {
      const post = result.post
      if (cap === 'day' || cap === 'hidden' || !post.eta) {
        return { ...post, board: result.board }
      }
      const clamped = clampTimelinePlacement(new Date(post.eta), post.etaPrecision, cap)
      return { ...post, eta: clamped.date, etaPrecision: clamped.precision, board: result.board }
    }),
    total: Number(countResult[0]?.count ?? 0),
    hasMore,
  }
}

export async function getRoadmapPosts(
  roadmapId: RoadmapId,
  options: RoadmapPostsQueryOptions
): Promise<RoadmapPostsListResult> {
  return queryRoadmapPosts(await loadRoadmap(roadmapId), options)
}

export async function getPublicRoadmapPosts(
  roadmapId: RoadmapId,
  options: RoadmapPostsQueryOptions,
  actor: Actor = ANONYMOUS_ACTOR
): Promise<RoadmapPostsListResult> {
  const roadmap = await loadRoadmap(roadmapId)
  if (!canViewRoadmap(actor, roadmap).allowed) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }
  return queryRoadmapPosts(roadmap, options, actor)
}

async function dateBucketsFor(roadmapId: RoadmapId, actor?: Actor): Promise<RoadmapDateBucket[]> {
  const roadmap = await loadRoadmap(roadmapId)
  if (roadmap.type !== 'date' && !roadmap.timelineEnabled) return []
  if (actor && !canViewRoadmap(actor, roadmap).allowed) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }
  // A viewer capped coarser than the roadmap's frequency must not be handed
  // finer buckets than their cap — the bucket a post lands in is itself a date.
  // 'hidden' means no timeline for this viewer at all.
  const cap: TimelineSpecificity = actor ? etaDisclosureFor(actor, roadmap) : 'day'
  if (cap === 'hidden') return []
  const frequency = frequencyForCap(roadmap.frequency ?? 'monthly', cap)

  const conditions: SQL[] = [isNull(posts.deletedAt), isNull(posts.canonicalPostId)]
  if (actor) {
    conditions.push(eq(posts.moderationState, 'published'), boardViewFilter(actor))
  } else {
    conditions.push(isNull(boards.deletedAt))
  }
  addDimensionConditions(conditions, parseBaseFilter(roadmap))

  const [bounds] = await db
    .select({
      minEta: sql<Date | null>`MIN(${posts.eta})`,
      maxEta: sql<Date | null>`MAX(${posts.eta})`,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(...conditions))

  return roadmapDateBucketsBetween(frequency, bounds?.minEta ?? null, bounds?.maxEta ?? null)
}

export function getRoadmapDateBuckets(roadmapId: RoadmapId): Promise<RoadmapDateBucket[]> {
  return dateBucketsFor(roadmapId)
}

export function getPublicRoadmapDateBuckets(
  roadmapId: RoadmapId,
  actor: Actor = ANONYMOUS_ACTOR
): Promise<RoadmapDateBucket[]> {
  return dateBucketsFor(roadmapId, actor)
}

/**
 * The coarsest of the roadmap's own frequency and the viewer's cap. Upstream's
 * frequencies stop at semiannual, so a 'year' cap resolves to that — the
 * closest granularity that reveals no more than a year would.
 */
function frequencyForCap(frequency: RoadmapFrequency, cap: TimelineSpecificity): RoadmapFrequency {
  const rank: Record<RoadmapFrequency, number> = { monthly: 0, quarterly: 1, semiannual: 2 }
  const floor: RoadmapFrequency | null =
    cap === 'quarter' ? 'quarterly' : cap === 'year' ? 'semiannual' : null
  if (!floor) return frequency
  return rank[floor] > rank[frequency] ? floor : frequency
}
