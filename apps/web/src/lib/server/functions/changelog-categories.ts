/**
 * Server functions for changelog category (label) operations.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ChangelogCategoryId, RoadmapId, PrincipalId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  listChangelogCategories,
  createChangelogCategory,
  updateChangelogCategory,
  deleteChangelogCategory,
  reorderChangelogCategories,
} from '@/lib/server/domains/changelog/changelog-category.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'changelog-categories' })

const createCategorySchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .default('#6b7280'),
  segmentIds: z.array(z.string()).optional(),
  /**
   * Collection fields. A slug turns the category into a named changelog — a
   * tab on the public page at /changelog?changelog=<slug> with its own feed.
   * "general" is reserved for entries in no collection. null clears it.
   */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only')
    .refine((value) => value !== 'general', '"general" is reserved')
    .nullable()
    .optional(),
  description: z.string().trim().max(500).nullable().optional(),
  roadmapId: z.string().nullable().optional(),
  /** null/omitted = every team actor; [] = admins only; [ids] = admins plus those principals. */
  allowedTeamPrincipalIds: z.array(z.string()).max(200).nullable().optional(),
})

const updateCategorySchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  segmentIds: z.array(z.string()).optional(),
  /**
   * Collection fields. A slug turns the category into a named changelog — a
   * tab on the public page at /changelog?changelog=<slug> with its own feed.
   * "general" is reserved for entries in no collection. null clears it.
   */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only')
    .refine((value) => value !== 'general', '"general" is reserved')
    .nullable()
    .optional(),
  description: z.string().trim().max(500).nullable().optional(),
  roadmapId: z.string().nullable().optional(),
  /** null/omitted = every team actor; [] = admins only; [ids] = admins plus those principals. */
  allowedTeamPrincipalIds: z.array(z.string()).max(200).nullable().optional(),
})

const idSchema = z.object({ id: z.string() })
const reorderSchema = z.object({ ids: z.array(z.string()) })

/** List categories (public: powers the widget/portal filter chips too). */
export const listChangelogCategoriesFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list changelog categories')
  return await listChangelogCategories()
})

export const createChangelogCategoryFn = createServerFn({ method: 'POST' })
  .validator(createCategorySchema)
  .handler(async ({ data }) => {
    log.debug({ name: data.name }, 'create changelog category')
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    return await createChangelogCategory({
      ...data,
      roadmapId: data.roadmapId as RoadmapId | null | undefined,
      allowedTeamPrincipalIds: data.allowedTeamPrincipalIds as PrincipalId[] | null | undefined,
    })
  })

export const updateChangelogCategoryFn = createServerFn({ method: 'POST' })
  .validator(updateCategorySchema)
  .handler(async ({ data }) => {
    log.debug({ category_id: data.id }, 'update changelog category')
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    return await updateChangelogCategory(data.id as ChangelogCategoryId, {
      ...data,
      roadmapId: data.roadmapId as RoadmapId | null | undefined,
      allowedTeamPrincipalIds: data.allowedTeamPrincipalIds as PrincipalId[] | null | undefined,
    })
  })

export const deleteChangelogCategoryFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.debug({ category_id: data.id }, 'delete changelog category')
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    await deleteChangelogCategory(data.id as ChangelogCategoryId)
    return { success: true }
  })

export const reorderChangelogCategoriesFn = createServerFn({ method: 'POST' })
  .validator(reorderSchema)
  .handler(async ({ data }) => {
    log.debug({ count: data.ids.length }, 'reorder changelog categories')
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    await reorderChangelogCategories(data.ids as ChangelogCategoryId[])
    return { success: true }
  })
