/**
 * Roadmap timeline — the date-based presentation of a roadmap.
 *
 * Timeline placement lives on post_roadmaps (nullable — a roadmap post
 * is "unscheduled" until an admin dates it) and on roadmap_milestones
 * (free-text entries, always dated). Bucket semantics live in
 * lib/shared/timeline.ts; this module only reads/writes rows, always
 * normalizing dates to their bucket start so equal buckets compare
 * equal in SQL.
 */
import {
  db,
  eq,
  and,
  inArray,
  isNull,
  isNotNull,
  sql,
  roadmaps,
  roadmapMilestones,
  posts,
  postRoadmaps,
  boards,
  type RoadmapMilestone,
  type TimelinePrecision,
} from '@/lib/server/db'
import type { MilestoneId, PostId, RoadmapId, StatusId, BoardId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  ANONYMOUS_ACTOR,
  boardViewFilter,
  canViewRoadmap,
  timelineSpecificityFor,
  isAllowed,
  type Actor,
} from '@/lib/server/policy'
import {
  TIMELINE_PRECISIONS,
  clampTimelinePlacement,
  normalizeTimelineDate,
} from '@/lib/shared/timeline'

export interface TimelinePostItem {
  kind: 'post'
  id: PostId
  title: string
  voteCount: number
  statusId: StatusId | null
  board: { id: BoardId; name: string; slug: string }
  timelineDate: Date | null
  timelinePrecision: TimelinePrecision | null
  timelinePosition: number
}

export interface TimelineMilestoneItem {
  kind: 'milestone'
  id: MilestoneId
  title: string
  description: string | null
  timelineDate: Date
  timelinePrecision: TimelinePrecision
  timelinePosition: number
}

export interface RoadmapTimelineResult {
  posts: TimelinePostItem[]
  milestones: TimelineMilestoneItem[]
}

function assertPrecision(precision: string): asserts precision is TimelinePrecision {
  if (!TIMELINE_PRECISIONS.includes(precision as TimelinePrecision)) {
    throw new ValidationError('VALIDATION_ERROR', `Invalid timeline precision "${precision}"`)
  }
}

function milestoneItem(m: RoadmapMilestone): TimelineMilestoneItem {
  return {
    kind: 'milestone',
    id: m.id as MilestoneId,
    title: m.title,
    description: m.description,
    timelineDate: m.timelineDate,
    timelinePrecision: m.timelinePrecision,
    timelinePosition: m.timelinePosition,
  }
}

async function queryTimelinePosts(
  roadmapId: RoadmapId,
  extraConditions: ReturnType<typeof sql>[]
): Promise<TimelinePostItem[]> {
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      statusId: posts.statusId,
      boardId: boards.id,
      boardName: boards.name,
      boardSlug: boards.slug,
      timelineDate: postRoadmaps.timelineDate,
      timelinePrecision: postRoadmaps.timelinePrecision,
      timelinePosition: postRoadmaps.timelinePosition,
    })
    .from(postRoadmaps)
    .innerJoin(posts, eq(postRoadmaps.postId, posts.id))
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(
      and(
        eq(postRoadmaps.roadmapId, roadmapId),
        isNull(posts.deletedAt),
        isNull(boards.deletedAt),
        ...extraConditions
      )
    )

  return rows.map((r) => ({
    kind: 'post' as const,
    id: r.id,
    title: r.title,
    voteCount: r.voteCount,
    statusId: r.statusId,
    board: { id: r.boardId, name: r.boardName, slug: r.boardSlug },
    timelineDate: r.timelineDate,
    timelinePrecision: r.timelinePrecision,
    timelinePosition: r.timelinePosition,
  }))
}

/**
 * Team-side timeline: every roadmap post (dated or not — undated rows
 * feed the admin "Unscheduled" lane) plus all milestones. Roadmap-level
 * access is the caller's job (requireRoadmapAccess in the fn layer).
 */
export async function getRoadmapTimeline(roadmapId: RoadmapId): Promise<RoadmapTimelineResult> {
  const [timelinePosts, milestones] = await Promise.all([
    queryTimelinePosts(roadmapId, []),
    db.query.roadmapMilestones.findMany({ where: eq(roadmapMilestones.roadmapId, roadmapId) }),
  ])
  return { posts: timelinePosts, milestones: milestones.map(milestoneItem) }
}

