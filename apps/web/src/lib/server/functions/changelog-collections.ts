/**
 * Server Functions for Changelog Collection Operations
 *
 * CRUD for named changelog collections ("multiple changelogs"). Collection
 * management is admin-only — collections shape what the whole portal sees,
 * like segments and boards. Listing is open to members so the entry editor
 * can offer the changelog picker.
 */

import { createServerFn } from '@tanstack/react-start'
import type { ChangelogCollectionId, RoadmapId } from '@quackback/ids'
import { z } from 'zod'
import {
  getOptionalAuth,
  hasAuthCredentials,
  policyActorFromAuth,
  requireAuth,
} from './auth-helpers'
import { resolvePortalAccessForRequest } from './portal-access'
import {
  createChangelogCollection,
  updateChangelogCollection,
  deleteChangelogCollection,
  listChangelogCollections,
  listPublicChangelogCollections,
} from '@/lib/server/domains/changelog/changelog-collection.service'
import {
  createChangelogCollectionSchema,
  updateChangelogCollectionSchema,
  deleteChangelogCollectionSchema,
} from '@/lib/shared/schemas/changelog'
import { toIsoString } from '@/lib/shared/utils'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'changelog-collections' })

function serializeCollection<T extends { createdAt: Date; updatedAt: Date }>(collection: T) {
  return {
    ...collection,
    createdAt: toIsoString(collection.createdAt),
    updatedAt: toIsoString(collection.updatedAt),
  }
}

/**
 * List changelog collections (admin/member view — includes audience config)
 */
export const listChangelogCollectionsFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAuth({ roles: ['admin', 'member'] })
    const collections = await listChangelogCollections()
    return collections.map(serializeCollection)
  } catch (error) {
    log.error({ err: error }, 'list changelog collections failed')
    throw error
  }
})

/**
 * Create a changelog collection
 */
export const createChangelogCollectionFn = createServerFn({ method: 'POST' })
  .validator(createChangelogCollectionSchema)
  .handler(async ({ data }) => {
    log.info({ slug: data.slug }, 'create changelog collection')
    try {
      await requireAuth({ roles: ['admin'] })
      const collection = await createChangelogCollection({
        name: data.name,
        slug: data.slug,
        description: data.description,
        roadmapId: (data.roadmapId ?? null) as RoadmapId | null,
        isPublic: data.isPublic,
        allowedSegmentIds: data.allowedSegmentIds,
        allowedTeamPrincipalIds: data.allowedTeamPrincipalIds,
      })
      return serializeCollection(collection)
    } catch (error) {
      log.error({ err: error }, 'create changelog collection failed')
      throw error
    }
  })

/**
 * Update a changelog collection
 */
export const updateChangelogCollectionFn = createServerFn({ method: 'POST' })
  .validator(updateChangelogCollectionSchema)
  .handler(async ({ data }) => {
    log.info({ changelog_collection_id: data.id }, 'update changelog collection')
    try {
      await requireAuth({ roles: ['admin'] })
      const collection = await updateChangelogCollection(data.id as ChangelogCollectionId, {
        name: data.name,
        description: data.description,
        ...(data.roadmapId !== undefined && {
          roadmapId: data.roadmapId as RoadmapId | null,
        }),
        isPublic: data.isPublic,
        allowedSegmentIds: data.allowedSegmentIds,
        allowedTeamPrincipalIds: data.allowedTeamPrincipalIds,
      })
      return serializeCollection(collection)
    } catch (error) {
      log.error({ err: error }, 'update changelog collection failed')
      throw error
    }
  })

/**
 * Delete a changelog collection (entries move to the built-in "General" changelog)
 */
export const deleteChangelogCollectionFn = createServerFn({ method: 'POST' })
  .validator(deleteChangelogCollectionSchema)
  .handler(async ({ data }) => {
    log.info({ changelog_collection_id: data.id }, 'delete changelog collection')
    try {
      await requireAuth({ roles: ['admin'] })
      await deleteChangelogCollection(data.id as ChangelogCollectionId)
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'delete changelog collection failed')
      throw error
    }
  })

/**
 * List changelog collections visible to the caller (portal tabs)
 */
export const listPublicChangelogCollectionsFn = createServerFn({ method: 'GET' })
  .validator(z.object({}).optional())
  .handler(async () => {
    try {
      // Outer gate: private portal + unauthorized caller → no collections.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) return []

      const auth = hasAuthCredentials() ? await getOptionalAuth() : null
      const actor = await policyActorFromAuth(auth)
      return listPublicChangelogCollections(actor)
    } catch (error) {
      log.error({ err: error }, 'list public changelog collections failed')
      throw error
    }
  })
