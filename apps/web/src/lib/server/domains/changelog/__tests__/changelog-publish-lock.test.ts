import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChangelogId } from '@quackback/ids'
import { violatesPublishedLock } from '../changelog.publish-lock'
import { updateChangelog } from '../changelog.service'

const mockEntryFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockCancelScheduledDispatch = vi.fn()

vi.mock('@/lib/server/db', () => {
  const noop = (...args: unknown[]) => args
  return {
    db: {
      query: {
        changelogEntries: { findFirst: (...args: unknown[]) => mockEntryFindFirst(...args) },
        changelogEntryCategories: { findMany: vi.fn().mockResolvedValue([]) },
      },
      update: () => ({
        set: (values: unknown) => {
          mockUpdateSet(values)
          return { where: () => Promise.resolve() }
        },
      }),
    },
    changelogEntries: { id: 'id', publishedAt: 'published_at', deletedAt: 'deleted_at' },
    changelogEntryPosts: {},
    changelogEntryCategories: {},
    changelogCategories: {},
    posts: {},
    boards: {},
    postStatuses: {},
    eq: noop,
    and: noop,
    or: noop,
    isNull: noop,
    isNotNull: noop,
    desc: noop,
    asc: noop,
    lt: noop,
    gt: noop,
    lte: noop,
    gte: noop,
    inArray: noop,
    count: noop,
    sql: noop,
  }
})
vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn().mockResolvedValue(undefined),
  cancelScheduledDispatch: (...args: unknown[]) => {
    mockCancelScheduledDispatch(...args)
    return Promise.resolve()
  },
}))
vi.mock('../changelog-embedding.service', () => ({
  embedChangelogEntryOnPublish: vi.fn().mockResolvedValue(undefined),
}))

const id = 'changelog_01test' as ChangelogId
const publishedEntry = {
  id,
  title: 'v1.0',
  content: 'notes',
  publishedAt: new Date('2026-08-01T00:00:00Z'),
  deletedAt: null,
  principalId: null,
}

/** Resolve to 'ok' or the error message; the read-back after the write is not under test. */
function outcome(p: Promise<unknown>) {
  return p.then(
    () => 'ok',
    (err: Error) => err.message
  )
}

describe('violatesPublishedLock', () => {
  it('flags every reader-visible field', () => {
    expect(violatesPublishedLock({ title: 'x' })).toBe(true)
    expect(violatesPublishedLock({ content: 'x' })).toBe(true)
    expect(violatesPublishedLock({ categoryIds: [] })).toBe(true)
    expect(violatesPublishedLock({ featuredImageUrl: null })).toBe(true)
    expect(violatesPublishedLock({ visibility: 'team' })).toBe(true)
    expect(violatesPublishedLock({ displayDate: null })).toBe(true)
  })

  it('allows taking the entry off the changelog', () => {
    expect(violatesPublishedLock({ publishState: { type: 'draft' } })).toBe(false)
    expect(
      violatesPublishedLock({ publishState: { type: 'scheduled', publishAt: new Date(2100, 0) } })
    ).toBe(false)
    expect(violatesPublishedLock({})).toBe(false)
    expect(violatesPublishedLock({ notify: false })).toBe(false)
  })

  it('refuses re-publishing in place (it would re-stamp publishedAt)', () => {
    expect(violatesPublishedLock({ publishState: { type: 'published' } })).toBe(true)
  })
})

describe('updateChangelog published lock', () => {
  beforeEach(() => {
    mockEntryFindFirst.mockReset()
    mockUpdateSet.mockReset()
    mockCancelScheduledDispatch.mockReset()
    mockEntryFindFirst.mockResolvedValueOnce(publishedEntry).mockResolvedValue(undefined)
  })

  it('rejects a content edit on a published entry before writing', async () => {
    await expect(updateChangelog(id, { title: 'Renamed' })).rejects.toThrow(/unpublish it/i)
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('rejects re-asserting published', async () => {
    await expect(updateChangelog(id, { publishState: { type: 'published' } })).rejects.toThrow(
      /unpublish it/i
    )
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('lets an unpublish through and clears publishedAt', async () => {
    const result = await outcome(updateChangelog(id, { publishState: { type: 'draft' } }))
    expect(result).not.toMatch(/unpublish it/i)
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ publishedAt: null }))
    expect(mockCancelScheduledDispatch).toHaveBeenCalledWith(`changelog-publish--${id}`)
  })

  it('lets external-source sync rewrite a live entry', async () => {
    const result = await outcome(
      updateChangelog(id, { title: 'Renamed' }, { allowPublishedEdits: true })
    )
    expect(result).not.toMatch(/unpublish it/i)
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ title: 'Renamed' }))
  })

  it('does not lock drafts', async () => {
    mockEntryFindFirst.mockReset()
    mockEntryFindFirst
      .mockResolvedValueOnce({ ...publishedEntry, publishedAt: null })
      .mockResolvedValue(undefined)
    const result = await outcome(updateChangelog(id, { title: 'Renamed' }))
    expect(result).not.toMatch(/unpublish it/i)
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ title: 'Renamed' }))
  })
})
