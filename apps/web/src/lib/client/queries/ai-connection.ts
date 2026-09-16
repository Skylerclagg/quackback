import { queryOptions } from '@tanstack/react-query'
import { getAiConnectionStatusFn } from '@/lib/server/functions/ai-connection'

export const aiConnectionKeys = {
  status: () => ['ai-connection', 'status'] as const,
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
}
