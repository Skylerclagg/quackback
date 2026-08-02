import { useState, useEffect, useCallback } from 'react'
import type { InboxFilters } from '@/lib/shared/types'

/**
 * Multi-select state for inbox posts (bulk actions).
 *
 * Selection clears automatically whenever the active filters change, since
 * the selected posts may no longer be in the visible list.
 */
export function usePostSelection(filters: InboxFilters) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())

  // Compare filters by value — the filters object identity also changes on
  // unrelated URL updates (e.g. opening a post modal), which shouldn't clear
  // the selection.
  const filtersKey = JSON.stringify(filters)
  useEffect(() => {
    setSelectedIds(new Set())
  }, [filtersKey])

  const toggleSelected = useCallback((postId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(postId)) {
        next.delete(postId)
      } else {
        next.add(postId)
      }
      return next
    })
  }, [])

  const selectAll = useCallback((postIds: string[]) => {
    setSelectedIds(new Set(postIds))
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  return { selectedIds, toggleSelected, selectAll, clearSelection }
}
