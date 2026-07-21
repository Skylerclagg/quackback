/**
 * RoadmapService - Business logic for roadmap operations
 *
 * This service handles all roadmap-related business logic including:
 * - Roadmap CRUD operations
 * - Post assignment to roadmaps
 * - Post ordering within roadmap columns
 * - Validation
 */

import {
  db,
  eq,
  and,
  isNull,
  inArray,
  asc,
  sql,
  roadmaps,
  posts,
  postRoadmaps,
  segments,
  principal,
  type Roadmap,
} from '@/lib/server/db'
import {
  toUuid,
  type RoadmapId,
  type PostId,
  type PrincipalId,
  type SegmentId,
} from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
import { ANONYMOUS_ACTOR, canViewRoadmap, isAllowed, type Actor } from '@/lib/server/policy'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'roadmaps' })
import type {
  CreateRoadmapInput,
  UpdateRoadmapInput,
  AddPostToRoadmapInput,
  ReorderPostsInput,
} from './roadmap.types'

// ==========================================================================
// ROADMAP CRUD
// ==========================================================================

/**
 * Validate a segment allowlist against the segments table: dedupe and
 * drop unknown / soft-deleted ids. Without this an admin could store
 * garbage strings that never match a membership but re-display in the
 * UI on every load (same rationale as updatePortalAccessFn).
 */
async function normalizeAllowedSegmentIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const requested = Array.from(new Set(ids))
  const found = await db
    .select({ id: segments.id })
    .from(segments)
    .where(and(inArray(segments.id, requested as SegmentId[]), isNull(segments.deletedAt)))
  const valid = new Set(found.map((r) => String(r.id)))
  return requested.filter((id) => valid.has(id))
}

/**
 * Validate a team allowlist against the principal table: dedupe and
 * keep only admin/member-role principals. Admins in the list are
 * redundant (they always see every roadmap) but harmless.
 */
async function normalizeAllowedTeamPrincipalIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const requested = Array.from(new Set(ids))
  const found = await db
    .select({ id: principal.id })
    .from(principal)
    .where(
      and(
        inArray(principal.id, requested as PrincipalId[]),
        inArray(principal.role, ['admin', 'member'])
      )
    )
  const valid = new Set(found.map((r) => String(r.id)))
  return requested.filter((id) => valid.has(id))
}

/**
 * Create a new roadmap
 */
export async function createRoadmap(input: CreateRoadmapInput): Promise<Roadmap> {
  log.debug({ slug: input.slug }, 'create roadmap')
  // Validate input
  if (!input.name?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Name is required')
  }
  if (!input.slug?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Slug is required')
  }
  if (input.name.length > 100) {
    throw new ValidationError('VALIDATION_ERROR', 'Name must be 100 characters or less')
  }
  if (!/^[a-z0-9-]+$/.test(input.slug)) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Slug must contain only lowercase letters, numbers, and hyphens'
    )
  }

  // Check for duplicate slug (outside transaction)
  const existing = await db.query.roadmaps.findFirst({
    where: eq(roadmaps.slug, input.slug),
  })
  if (existing) {
    throw new ConflictError('DUPLICATE_SLUG', `A roadmap with slug "${input.slug}" already exists`)
  }

  // Get next position (outside transaction)
  const positionResult = await db
    .select({ maxPosition: sql<number>`COALESCE(MAX(${roadmaps.position}), -1)` })
    .from(roadmaps)
  const position = (positionResult[0]?.maxPosition ?? -1) + 1

  // Create the roadmap (single insert, no transaction needed)
  const [roadmap] = await db
    .insert(roadmaps)
    .values({
      name: input.name.trim(),
      slug: input.slug.trim(),
      description: input.description?.trim() || null,
      isPublic: input.isPublic ?? true,
      allowedSegmentIds: input.allowedSegmentIds
        ? await normalizeAllowedSegmentIds(input.allowedSegmentIds)
        : [],
      allowedTeamPrincipalIds: input.allowedTeamPrincipalIds
        ? await normalizeAllowedTeamPrincipalIds(input.allowedTeamPrincipalIds)
        : [],
      position,
    })
    .returning()

  return roadmap
}

