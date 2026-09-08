import type { InfiniteData } from '@tanstack/react-query'

/**
 * Patch the pages of an infinite-list cache entry, leaving anything else alone.
 *
 * The inbox keeps its facet counts under the same prefix as its post lists
 * (`inboxKeys.lists()`), so a `setQueriesData` over that prefix also visits the
 * counts entry, whose data has no `pages`. An updater that assumes the list
 * shape throws there, and one throw aborts the whole batch. Route every
 * "update all lists" patch through this so non-list entries pass through.
 */
export function patchInfinitePages<TPage>(
  old: unknown,
  patchPage: (page: TPage) => TPage
): unknown {
  if (!old || typeof old !== 'object' || !Array.isArray((old as InfiniteData<TPage>).pages)) {
    return old
  }
  const data = old as InfiniteData<TPage>
  return { ...data, pages: data.pages.map(patchPage) }
}
