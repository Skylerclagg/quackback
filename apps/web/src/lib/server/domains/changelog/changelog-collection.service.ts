/**
 * Changelog Collection Service
 *
 * CRUD for named changelog collections ("multiple changelogs"). Entries
 * with changelogId = NULL belong to the built-in "General" changelog,
 * which has no row here — a fresh install works with zero collections.
 * A collection's audience trio gates every entry inside it in ADDITION
 * to the entry's own audience (see policy/changelog.ts).
 */

import {
  db,
  changelogs,
  changelogEntries,
  roadmaps,
  eq,
  and,
  asc,
  isNull,
  sql,
} from '@/lib/server/db'
import type { ChangelogCollectionId, RoadmapId } from '@quackback/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  normalizeAllowedSegmentIds,
  normalizeAllowedTeamPrincipalIds,
} from '@/lib/server/domains/segments/allowlists'
import { canViewChangelogCollection, isAllowed, type Actor } from '@/lib/server/policy'
import { logger } from '@/lib/server/logger'
import type {
  CreateChangelogCollectionInput,
  UpdateChangelogCollectionInput,
  ChangelogCollectionWithDetails,
  PublicChangelogCollection,
} from './changelog.types'

const log = logger.child({ component: 'changelog-collections' })

// Collection lookups live in the leaf helpers module so the entry
// service can use them without pulling the policy barrel in.
export { assertCollectionExists, getCollectionRef } from './changelog-collection.helpers'

async function assertRoadmapExists(roadmapId: RoadmapId): Promise<void> {
  const roadmap = await db.query.roadmaps.findFirst({
    where: and(eq(roadmaps.id, roadmapId), isNull(roadmaps.deletedAt)),
    columns: { id: true },
  })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }
}

/**
 * Create a new changelog collection
 */
