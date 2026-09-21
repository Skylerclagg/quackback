/**
 * The standalone tickets workspace: a ticket-shaped list beside the unified
 * thread.
 *
 * WHY THIS IS NOT THE UNIFIED INBOX. `/admin/inbox` already has `tickets_all`
 * and friends, so "a list of only tickets" is not the gap — those scopes
 * render ticket rows through the CONVERSATION list shell, with conversation
 * filters. This list is ticket-native: All/Mine/Unassigned scope, a ticket-type
 * filter, a status-CATEGORY filter and ticket sorts, with the whole view in the
 * URL so a refresh restores it and a link is shareable.
 *
 * WHY THE DETAIL IS NOT RESTORED. The deleted `TicketDetail`/`TicketThread`/
 * `TicketDetailPanel` were folded into `AgentConversationThread`, which now
 * mounts `InboxDetailPanel` itself and has since grown watchers, SLA, the
 * activity timeline, tracker and GitHub links and Copilot. Bringing the old
 * ones back would ship a strictly worse ticket detail, so everything right of
 * the list is the current unified thread — the same component the inbox
 * mounts, given `item={{ kind: 'ticket' }}`.
 *
 * Anything that is NOT a ticket (the conversation a ticket was opened from, a
 * previous conversation on the contact card) hands off to the inbox rather than
 * being rendered here: this page is about tickets, and the inbox is where a
 * conversation belongs.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import { TicketIcon } from '@heroicons/react/24/outline'
import { isValidTypeId } from '@quackback/ids'
import type { TicketId } from '@quackback/ids'
import type { TicketListFilter, TicketSort } from '@/lib/server/domains/tickets'
import type { TicketType, TicketStatusCategory } from '@/lib/shared/db-types'
import { ticketKeys, ticketQueries } from '@/lib/client/queries/inbox'
import { TicketListColumn, type TicketScope } from '@/components/admin/tickets/ticket-list-column'
import { CreateTicketDialog } from '@/components/admin/inbox/create-ticket-dialog'
import { AgentConversationThread } from '@/components/conversation/agent-conversation-thread'
import { EmptyState } from '@/components/shared/empty-state'

/** The page's URL contract — every field that defines the view. */
export interface TicketsSearch {
  t?: string
  scope?: 'mine' | 'unassigned'
  type?: TicketType
  status?: TicketStatusCategory
  sort?: TicketSort
}

/** Turn the scope pill into the list filter's assignee clause. */
export function scopeToAssignee(scope: TicketScope): TicketListFilter['assignee'] {
  if (scope === 'mine') return 'me'
  if (scope === 'unassigned') return 'unassigned'
  return undefined
}

export function TicketsWorkspace({ search }: { search: TicketsSearch }) {
  // `from` binds the search-param types to this route's contract, which is
  // what lets the updater below be checked. The route can't hand its own
  // `Route.useNavigate()` down without importing this file's importer.
  const navigate = useNavigate({ from: '/admin/tickets' })
  const queryClient = useQueryClient()
  const { t: urlT, scope: urlScope, type: urlType, status: urlStatus, sort: urlSort } = search
  const [composeOpen, setComposeOpen] = useState(false)

  const updateSearch = useCallback(
    (partial: Partial<TicketsSearch>) => {
      void navigate({
        to: '/admin/tickets',
        search: (prev) => ({ ...prev, ...partial }),
        replace: true,
      })
    },
    [navigate]
  )

  const scope: TicketScope = urlScope ?? 'all'
  const sort: TicketSort = urlSort ?? 'recent'
  const selectedId = (urlT as TicketId | undefined) ?? null

  const filter = useMemo<TicketListFilter>(
    () => ({
      type: urlType,
      statusCategory: urlStatus,
      assignee: scopeToAssignee(scope),
      sort,
    }),
    [urlType, urlStatus, scope, sort]
  )

  const { data: tickets, isLoading } = useQuery({
    ...ticketQueries.list(filter),
    refetchInterval: 30_000,
  })

  const selectTicket = useCallback(
    (id: TicketId | null) => updateSearch({ t: id ?? undefined }),
    [updateSearch]
  )

  /**
   * The thread's controls (status, assignee, priority, stage) change the very
   * facts the rows on the left render, so a change there has to invalidate the
   * list — without this, resolving a ticket leaves a stale row until the 30s
   * poll catches up, and under a status filter the row does not leave the list
   * at all. Invalidating the whole ticket namespace also covers the detail the
   * panel reads, which is the same cache.
   */
  const refreshTickets = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ticketKeys.all() })
  }, [queryClient])

  /**
   * The thread hands back a bare TypeID of either kind. A ticket stays on this
   * page; anything else (the conversation behind a "Linked ticket"/"Opened
   * from" row, a previous conversation from the contact card) opens in the
   * inbox, which is the surface that owns conversations.
   */
  const selectItem = useCallback(
    (id: string) => {
      if (isValidTypeId(id, 'ticket')) {
        selectTicket(id as TicketId)
        return
      }
      void navigate({ to: '/admin/inbox', search: { i: id } })
    },
    [navigate, selectTicket]
  )

  const openPost = useCallback(
    (postId: string) => {
      void navigate({ to: '/admin/inbox', search: { post: postId } })
    },
    [navigate]
  )

  return (
    <div className="flex h-full">
      <TicketListColumn
        scope={scope}
        onScope={(s) => updateSearch({ scope: s === 'all' ? undefined : s, t: undefined })}
        typeFilter={urlType}
        onTypeFilter={(type) => updateSearch({ type, t: undefined })}
        statusCategory={urlStatus}
        onStatusCategory={(status) => updateSearch({ status, t: undefined })}
        sort={sort}
        onSort={(s) => updateSearch({ sort: s === 'recent' ? undefined : s })}
        loading={isLoading}
        tickets={tickets ?? []}
        selectedId={selectedId}
        onSelect={selectTicket}
        onNewTicket={() => setComposeOpen(true)}
      />

      <div className={selectedId ? 'flex min-w-0 flex-1' : 'hidden min-w-0 flex-1 md:flex'}>
        {selectedId ? (
          // `key` remounts on switch so the thread never shows the previous
          // ticket's scroll position or composer draft.
          <AgentConversationThread
            key={selectedId}
            item={{ kind: 'ticket', id: selectedId }}
            targetMessageId={null}
            onChanged={refreshTickets}
            onBack={() => selectTicket(null)}
            onSelectItem={selectItem}
            onOpenPost={openPost}
            isVisitorTyping={false}
            isOtherAgentTyping={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <EmptyState
              icon={TicketIcon}
              title="Select a ticket"
              description="Choose a ticket from the list to view its properties and status."
            />
          </div>
        )}
      </div>

      <CreateTicketDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onCreated={(id) => {
          refreshTickets()
          selectTicket(id)
        }}
      />
    </div>
  )
}
