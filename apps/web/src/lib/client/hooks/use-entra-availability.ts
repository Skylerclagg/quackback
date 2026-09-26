/**
 * Whether the workspace can reach its Entra directory (an enabled, configured
 * Entra provider with a usable secret). Gates the group picker in the segment
 * rule builder and the sign-up group rule on the provider page. Cached for the
 * session: the answer only changes when an admin edits the provider.
 */
import { useQuery } from '@tanstack/react-query'
import { getEntraAvailabilityFn } from '@/lib/server/functions/entra'

export function useEntraAvailability(enabled = true): boolean {
  const { data } = useQuery({
    queryKey: ['admin', 'entra-availability'],
    queryFn: () => getEntraAvailabilityFn(),
    staleTime: 5 * 60 * 1000,
    enabled,
  })
  return data?.available === true
}
