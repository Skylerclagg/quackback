/** Server functions for external changelog sources (Settings → Changelog). */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ChangelogCategoryId, ChangelogSourceId } from '@quackback/ids'
import { changelogSourceIdSchema } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'
import { CHANGELOG_SOURCE_KINDS } from '@/lib/server/db'
import {
  createChangelogSource,
  deleteChangelogSource,
  fetchReleases,
  getChangelogSource,
  listChangelogSources,
  syncChangelogSource,
  updateChangelogSource,
} from '@/lib/server/domains/changelog/changelog-source.service'

const sourceFields = {
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().url().max(2000),
  kind: z.enum(CHANGELOG_SOURCE_KINDS),
  categoryId: z.string().nullable().optional(),
  visibility: z.enum(['public', 'team', 'segment']).optional(),
  publishAs: z.enum(['published', 'draft']).optional(),
  enabled: z.boolean().optional(),
}

function serialize(row: Awaited<ReturnType<typeof getChangelogSource>>) {
  return {
    ...row,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const listChangelogSourcesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
  return (await listChangelogSources()).map(serialize)
})

export const createChangelogSourceFn = createServerFn({ method: 'POST' })
  .validator(z.object(sourceFields))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    const row = await createChangelogSource(
      { ...data, categoryId: data.categoryId as ChangelogCategoryId | null | undefined },
      auth.principal.id
    )
    return serialize(row)
  })

export const updateChangelogSourceFn = createServerFn({ method: 'POST' })
  .validator(z.object(sourceFields).partial().extend({ id: changelogSourceIdSchema }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    const { id, ...rest } = data
    const row = await updateChangelogSource(id as ChangelogSourceId, {
      ...rest,
      categoryId: rest.categoryId as ChangelogCategoryId | null | undefined,
    })
    return serialize(row)
  })

export const deleteChangelogSourceFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: changelogSourceIdSchema }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    await deleteChangelogSource(data.id as ChangelogSourceId)
    return { success: true }
  })

/** Fetch and parse without writing anything: what would be imported. */
export const previewChangelogSourceFn = createServerFn({ method: 'POST' })
  .validator(z.object({ url: sourceFields.url, kind: sourceFields.kind }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    const releases = await fetchReleases(data.url, data.kind)
    return releases.slice(0, 50).map((r) => ({
      key: r.key,
      title: r.title,
      date: r.date?.toISOString() ?? null,
      excerpt: r.markdown.replace(/\s+/g, ' ').slice(0, 160),
    }))
  })

export const syncChangelogSourceNowFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: changelogSourceIdSchema }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    const source = await getChangelogSource(data.id as ChangelogSourceId)
    return await syncChangelogSource(source)
  })
