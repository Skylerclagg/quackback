import { createFileRoute, Navigate } from '@tanstack/react-router'
import { isValidTypeId } from '@quackback/ids'
import type { TicketId } from '@quackback/ids'
import type { TicketListFilter, TicketSort } from '@/lib/server/domains/tickets'
import type { TicketType, TicketStatusCategory } from '@/lib/shared/db-types'
import { TICKET_TYPES, TICKET_STATUS_CATEGORIES } from '@/lib/shared/db-types'
import { ticketQueries, inboxQueries } from '@/lib/client/queries/inbox'
import {
  TicketsWorkspace,
  scopeToAssignee,
  type TicketsSearch,
} from '@/components/admin/tickets/tickets-workspace'
import type { TicketScope } from '@/components/admin/tickets/ticket-list-column'
import type { FeatureFlags } from '@/lib/shared/types/settings'

/**
 * The standalone tickets workspace, behind the `supportTickets` flag. With the
 * flag off — the default — this route redirects exactly as it did when it was
 * a pure redirect, so the surface is opt-in.
 *
 * Deliberately thin. The page itself lives in
 * `components/admin/tickets/tickets-workspace.tsx`; this file is only the URL
 * contract, the loader warm and the flag gate, so it stays small enough that a
 * merge against it is trivial.
 *
 * The `?t=<id>&scope=&type=&status=&sort=` contract is the one this route
 * carried before the unified inbox retired it, so old bookmarks and links keep
 * working — and now open the ticket here rather than bouncing to the inbox.
 */
const SORTS: TicketSort[] = ['recent', 'oldest', 'created', 'priority']
function isTicketSort(v: unknown): v is TicketSort {
  return typeof v === 'string' && (SORTS as string[]).includes(v)
}

export const Route = createFileRoute('/admin/tickets')({
  // Everything defining the view lives in the URL so a refresh restores the
  // open ticket + filters and links are shareable.
  validateSearch: (search: Record<string, unknown>): TicketsSearch => ({
    t: typeof search.t === 'string' && isValidTypeId(search.t, 'ticket') ? search.t : undefined,
    scope: search.scope === 'mine' || search.scope === 'unassigned' ? search.scope : undefined,
    type: TICKET_TYPES.includes(search.type as TicketType)
      ? (search.type as TicketType)
      : undefined,
    status: TICKET_STATUS_CATEGORIES.includes(search.status as TicketStatusCategory)
      ? (search.status as TicketStatusCategory)
      : undefined,
    sort: isTicketSort(search.sort) ? search.sort : undefined,
  }),
  loaderDeps: ({ search }) => ({
    t: search.t,
    scope: search.scope,
    type: search.type,
    status: search.status,
    sort: search.sort,
  }),
  // Auth is enforced by the parent `/admin` guard, and `listTicketsFn`
  // self-enforces TICKET_VIEW — this loader only warms the cache.
  loader: async ({ deps, context }) => {
    const flags = context.settings?.featureFlags as FeatureFlags | undefined
    if (!flags?.supportTickets) return {}
    const { queryClient } = context
    const filter: TicketListFilter = {
      type: deps.type,
      statusCategory: deps.status,
      assignee: scopeToAssignee((deps.scope ?? 'all') as TicketScope),
      sort: deps.sort ?? 'recent',
    }
    const warm = (p: Promise<unknown>) => p.catch(() => undefined)
    await Promise.all([
      warm(queryClient.ensureQueryData(ticketQueries.list(filter))),
      warm(queryClient.ensureQueryData(ticketQueries.statuses())),
      deps.t
        ? warm(queryClient.ensureQueryData(inboxQueries.ticketDetail(deps.t as TicketId)))
        : undefined,
    ])
    return {}
  },
  component: TicketsRoute,
})

function TicketsRoute() {
  const { settings } = Route.useRouteContext()
  const search = Route.useSearch()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportTickets) {
    return <Navigate to="/admin/feedback" />
  }
  return <TicketsWorkspace search={search} />
}