/**
 * Portal-side timeline. Same authorization layering as
 * getPublicRoadmapPosts: canViewRoadmap 404s restricted roadmaps,
 * boardViewFilter keeps posts from restricted boards out, and only
 * published, dated posts surface. On top of that, the roadmap's
 * timelineAccess caps how specific the dates render for this actor —
 * items finer than the cap are coarsened HERE, server-side, so the
 * precise date never leaves the server. A 'hidden' cap 404s so a
 * hidden timeline is indistinguishable from a missing roadmap.
 */
export async function getPublicRoadmapTimeline(
  roadmapId: RoadmapId,
  actor: Actor = ANONYMOUS_ACTOR
): Promise<RoadmapTimelineResult> {
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.id, roadmapId) })
  if (!roadmap || !isAllowed(canViewRoadmap(actor, roadmap))) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }
  const cap = timelineSpecificityFor(actor, roadmap)
  if (cap === 'hidden') {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }

  const [timelinePosts, milestones] = await Promise.all([
    queryTimelinePosts(roadmapId, [
      sql`${postRoadmaps.timelineDate} IS NOT NULL`,
      sql`${posts.moderationState} = 'published'`,
      boardViewFilter(actor),
    ]),
    db.query.roadmapMilestones.findMany({ where: eq(roadmapMilestones.roadmapId, roadmapId) }),
  ])

  return {
    posts: timelinePosts.map((p) => {
      if (!p.timelineDate || !p.timelinePrecision) return p
      const clamped = clampTimelinePlacement(p.timelineDate, p.timelinePrecision, cap)
      return { ...p, timelineDate: clamped.date, timelinePrecision: clamped.precision }
    }),
    milestones: milestones.map((m) => {
      const item = milestoneItem(m)
      const clamped = clampTimelinePlacement(item.timelineDate, item.timelinePrecision, cap)
      return { ...item, timelineDate: clamped.date, timelinePrecision: clamped.precision }
    }),
  }
}

/**
 * Which of the given roadmaps have any timeline content (a dated post
 * or a milestone). Drives the portal's Columns/Timeline toggle so an
 * empty timeline is never offered.
 */
export async function roadmapIdsWithTimelineContent(roadmapIds: RoadmapId[]): Promise<Set<string>> {
  if (roadmapIds.length === 0) return new Set()
  const [postRows, milestoneRows] = await Promise.all([
    db
      .selectDistinct({ roadmapId: postRoadmaps.roadmapId })
      .from(postRoadmaps)
      .where(
        and(inArray(postRoadmaps.roadmapId, roadmapIds), isNotNull(postRoadmaps.timelineDate))
      ),
    db
      .selectDistinct({ roadmapId: roadmapMilestones.roadmapId })
      .from(roadmapMilestones)
      .where(inArray(roadmapMilestones.roadmapId, roadmapIds)),
  ])
  return new Set([...postRows, ...milestoneRows].map((r) => String(r.roadmapId)))
}

/** Next timelinePosition for a bucket, across posts AND milestones. */
async function nextBucketPosition(
  roadmapId: RoadmapId,
  date: Date,
  precision: TimelinePrecision
): Promise<number> {
  // eq() (not raw sql templates) so the Date param goes through the
  // timestamp column's driver mapping — postgres.js rejects raw Date
  // objects handed to it as query params.
  const [postMax, milestoneMax] = await Promise.all([
    db
      .select({ max: sql<number>`COALESCE(MAX(${postRoadmaps.timelinePosition}), -1)` })
      .from(postRoadmaps)
      .where(
        and(
          eq(postRoadmaps.roadmapId, roadmapId),
          eq(postRoadmaps.timelineDate, date),
          eq(postRoadmaps.timelinePrecision, precision)
        )
      ),
    db
      .select({ max: sql<number>`COALESCE(MAX(${roadmapMilestones.timelinePosition}), -1)` })
      .from(roadmapMilestones)
      .where(
        and(
          eq(roadmapMilestones.roadmapId, roadmapId),
          eq(roadmapMilestones.timelineDate, date),
          eq(roadmapMilestones.timelinePrecision, precision)
        )
      ),
  ])
  return Math.max(Number(postMax[0]?.max ?? -1), Number(milestoneMax[0]?.max ?? -1)) + 1
}

/**
 * Date (or undate, with null) a roadmap post on the timeline. Newly
 * placed items append to the end of their bucket.
 */
