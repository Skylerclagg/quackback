import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/admin/changelog'
import { useMemo, useCallback } from 'react'

export type ChangelogStatusFilter = 'all' | 'draft' | 'scheduled' | 'published'

export interface ChangelogFilters {
  status: ChangelogStatusFilter
  /** Collection filter: a collection id, 'general', or 'all'. */
  changelog: string
  search?: string
}

export function useChangelogFilters() {
  const navigate = useNavigate()
  const search = Route.useSearch()

  const filters: ChangelogFilters = useMemo(
    () => ({
      status: search.status ?? 'all',
      changelog: search.changelog ?? 'all',
      search: search.search,
    }),
    [search.status, search.changelog, search.search]
  )

  const setFilters = useCallback(
    (updates: Partial<ChangelogFilters>) => {
      void navigate({
        to: '/admin/changelog',
        search: {
          ...search,
          ...('status' in updates && {
            status: updates.status === 'all' ? undefined : updates.status,
          }),
          ...('changelog' in updates && {
            changelog: updates.changelog === 'all' ? undefined : updates.changelog,
          }),
          ...('search' in updates && {
            search: updates.search || undefined,
          }),
        },
        replace: true,
      })
    },
    [navigate, search]
  )

  const clearFilters = useCallback(() => {
    void navigate({
      to: '/admin/changelog',
      search: {},
      replace: true,
    })
  }, [navigate])

  const hasActiveFilters = useMemo(() => {
    return filters.status !== 'all' || filters.changelog !== 'all'
  }, [filters.status, filters.changelog])

  return {
    filters,
    setFilters,
    clearFilters,
    hasActiveFilters,
  }
}
