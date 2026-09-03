/**
 * External changelog sources: CRUD, fetch-and-parse, and the idempotent sync
 * that turns each release into a changelog entry (create once, update when the
 * release text changes, never duplicate — keyed on source + release key).
 */
import {
  db,
  changelogSources,
  changelogEntries,
  eq,
  and,
  desc,
  type ChangelogSource,
  type ChangelogSourceKind,
} from '@/lib/server/db'
import type { ChangelogCategoryId, ChangelogSourceId, PrincipalId } from '@quackback/ids'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import type { AudienceVisibility } from '@/lib/server/policy/audience'
import {
  inferReleaseDates,
  parseJsonChangelog,
  parseVitePressChangelog,
  type ParsedRelease,
} from './changelog-source.parsers'
import { createChangelog, updateChangelog } from './changelog.service'

const log = logger.child({ component: 'changelog-sources' })

const FETCH_TIMEOUT_MS = 15_000
const MAX_BYTES = 2 * 1024 * 1024

export interface ChangelogSourceInput {
  name: string
  url: string
  kind: ChangelogSourceKind
  categoryId?: ChangelogCategoryId | null
  visibility?: AudienceVisibility
  publishAs?: 'published' | 'draft'
  enabled?: boolean
}

export interface SyncSummary {
  fetched: number
  created: number
  updated: number
  unchanged: number
}

/** Only public http(s) hosts; a source is admin-configured but the fetch runs server-side. */
export function assertFetchableUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new ValidationError('INVALID_URL', 'Enter a full URL, starting with https://')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError('INVALID_URL', 'Only http and https URLs can be read')
  }
  const host = url.hostname.toLowerCase()
  const privateHost =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('[')
  if (privateHost)
    throw new ValidationError('INVALID_URL', 'That address is not reachable from here')
  return url
}