export async function createChangelogCollection(
  input: CreateChangelogCollectionInput
): Promise<ChangelogCollectionWithDetails> {
  log.debug({ slug: input.slug }, 'create changelog collection')
  if (!input.name?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Name is required')
  }
  if (input.name.length > 100) {
    throw new ValidationError('VALIDATION_ERROR', 'Name must be 100 characters or less')
  }
  if (!input.slug?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Slug is required')
  }
  if (!/^[a-z0-9-]+$/.test(input.slug)) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Slug must contain only lowercase letters, numbers, and hyphens'
    )
  }

  const existing = await db.query.changelogs.findFirst({
    where: eq(changelogs.slug, input.slug),
    columns: { id: true },
  })
  if (existing) {
    throw new ConflictError(
      'DUPLICATE_SLUG',
      `A changelog with slug "${input.slug}" already exists`
    )
  }

  if (input.roadmapId) {
    await assertRoadmapExists(input.roadmapId)
  }

  const positionResult = await db
    .select({ maxPosition: sql<number>`COALESCE(MAX(${changelogs.position}), -1)` })
    .from(changelogs)
  const position = (positionResult[0]?.maxPosition ?? -1) + 1

  const [collection] = await db
    .insert(changelogs)
    .values({
      name: input.name.trim(),
      slug: input.slug.trim(),
      description: input.description?.trim() || null,
      roadmapId: input.roadmapId ?? null,
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

  return getChangelogCollection(collection.id)
}

/**
 * Update an existing changelog collection
 */
export async function updateChangelogCollection(
  id: ChangelogCollectionId,
  input: UpdateChangelogCollectionInput
): Promise<ChangelogCollectionWithDetails> {
  log.debug({ changelog_collection_id: id }, 'update changelog collection')
  if (input.name !== undefined && !input.name.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Name cannot be empty')
  }
  if (input.name && input.name.length > 100) {
    throw new ValidationError('VALIDATION_ERROR', 'Name must be 100 characters or less')
  }
  if (input.roadmapId) {
    await assertRoadmapExists(input.roadmapId)
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) updateData.name = input.name.trim()
  if (input.description !== undefined) updateData.description = input.description?.trim() || null
  if (input.roadmapId !== undefined) updateData.roadmapId = input.roadmapId
  if (input.isPublic !== undefined) updateData.isPublic = input.isPublic
  if (input.allowedSegmentIds !== undefined) {
    updateData.allowedSegmentIds = await normalizeAllowedSegmentIds(input.allowedSegmentIds)
  }
  if (input.allowedTeamPrincipalIds !== undefined) {
    updateData.allowedTeamPrincipalIds = await normalizeAllowedTeamPrincipalIds(
      input.allowedTeamPrincipalIds
    )
  }

  const [updated] = await db
    .update(changelogs)
    .set(updateData)
    .where(and(eq(changelogs.id, id), isNull(changelogs.deletedAt)))
    .returning()

  if (!updated) {
    throw new NotFoundError('CHANGELOG_NOT_FOUND', `Changelog collection with ID ${id} not found`)
  }

  return getChangelogCollection(id)
}

/**
 * Soft delete a changelog collection.
 *
 * Entries are moved back to the built-in "General" changelog rather
 * than orphaned against a deleted collection — same end state the FK's
 * ON DELETE SET NULL produces on a hard delete, so there is exactly one
 * "collection gone" behavior.
 */
export async function deleteChangelogCollection(id: ChangelogCollectionId): Promise<void> {
  log.debug({ changelog_collection_id: id }, 'delete changelog collection')
  await db.transaction(async (tx) => {
    const result = await tx
      .update(changelogs)
      .set({ deletedAt: new Date() })
      .where(and(eq(changelogs.id, id), isNull(changelogs.deletedAt)))
      .returning()

    if (result.length === 0) {
      throw new NotFoundError('CHANGELOG_NOT_FOUND', `Changelog collection with ID ${id} not found`)
    }

    await tx
      .update(changelogEntries)
      .set({ changelogId: null })
      .where(eq(changelogEntries.changelogId, id))
  })
}

/**
 * Get a changelog collection by ID (admin view)
 */
export async function getChangelogCollection(
  id: ChangelogCollectionId
): Promise<ChangelogCollectionWithDetails> {
  const rows = await listChangelogCollections()
  const collection = rows.find((c) => c.id === id)
  if (!collection) {
    throw new NotFoundError('CHANGELOG_NOT_FOUND', `Changelog collection with ID ${id} not found`)
  }
  return collection
}

/**
 * List all live changelog collections (admin view), position order,
 * with roadmap names and per-collection entry counts.
 */
export async function listChangelogCollections(): Promise<ChangelogCollectionWithDetails[]> {
  const rows = await db
    .select({
      id: changelogs.id,
      slug: changelogs.slug,
      name: changelogs.name,
      description: changelogs.description,
      roadmapId: changelogs.roadmapId,
      roadmapName: roadmaps.name,
      isPublic: changelogs.isPublic,
      allowedSegmentIds: changelogs.allowedSegmentIds,
      allowedTeamPrincipalIds: changelogs.allowedTeamPrincipalIds,
      position: changelogs.position,
      createdAt: changelogs.createdAt,
      updatedAt: changelogs.updatedAt,
      entryCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${changelogEntries}
        WHERE ${changelogEntries.changelogId} = ${changelogs.id}
          AND ${changelogEntries.deletedAt} IS NULL
      )`,
    })
    .from(changelogs)
    .leftJoin(roadmaps, and(eq(roadmaps.id, changelogs.roadmapId), isNull(roadmaps.deletedAt)))
    .where(isNull(changelogs.deletedAt))
    .orderBy(asc(changelogs.position), asc(changelogs.id))

  return rows.map((row) => ({
    ...row,
    roadmapName: row.roadmapId ? row.roadmapName : null,
    entryCount: Number(row.entryCount),
  }))
}

/**
 * List collections visible to the actor (portal tabs). In-memory
 * audience filtering is fine here — the list is tiny and unpaginated.
 */
export async function listPublicChangelogCollections(
  actor: Actor
): Promise<PublicChangelogCollection[]> {
  const rows = await db.query.changelogs.findMany({
    where: isNull(changelogs.deletedAt),
    orderBy: [asc(changelogs.position), asc(changelogs.id)],
    columns: {
      id: true,
      slug: true,
      name: true,
      description: true,
      isPublic: true,
      allowedSegmentIds: true,
      allowedTeamPrincipalIds: true,
      deletedAt: true,
    },
  })

  return rows
    .filter((row) => isAllowed(canViewChangelogCollection(actor, row)))
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
    }))
}
