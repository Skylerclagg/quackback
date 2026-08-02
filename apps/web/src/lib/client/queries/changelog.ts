/**
 * Changelog Queries
 *
 * Query key factories and query options for changelog data.
 */

import { queryOptions, infiniteQueryOptions } from '@tanstack/react-query'
import type { ChangelogId } from '@quackback/ids'
import {
  listChangelogsFn,
  getChangelogFn,
  listPublicChangelogsFn,
  getPublicChangelogFn,
} from '@/lib/server/functions/changelog'
import {
  listChangelogCollectionsFn,
  listPublicChangelogCollectionsFn,
} from '@/lib/server/functions/changelog-collections'

const STALE_TIME_SHORT = 30 * 1000
const STALE_TIME_MEDIUM = 60 * 1000

/**
 * Query key factory for changelogs
 */
export const changelogKeys = {
  all: ['changelogs'] as const,
  lists: () => [...changelogKeys.all, 'list'] as const,
  list: (filters: { status?: string; changelogId?: string }) =>
    [...changelogKeys.lists(), filters] as const,
  details: () => [...changelogKeys.all, 'detail'] as const,
  detail: (id: ChangelogId) => [...changelogKeys.details(), id] as const,
  collections: () => [...changelogKeys.all, 'collections'] as const,
  public: () => [...changelogKeys.all, 'public'] as const,
  publicList: (filters?: { changelog?: string }) =>
    [...changelogKeys.public(), 'list', filters ?? {}] as const,
  publicCollections: () => [...changelogKeys.public(), 'collections'] as const,
  publicDetail: (id: ChangelogId) => [...changelogKeys.public(), 'detail', id] as const,
}

/**
 * Admin changelog queries
 */
export const changelogQueries = {
  list: (params: {
    status?: 'draft' | 'scheduled' | 'published' | 'all'
    /** Collection filter: a collection id, 'general', or omitted for all. */
    changelogId?: string
  }) =>
    infiniteQueryOptions({
      queryKey: changelogKeys.list(params),
      queryFn: ({ pageParam }) =>
        listChangelogsFn({
          data: {
            status: params.status,
            changelogId: params.changelogId,
            cursor: pageParam,
            limit: 20,
          },
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: STALE_TIME_SHORT,
    }),

  detail: (id: ChangelogId) =>
    queryOptions({
      queryKey: changelogKeys.detail(id),
      queryFn: () => getChangelogFn({ data: { id } }),
      staleTime: STALE_TIME_MEDIUM,
    }),

  collections: () =>
    queryOptions({
      queryKey: changelogKeys.collections(),
      queryFn: () => listChangelogCollectionsFn(),
      staleTime: STALE_TIME_SHORT,
    }),
}

/**
 * Public changelog queries
 */
export const publicChangelogQueries = {
  list: (params?: { changelog?: string }) =>
    infiniteQueryOptions({
      queryKey: changelogKeys.publicList(params),
      queryFn: ({ pageParam }) =>
        listPublicChangelogsFn({
          data: {
            cursor: pageParam,
            limit: 10,
            changelog: params?.changelog,
          },
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: STALE_TIME_MEDIUM,
    }),

  collections: () =>
    queryOptions({
      queryKey: changelogKeys.publicCollections(),
      queryFn: () => listPublicChangelogCollectionsFn(),
      staleTime: STALE_TIME_MEDIUM,
    }),

  detail: (id: ChangelogId) =>
    queryOptions({
      queryKey: changelogKeys.publicDetail(id),
      queryFn: () => getPublicChangelogFn({ data: { id } }),
      staleTime: STALE_TIME_MEDIUM,
    }),
}