/**
 * Update an existing roadmap
 */
export async function updateRoadmap(id: RoadmapId, input: UpdateRoadmapInput): Promise<Roadmap> {
  log.debug({ roadmap_id: id }, 'update roadmap')
  // Validate input
  if (input.name !== undefined && !input.name.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Name cannot be empty')
  }
  if (input.name && input.name.length > 100) {
    throw new ValidationError('VALIDATION_ERROR', 'Name must be 100 characters or less')
  }

  // Build update data
  const updateData: Partial<Omit<Roadmap, 'id' | 'createdAt'>> = {}
  if (input.name !== undefined) updateData.name = input.name.trim()
  if (input.description !== undefined) updateData.description = input.description?.trim() || null
  if (input.isPublic !== undefined) updateData.isPublic = input.isPublic
  if (input.allowedSegmentIds !== undefined) {
    updateData.allowedSegmentIds = await normalizeAllowedSegmentIds(input.allowedSegmentIds)
  }
  if (input.allowedTeamPrincipalIds !== undefined) {
    updateData.allowedTeamPrincipalIds = await normalizeAllowedTeamPrincipalIds(
      input.allowedTeamPrincipalIds
    )
  }

  // Update the roadmap (single update, no transaction needed)
  const [updated] = await db.update(roadmaps).set(updateData).where(eq(roadmaps.id, id)).returning()

  if (!updated) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
  }

  return updated
}

/**
 * Soft delete a roadmap
 *
 * Sets deletedAt timestamp instead of removing the row.
 */
export async function deleteRoadmap(id: RoadmapId): Promise<void> {
  log.debug({ roadmap_id: id }, 'delete roadmap')
  const result = await db
    .update(roadmaps)
    .set({ deletedAt: new Date() })
    .where(and(eq(roadmaps.id, id), isNull(roadmaps.deletedAt)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
  }
}

/**
 * Get a roadmap by ID
 */
export async function getRoadmap(id: RoadmapId): Promise<Roadmap> {
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.id, id) })

  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
  }

  return roadmap
}

/**
 * Get a roadmap by slug
 */
