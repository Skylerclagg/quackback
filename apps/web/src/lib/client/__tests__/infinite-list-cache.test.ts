import { describe, it, expect } from 'vitest'
import { patchInfinitePages } from '../infinite-list-cache'

describe('patchInfinitePages', () => {
  const bump = (page: { items: number[] }) => ({ ...page, items: page.items.map((n) => n + 1) })

  it('patches every page of an infinite list', () => {
    const list = { pages: [{ items: [1] }, { items: [2, 3] }], pageParams: [null, 'c'] }
    expect(patchInfinitePages(list, bump)).toEqual({
      pages: [{ items: [2] }, { items: [3, 4] }],
      pageParams: [null, 'c'],
    })
  })

  it('leaves entries that are not infinite lists untouched (the facet counts)', () => {
    const counts = { statuses: { open: 3 }, responded: { responded: 1, unresponded: 2 } }
    expect(patchInfinitePages(counts, bump)).toBe(counts)
    expect(patchInfinitePages(undefined, bump)).toBeUndefined()
    expect(patchInfinitePages(null, bump)).toBeNull()
  })
})
