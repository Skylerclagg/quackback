/**
 * The conversations a ticket links to, as openable rows.
 *
 * The counterpart to the detail panel's "Linked ticket" row, which already
 * takes a reader from a conversation to its ticket. Nothing took them the other
 * way, so a back-office task spun off a customer thread was a dead end: the
 * thread that caused it was reachable only by finding it again in the inbox.
 *
 * The two link kinds are labelled differently on purpose, because they mean
 * different things. A `provenance` row is a SEPARATE conversation this ticket
 * was opened from. A `pair` row is the customer ticket's own conversation —
 * one shared thread under two ids — so following it lands on the same
 * messages, and the row says so rather than letting the reader discover it.
 */
import { useQuery } from '@tanstack/react-query'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import type { TicketId } from '@quackback/ids'
import { ticketQueries } from '@/lib/client/queries/inbox'
import { MENU_LABEL } from '@/components/ui/menu'

export function TicketConversationLinks({
  ticketId,
  onSelectItem,
}: {
  ticketId: TicketId
  /** Open another inbox item by bare TypeID — the host resolves the kind. */
  onSelectItem: (id: string) => void
}) {
  const { data: linked } = useQuery(ticketQueries.conversations(ticketId))
  if (!linked || linked.length === 0) return null

  return (
    <div className="space-y-2">
      <span className={MENU_LABEL}>{linked.length === 1 ? 'Conversation' : 'Conversations'}</span>
      <div className="space-y-1">
        {linked.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectItem(c.id)}
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
          >
            <ChatBubbleLeftRightIcon
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-primary">{c.title}</span>
              <span className="block text-xs text-muted-foreground">
                {c.kind === 'pair' ? 'Same thread as this ticket' : 'Opened from this conversation'}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