export async function getRoadmapBySlug(slug: string): Promise<Roadmap> {
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.slug, slug) })

  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with slug "${slug}" not found`)
  }

  return roadmap
}

/**
 * List all roadmaps (admin view, excludes soft-deleted)
 */
export async function listRoadmaps(): Promise<Roadmap[]> {
  return db.query.roadmaps.findMany({
    where: isNull(roadmaps.deletedAt),
    orderBy: [asc(roadmaps.position)],
  })
}

/**
 * List roadmaps visible to the actor on the portal (excludes
 * soft-deleted).
 *
 * Public roadmaps surface for everyone. Private roadmaps surface for
 * admins, allowlisted team members, and users belonging to one of the
 * roadmap's allowed segments — the in-memory filter reuses the same
 * canViewRoadmap predicate as the single-row read path.
 */
export async function listPublicRoadmaps(actor: Actor = ANONYMOUS_ACTOR): Promise<Roadmap[]> {
  const rows = await db.query.roadmaps.findMany({
    where: isNull(roadmaps.deletedAt),
    orderBy: [asc(roadmaps.position)],
  })
  return rows.filter((roadmap) => isAllowed(canViewRoadmap(actor, roadmap)))
}

/**
 * Reorder roadmaps in the sidebar
 * Uses a single batch UPDATE with CASE WHEN for efficiency
 */
export async function reorderRoadmaps(roadmapIds: RoadmapId[]): Promise<void> {
  log.debug({ count: roadmapIds.length }, 'reorder roadmaps')
  if (roadmapIds.length === 0) return

  // Build CASE WHEN clause for batch update
  const cases = roadmapIds
    .map((id, i) => sql`WHEN ${roadmaps.id} = ${toUuid(id)} THEN ${sql.raw(String(i))}`)
    .reduce((acc, curr) => sql`${acc} ${curr}`, sql``)

  // Single UPDATE with CASE expression
  await db
    .update(roadmaps)
    .set({ position: sql`CASE ${cases} END` })
    .where(inArray(roadmaps.id, roadmapIds))
}

// ==========================================================================
// POST MANAGEMENT
// ==========================================================================

/**
 * Add a post to a roadmap
 */
export async function addPostToRoadmap(
  input: AddPostToRoadmapInput,
  actorPrincipalId?: PrincipalId
): Promise<void> {
  log.debug({ post_id: input.postId, roadmap_id: input.roadmapId }, 'add post to roadmap')
  // Verify roadmap exists
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.id, input.roadmapId) })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${input.roadmapId} not found`)
  }

  // Verify post exists
  const post = await db.query.posts.findFirst({ where: eq(posts.id, input.postId) })
  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${input.postId} not found`)
  }

  // Check if post is already in roadmap
  const existingEntry = await db.query.postRoadmaps.findFirst({
    where: and(eq(postRoadmaps.postId, input.postId), eq(postRoadmaps.roadmapId, input.roadmapId)),
  })
  if (existingEntry) {
    throw new ConflictError(
      'POST_ALREADY_IN_ROADMAP',
      `Post ${input.postId} is already in roadmap ${input.roadmapId}`
    )
  }

  // Get next position in the roadmap
  const positionResult = await db
    .select({ maxPosition: sql<number>`COALESCE(MAX(${postRoadmaps.position}), -1)` })
    .from(postRoadmaps)
    .where(eq(postRoadmaps.roadmapId, input.roadmapId))
  const position = (positionResult[0]?.maxPosition ?? -1) + 1

  // Add the post to the roadmap (single insert, no transaction needed)
  await db.insert(postRoadmaps).values({
    postId: input.postId,
    roadmapId: input.roadmapId,
    position,
  })

  createActivity({
    postId: input.postId,
    principalId: actorPrincipalId ?? null,
    type: 'roadmap.added',
    metadata: { roadmapName: roadmap.name },
  })
}

/**
 * Remove a post from a roadmap
 */
export async function removePostFromRoadmap(
  postId: PostId,
  roadmapId: RoadmapId,
  actorPrincipalId?: PrincipalId
): Promise<void> {
  log.debug({ post_id: postId, roadmap_id: roadmapId }, 'remove post from roadmap')
  // Remove the post from the roadmap (single delete, check result)
  const result = await db
    .delete(postRoadmaps)
    .where(and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('POST_NOT_IN_ROADMAP', `Post ${postId} is not in roadmap ${roadmapId}`)
  }

  // Look up roadmap name for the activity record
  const roadmap = await db.query.roadmaps.findFirst({
    where: eq(roadmaps.id, roadmapId),
    columns: { name: true },
  })

  createActivity({
    postId,
    principalId: actorPrincipalId ?? null,
    type: 'roadmap.removed',
    metadata: { roadmapName: roadmap?.name ?? '' },
  })
}

/**
 * Reorder posts within a roadmap
 * Uses a single batch UPDATE with CASE WHEN for efficiency
 */
export async function reorderPostsInColumn(input: ReorderPostsInput): Promise<void> {
  log.debug({ roadmap_id: input.roadmapId, count: input.postIds.length }, 'reorder posts in column')
  // Verify roadmap exists
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.id, input.roadmapId) })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${input.roadmapId} not found`)
  }

  if (input.postIds.length === 0) return

  // Build CASE WHEN clause for batch update
  const cases = input.postIds
    .map((id, i) => sql`WHEN ${postRoadmaps.postId} = ${toUuid(id)} THEN ${sql.raw(String(i))}`)
    .reduce((acc, curr) => sql`${acc} ${curr}`, sql``)

  // Single UPDATE with CASE expression
  await db
    .update(postRoadmaps)
    .set({ position: sql`CASE ${cases} END` })
    .where(
      and(eq(postRoadmaps.roadmapId, input.roadmapId), inArray(postRoadmaps.postId, input.postIds))
    )
}
