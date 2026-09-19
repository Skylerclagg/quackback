import { useMutation } from '@tanstack/react-query'
import { ChevronDownIcon, CheckIcon, UserCircleIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { ConversationId } from '@quackback/ids'
import type { ConversationAuthorDTO } from '@/lib/shared/conversation/types'
import type { TeamMember } from '@/lib/server/domains/principals/principal.service'
import { assignConversationFn } from '@/lib/server/functions/conversation'
import { assignConversationTeamFn } from '@/lib/server/functions/teams'
import { useTeamMembers } from '@/lib/client/hooks/use-team-members'
import { useInboxTeams } from '@/components/admin/conversation/inbox-nav-sidebar'
import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * The assignee option rows for a dropdown — shared by the thread assignee control
 * and the bulk-action bar so "Assign to me" / "Unassign" / member rows render
 * identically. Mirrors PriorityMenuItems.
 */
export function AssigneeMenuItems({
  members,
  selectedPrincipalId,
  showUnassign = true,
  onSelect,
}: {
  members: TeamMember[] | undefined
  /** Current assignee's principal id; that row gets a check. */
  selectedPrincipalId?: string | null
  /** Offer the Unassign row (hide it when there's nothing to unassign). */
  showUnassign?: boolean
  onSelect: (assignTo: string | null) => void
}) {
  return (
    <>
      <DropdownMenuItem onClick={() => onSelect('me')}>Assign to me</DropdownMenuItem>
      {showUnassign && <DropdownMenuItem onClick={() => onSelect(null)}>Unassign</DropdownMenuItem>}
      {members && members.length > 0 && <DropdownMenuSeparator />}
      {members?.map((m) => (
        <DropdownMenuItem
          key={m.id}
          onClick={() => onSelect(m.id)}
          className="flex items-center gap-2"
        >
          <Avatar src={m.image} name={m.name ?? m.email} className="size-5 text-xs" />
          <span className="truncate">{m.name ?? m.email}</span>
          {selectedPrincipalId === m.id && (
            <CheckIcon className="ml-auto h-3.5 w-3.5 text-primary" />
          )}
        </DropdownMenuItem>
      ))}
    </>
  )
}

/**
 * The team rows for an assignee dropdown — shared by the conversation control
 * below and TicketAssigneeControl, which render the same roster against
 * different assignment endpoints.
 *
 * Shared rather than duplicated because they already drifted once: only the
 * ticket control had a team roster, so a conversation could be assigned to a
 * team by the server and the bulk bar but never by the dropdown a person
 * actually reaches for. One implementation cannot drift again.
 */
export function TeamMenuItems({
  teams,
  selectedTeamId,
  onSelect,
}: {
  teams: Array<{ id: string; name: string; color: string }> | undefined
  /** Current team; that row gets a check. */
  selectedTeamId?: string | null
  /** A team id, or null to clear the team. */
  onSelect: (teamId: string | null) => void
}) {
  if (!teams || teams.length === 0) return null
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
        Teams
      </DropdownMenuLabel>
      {selectedTeamId && (
        <DropdownMenuItem onClick={() => onSelect(null)}>Clear team</DropdownMenuItem>
      )}
      {teams.map((t) => (
        <DropdownMenuItem
          key={t.id}
          onClick={() => onSelect(t.id)}
          className="flex items-center gap-2"
        >
          <span
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ backgroundColor: t.color }}
          />
          <span className="min-w-0 flex-1 truncate">{t.name}</span>
          {selectedTeamId === t.id && (
            <CheckIcon className="ml-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          )}
        </DropdownMenuItem>
      ))}
    </>
  )
}

/**
 * Header control to assign a conversation to a teammate OR a team.
 *
 * The two axes are independent, mirroring tickets: assigning a team does not
 * clear the agent and vice versa. The team half was missing entirely — the
 * server fn, the permission and the DTO field all existed, and the bulk bar
 * could set it, but the per-conversation dropdown offered no way to, and an
 * assigned team was displayed nowhere in the app.
 */
export function AssigneeControl({
  conversationId,
  assignedAgent,
  assignedTeamId = null,
  onChanged,
}: {
  conversationId: ConversationId
  assignedAgent: ConversationAuthorDTO | null
  /**
   * The conversation's team, when it has one. Only the id: the DTO carries no
   * team name, and the name is resolved off the roster this control already
   * loads rather than widening the DTO for a label.
   */
  assignedTeamId?: string | null
  onChanged?: () => void
}) {
  const { data: members } = useTeamMembers()
  const { data: teams } = useInboxTeams()

  const mutation = useMutation({
    // `'me'` is resolved to the caller's principal server-side; null unassigns.
    mutationFn: (assignTo: string | null) =>
      assignConversationFn({ data: { conversationId, assignTo } }),
    onSuccess: () => onChanged?.(),
    onError: () => toast.error('Failed to assign conversation'),
  })

  const teamMutation = useMutation({
    mutationFn: (teamId: string | null) =>
      assignConversationTeamFn({ data: { conversationId, teamId } }),
    onSuccess: () => onChanged?.(),
    onError: () => toast.error('Failed to assign team'),
  })

  // An agent wins the label over a team, matching TicketAssigneeControl: the
  // more specific owner is the more useful thing to show at a glance. The
  // 'Team' fallback covers a roster that has not loaded yet, so an assigned
  // conversation never reads as "Unassigned".
  const assignedTeamName = assignedTeamId
    ? (teams?.find((t) => t.id === assignedTeamId)?.name ?? 'Team')
    : null
  const label = assignedAgent
    ? (assignedAgent.displayName ?? 'Assigned')
    : (assignedTeamName ?? 'Unassigned')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={mutation.isPending || teamMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          {assignedAgent ? (
            <Avatar
              src={assignedAgent.avatarUrl}
              name={assignedAgent.displayName ?? 'Agent'}
              className="size-4 text-xs"
            />
          ) : (
            <UserCircleIcon className="h-4 w-4" />
          )}
          <span className="max-w-28 truncate">{label}</span>
          <ChevronDownIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        <AssigneeMenuItems
          members={members}
          selectedPrincipalId={assignedAgent?.principalId}
          showUnassign={!!assignedAgent}
          onSelect={(assignTo) => mutation.mutate(assignTo)}
        />
        <TeamMenuItems
          teams={teams}
          selectedTeamId={assignedTeamId}
          onSelect={(teamId) => teamMutation.mutate(teamId)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