export async function setPostTimelinePlacement(
  roadmapId: RoadmapId,
  postId: PostId,
  placement: { date: Date; precision: TimelinePrecision } | null
): Promise<void> {
  const membership = await db.query.postRoadmaps.findFirst({
    where: and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)),
  })
  if (!membership) {
    throw new NotFoundError('POST_NOT_IN_ROADMAP', `Post ${postId} is not in roadmap ${roadmapId}`)
  }

  if (placement === null) {
    await db
      .update(postRoadmaps)
      .set({ timelineDate: null, timelinePrecision: null, timelinePosition: 0 })
      .where(and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)))
    return
  }

  assertPrecision(placement.precision)
  const normalized = normalizeTimelineDate(placement.date, placement.precision)
  await db
    .update(postRoadmaps)
    .set({
      timelineDate: normalized,
      timelinePrecision: placement.precision,
      timelinePosition: await nextBucketPosition(roadmapId, normalized, placement.precision),
    })
    .where(and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)))
}

export async function createMilestone(
  roadmapId: RoadmapId,
  input: { title: string; description?: string | null; date: Date; precision: TimelinePrecision }
): Promise<RoadmapMilestone> {
  if (!input.title?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  if (input.title.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must be 200 characters or less')
  }
  assertPrecision(input.precision)
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.id, roadmapId) })
  if (!roadmap || roadmap.deletedAt) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }

  const normalized = normalizeTimelineDate(input.date, input.precision)
  const [milestone] = await db
    .insert(roadmapMilestones)
    .values({
      roadmapId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      timelineDate: normalized,
      timelinePrecision: input.precision,
      timelinePosition: await nextBucketPosition(roadmapId, normalized, input.precision),
    })
    .returning()
  return milestone
}

export async function getMilestone(id: MilestoneId): Promise<RoadmapMilestone> {
  const milestone = await db.query.roadmapMilestones.findFirst({
    where: eq(roadmapMilestones.id, id),
  })
  if (!milestone) {
    throw new NotFoundError('MILESTONE_NOT_FOUND', `Milestone with ID ${id} not found`)
  }
  return milestone
}

export async function updateMilestone(
  id: MilestoneId,
  input: { title?: string; description?: string | null; date?: Date; precision?: TimelinePrecision }
): Promise<RoadmapMilestone> {
  const existing = await getMilestone(id)
  if (input.title !== undefined && !input.title.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Title cannot be empty')
  }
  if (input.title && input.title.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must be 200 characters or less')
  }

  const updateData: Partial<RoadmapMilestone> = { updatedAt: new Date() }
  if (input.title !== undefined) updateData.title = input.title.trim()
  if (input.description !== undefined) updateData.description = input.description?.trim() || null

  if (input.date !== undefined || input.precision !== undefined) {
    const precision = input.precision ?? existing.timelinePrecision
    assertPrecision(precision)
    const normalized = normalizeTimelineDate(input.date ?? existing.timelineDate, precision)
    updateData.timelineDate = normalized
    updateData.timelinePrecision = precision
    // Bucket moved → append to the destination bucket's end.
    const bucketChanged =
      normalized.getTime() !== existing.timelineDate.getTime() ||
      precision !== existing.timelinePrecision
    if (bucketChanged) {
      updateData.timelinePosition = await nextBucketPosition(
        existing.roadmapId as RoadmapId,
        normalized,
        precision
      )
    }
  }

  const [updated] = await db
    .update(roadmapMilestones)
    .set(updateData)
    .where(eq(roadmapMilestones.id, id))
    .returning()
  return updated
}

export async function deleteMilestone(id: MilestoneId): Promise<void> {
  const result = await db
    .delete(roadmapMilestones)
    .where(eq(roadmapMilestones.id, id))
    .returning({ id: roadmapMilestones.id })
  if (result.length === 0) {
    throw new NotFoundError('MILESTONE_NOT_FOUND', `Milestone with ID ${id} not found`)
  }
}

/**
 * Rewrite the manual order of one bucket. `ordered` is the full item
 * list of that bucket in display order; positions are assigned
 * 0..n-1. Items not belonging to the roadmap are ignored rather than
 * failing the whole reorder.
 */
export async function reorderTimelineBucket(
  roadmapId: RoadmapId,
  ordered: Array<{ kind: 'post' | 'milestone'; id: string }>
): Promise<void> {
  for (const [index, item] of ordered.entries()) {
    if (item.kind === 'post') {
      await db
        .update(postRoadmaps)
        .set({ timelinePosition: index })
        .where(
          and(eq(postRoadmaps.roadmapId, roadmapId), eq(postRoadmaps.postId, item.id as PostId))
        )
    } else {
      await db
        .update(roadmapMilestones)
        .set({ timelinePosition: index })
        .where(
          and(
            eq(roadmapMilestones.id, item.id as MilestoneId),
            eq(roadmapMilestones.roadmapId, roadmapId)
          )
        )
    }
  }
}
