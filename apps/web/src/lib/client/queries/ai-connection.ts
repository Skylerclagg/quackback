import { queryOptions } from '@tanstack/react-query'
import {
  getAiConnectionStatusFn,
  getRecentAiActivityFn,
} from '@/lib/server/functions/ai-connection'

export const aiConnectionKeys = {
  status: () => ['ai-connection', 'status'] as const,
  activity: () => ['ai-connection', 'activity'] as const,
}

/** Configured-state read for the AI connection card. Never probes the provider. */
export const aiConnectionQueries = {
  status: () =>
    queryOptions({
      queryKey: aiConnectionKeys.status(),
      queryFn: () => getAiConnectionStatusFn(),
      // Environment-driven; only changes on a redeploy.
      staleTime: 60 * 1000,
    }),
  /** Recent real AI outcomes from ai_usage_log. */
  activity: () =>
    queryOptions({
      queryKey: aiConnectionKeys.activity(),
      queryFn: () => getRecentAiActivityFn(),
      staleTime: 30 * 1000,
    }),
}