export async function fetchReleases(
  url: string,
  kind: ChangelogSourceKind
): Promise<ParsedRelease[]> {
  const target = assertFetchableUrl(url)
  const res = await fetch(target, {
    headers: {
      Accept: kind === 'json' ? 'application/json' : 'text/html',
      'User-Agent': 'Quackback changelog importer',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`The changelog page returned HTTP ${res.status}`)
  const text = await res.text()
  if (text.length > MAX_BYTES) throw new Error('The changelog page is too large to import')
  if (kind === 'json') {
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('The URL did not return valid JSON')
    }
    return parseJsonChangelog(data, target.toString())
  }
  return parseVitePressChangelog(text, target.toString())
}

export async function listChangelogSources(): Promise<ChangelogSource[]> {
  return db.query.changelogSources.findMany({ orderBy: [desc(changelogSources.createdAt)] })
}

export async function getChangelogSource(id: ChangelogSourceId): Promise<ChangelogSource> {
  const row = await db.query.changelogSources.findFirst({ where: eq(changelogSources.id, id) })
  if (!row) throw new NotFoundError('SOURCE_NOT_FOUND', 'Changelog source not found')
  return row
}

export async function createChangelogSource(
  input: ChangelogSourceInput,
  createdBy: PrincipalId
): Promise<ChangelogSource> {
  assertFetchableUrl(input.url)
  const [row] = await db
    .insert(changelogSources)
    .values({
      name: input.name.trim(),
      url: input.url.trim(),
      kind: input.kind,
      categoryId: input.categoryId ?? null,
      visibility: input.visibility ?? 'public',
      publishAs: input.publishAs ?? 'published',
      enabled: input.enabled ?? true,
      createdByPrincipalId: createdBy,
    })
    .returning()
  return row!
}

export async function updateChangelogSource(
  id: ChangelogSourceId,
  input: Partial<ChangelogSourceInput>
): Promise<ChangelogSource> {
  if (input.url !== undefined) assertFetchableUrl(input.url)
  const [row] = await db
    .update(changelogSources)
    .set({
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.url !== undefined && { url: input.url.trim() }),
      ...(input.kind !== undefined && { kind: input.kind }),
      ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
      ...(input.visibility !== undefined && { visibility: input.visibility }),
      ...(input.publishAs !== undefined && { publishAs: input.publishAs }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      updatedAt: new Date(),
    })
    .where(eq(changelogSources.id, id))
    .returning()
  if (!row) throw new NotFoundError('SOURCE_NOT_FOUND', 'Changelog source not found')
  return row
}

/** Removes the source; imported entries stay, detached from it. */
export async function deleteChangelogSource(id: ChangelogSourceId): Promise<void> {
  await db
    .update(changelogEntries)
    .set({ sourceId: null, sourceKey: null })
    .where(eq(changelogEntries.sourceId, id))
  await db.delete(changelogSources).where(eq(changelogSources.id, id))
}

export async function hasEnabledChangelogSources(): Promise<boolean> {
  const row = await db.query.changelogSources.findFirst({
    where: eq(changelogSources.enabled, true),
  })
  return !!row
}

/**
 * Fetch, parse and upsert one source. Failures are recorded on the source
 * (`lastError`) and rethrown so a manual run can show them.
 */
export async function syncChangelogSource(source: ChangelogSource): Promise<SyncSummary> {
  const summary: SyncSummary = { fetched: 0, created: 0, updated: 0, unchanged: 0 }
  try {
    const releases = await fetchReleases(source.url, source.kind)
    summary.fetched = releases.length
    for (const release of inferReleaseDates(releases)) {
      const outcome = await upsertRelease(source, release)
      summary[outcome] += 1
    }
    await db
      .update(changelogSources)
      .set({ lastRunAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(changelogSources.id, source.id))
    log.info({ source_id: source.id, ...summary }, 'changelog source synced')
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed'
    await db
      .update(changelogSources)
      .set({ lastRunAt: new Date(), lastError: message, updatedAt: new Date() })
      .where(eq(changelogSources.id, source.id))
    log.warn({ err: error, source_id: source.id }, 'changelog source sync failed')
    throw error
  }
}

async function upsertRelease(
  source: ChangelogSource,
  release: ParsedRelease & { orderDate: Date | null }
): Promise<'created' | 'updated' | 'unchanged'> {
  // Where the entry sits in the list: the release date, or its inferred place.
  // Draft imports keep publishedAt null until someone publishes them.
  const publishedAt = source.publishAs === 'draft' ? undefined : (release.orderDate ?? undefined)
  const contentJson = sanitizeTiptapContent(markdownToTiptapJson(release.markdown || release.title))
  const existing = await db.query.changelogEntries.findFirst({
    where: and(
      eq(changelogEntries.sourceId, source.id),
      eq(changelogEntries.sourceKey, release.key)
    ),
    columns: { id: true, title: true, content: true, displayDate: true, publishedAt: true },
  })
  if (existing) {
    const dateChanged = !!release.date && existing.displayDate?.getTime() !== release.date.getTime()
    const orderChanged =
      !!publishedAt &&
      !!existing.publishedAt &&
      existing.publishedAt.getTime() !== publishedAt.getTime()
    if (
      existing.title === release.title &&
      existing.content === release.markdown &&
      !dateChanged &&
      !orderChanged
    ) {
      return 'unchanged'
    }
    await updateChangelog(existing.id, {
      title: release.title,
      content: release.markdown,
      contentJson,
      ...(release.date ? { displayDate: release.date } : {}),
    })
    if (orderChanged) {
      await db
        .update(changelogEntries)
        .set({ publishedAt })
        .where(eq(changelogEntries.id, existing.id))
    }
    return 'updated'
  }
  const author = {
    principalId: (source.createdByPrincipalId ?? '') as PrincipalId,
    name: source.name,
  }
  const entry = await createChangelog(
    {
      title: release.title,
      content: release.markdown,
      contentJson,
      publishState: source.publishAs === 'draft' ? { type: 'draft' } : { type: 'published' },
      ...(release.date ? { displayDate: release.date } : {}),
      ...(source.categoryId ? { categoryIds: [source.categoryId as ChangelogCategoryId] } : {}),
      visibility: source.visibility as AudienceVisibility,
      notify: false,
    },
    author
  )
  await db
    .update(changelogEntries)
    .set({
      sourceId: source.id,
      sourceKey: release.key,
      ...(publishedAt ? { publishedAt } : {}),
    })
    .where(eq(changelogEntries.id, entry.id))
  return 'created'
}

/** Sync every enabled source; one failing source never blocks the others. */
export async function syncAllChangelogSources(): Promise<void> {
  const sources = await db.query.changelogSources.findMany({
    where: eq(changelogSources.enabled, true),
  })
  for (const source of sources) {
    try {
      await syncChangelogSource(source)
    } catch {
      // recorded on the source row
    }
  }
}
