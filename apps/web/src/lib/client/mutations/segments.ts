/**
 * Segment mutations
 *
 * React Query mutations for segment management.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import {
  createSegmentFn,
  updateSegmentFn,
  deleteSegmentFn,
  assignUsersToSegmentFn,
  removeUsersFromSegmentFn,
  evaluateSegmentFn,
  evaluateAllSegmentsFn,
} from '@/lib/server/functions/admin'

const SEGMENTS_KEY = ['admin', 'segments']
const USERS_KEY = ['admin', 'users']
// Team principals can be segment members too, so the team page's
// per-member segment badges go stale on every membership change.
const TEAM_KEY = ['settings', 'team']
const PORTAL_USERS_KEY = ['users']

/**
 * Refresh everything that renders segment membership. Exported so
 * non-mutation callers (the CSV import section, which POSTs to
 * /api/segments/import rather than going through a server fn) invalidate
 * the exact same set instead of drifting their own copy of these keys.
 */
export function invalidateSegmentQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: SEGMENTS_KEY })
  void queryClient.invalidateQueries({ queryKey: USERS_KEY })
  void queryClient.invalidateQueries({ queryKey: TEAM_KEY })
  void queryClient.invalidateQueries({ queryKey: PORTAL_USERS_KEY })
}

/** Create a new segment. */
export function useCreateSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      description?: string
      type: 'manual' | 'dynamic'
      color?: string
      rules?: {
        match: 'all' | 'any'
        conditions: Array<{
          attribute: string
          operator: string
          value?: string | number | boolean
          metadataKey?: string
        }>
      }
      evaluationSchedule?: { enabled: boolean; pattern: string }
      weightConfig?: {
        attribute: {
          key: string
          label: string
          type: 'string' | 'number' | 'boolean' | 'date' | 'currency'
          currencyCode?: string
        }
        aggregation: 'sum' | 'average' | 'count' | 'median'
      }
    }) => createSegmentFn({ data: input as Parameters<typeof createSegmentFn>[0]['data'] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SEGMENTS_KEY })
    },
  })
}

/** Update an existing segment. */
export function useUpdateSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      segmentId: SegmentId
      name?: string
      description?: string | null
      color?: string
      rules?: {
        match: 'all' | 'any'
        conditions: Array<{
          attribute: string
          operator: string
          value?: string | number | boolean
          metadataKey?: string
        }>
      } | null
      evaluationSchedule?: { enabled: boolean; pattern: string } | null
      weightConfig?: {
        attribute: {
          key: string
          label: string
          type: 'string' | 'number' | 'boolean' | 'date' | 'currency'
          currencyCode?: string
        }
        aggregation: 'sum' | 'average' | 'count' | 'median'
      } | null
    }) =>
      updateSegmentFn({
        data: input as Parameters<typeof updateSegmentFn>[0]['data'],
      }),
    onSuccess: () => invalidateSegmentQueries(queryClient),
  })
}

/** Delete a segment. */
export function useDeleteSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (segmentId: SegmentId) => deleteSegmentFn({ data: { segmentId } }),
    onSuccess: () => invalidateSegmentQueries(queryClient),
  })
}

/** Assign users to a manual segment. */
export function useAssignUsersToSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      segmentId,
      principalIds,
    }: {
      segmentId: SegmentId
      principalIds: PrincipalId[]
    }) => assignUsersToSegmentFn({ data: { segmentId, principalIds } }),
    onSuccess: () => invalidateSegmentQueries(queryClient),
  })
}

/** Remove users from a manual segment. */
export function useRemoveUsersFromSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      segmentId,
      principalIds,
    }: {
      segmentId: SegmentId
      principalIds: PrincipalId[]
    }) => removeUsersFromSegmentFn({ data: { segmentId, principalIds } }),
    onSuccess: () => invalidateSegmentQueries(queryClient),
  })
}

/** Trigger re-evaluation of a dynamic segment. */
export function useEvaluateSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (segmentId: SegmentId) => evaluateSegmentFn({ data: { segmentId } }),
    onSuccess: () => invalidateSegmentQueries(queryClient),
  })
}

/** Trigger re-evaluation of all dynamic segments. */
export function useEvaluateAllSegments() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => evaluateAllSegmentsFn(),
    onSuccess: () => invalidateSegmentQueries(queryClient),
  })
}
