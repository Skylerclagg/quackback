'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CheckIcon,
  EllipsisVerticalIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  UserIcon,
  UserMinusIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { updateMemberRoleFn, forceSignOutUserFn } from '@/lib/server/functions/admin'
import { adminResetTwoFactorFn } from '@/lib/server/functions/admin-reset-two-factor'
import { usersKeys } from '@/lib/client/hooks/use-users-queries'

interface MemberActionsProps {
  principalId: string
  userId: string | null
  memberName: string
  memberRole: 'admin' | 'member'
  isLastAdmin: boolean
}

/** Every role a person can hold. 'user' = portal-only, no admin access. */
type Role = 'admin' | 'member' | 'user'

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  member: 'Member',
  user: 'Portal user',
}

const ROLE_BLURBS: Record<Role, string> = {
  admin: 'Full access, including team settings, members, and all workspace configuration.',
  member:
    'Access to the admin area to manage feedback, roadmaps, and the changelog — but not team settings.',
  user: 'No admin access. They keep their account and activity and can still use the feedback portal.',
}

export function MemberActions({
  principalId,
  userId,
  memberName,
  memberRole,
  isLastAdmin,
}: MemberActionsProps) {
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)
  const [pendingRole, setPendingRole] = useState<Role | null>(null)
  const [resetTfaDialogOpen, setResetTfaDialogOpen] = useState(false)
  const [forceSignOutDialogOpen, setForceSignOutDialogOpen] = useState(false)

  // The last admin can neither be demoted nor moved out of the team —
  // either would leave the workspace with no one who can administer it.
  const canChangeRole = !(memberRole === 'admin' && isLastAdmin)

  const handleRoleChange = async () => {
    if (!pendingRole) return
    setIsLoading(true)
    try {
      await updateMemberRoleFn({ data: { principalId, role: pendingRole } })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
      // Demoting to 'user' moves them onto the Users page.
      await queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
      await queryClient.invalidateQueries({ queryKey: usersKeys.totalCount() })
    } catch (error) {
      console.error('Failed to update role:', error)
      alert(error instanceof Error ? error.message : 'Failed to update role')
    } finally {
      setIsLoading(false)
      setPendingRole(null)
    }
  }

  const handleResetTfa = async () => {
    if (!userId) return
    setIsLoading(true)
    try {
      await adminResetTwoFactorFn({ data: { userId } })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
    } catch (error) {
      console.error('Failed to reset 2FA:', error)
      alert(error instanceof Error ? error.message : 'Failed to reset two-factor')
    } finally {
      setIsLoading(false)
      setResetTfaDialogOpen(false)
    }
  }

  const handleForceSignOut = async () => {
    if (!userId) return
    setIsLoading(true)
    try {
      const result = await forceSignOutUserFn({ data: { userId } })
      toast.success(
        result.revokeCount
          ? `Signed ${memberName} out of ${result.revokeCount} session${result.revokeCount === 1 ? '' : 's'}.`
          : `${memberName} had no active sessions.`
      )
      await queryClient.invalidateQueries({ queryKey: ['settings', 'team'] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to sign user out')
    } finally {
      setIsLoading(false)
      setForceSignOutDialogOpen(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <EllipsisVerticalIcon className="h-4 w-4" />
            <span className="sr-only">Member actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* All three roles are listed explicitly — "Portal user" is the
              demotion out of the team, which was previously buried under
              a "Remove from team" label that read like a deletion. */}
          <DropdownMenuLabel className="text-xs text-muted-foreground">Role</DropdownMenuLabel>
          {(['admin', 'member', 'user'] as const).map((role) => {
            const isCurrent = role === memberRole
            const Icon =
              role === 'admin' ? ShieldCheckIcon : role === 'member' ? UserIcon : UserMinusIcon
            return (
              <DropdownMenuItem
                key={role}
                onClick={() => setPendingRole(role)}
                disabled={isCurrent || !canChangeRole}
                className="gap-2"
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{ROLE_LABELS[role]}</span>
                {isCurrent && <CheckIcon className="h-4 w-4 text-muted-foreground" />}
              </DropdownMenuItem>
            )
          })}
          {memberRole === 'admin' && isLastAdmin && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              This is the last admin — promote someone else first.
            </p>
          )}
          <DropdownMenuSeparator />
          {userId ? (
            <DropdownMenuItem onClick={() => setResetTfaDialogOpen(true)} className="gap-2">
              <ShieldExclamationIcon className="h-4 w-4" />
              Reset two-factor
            </DropdownMenuItem>
          ) : null}
          {userId ? (
            <DropdownMenuItem onClick={() => setForceSignOutDialogOpen(true)} className="gap-2">
              <ArrowRightOnRectangleIcon className="h-4 w-4" />
              Sign out everywhere
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={pendingRole !== null}
        onOpenChange={(open) => !open && setPendingRole(null)}
        title={
          pendingRole === 'user'
            ? 'Move to portal users?'
            : `Make ${pendingRole ? ROLE_LABELS[pendingRole].toLowerCase() : ''}?`
        }
        description={
          <>
            <strong>{memberName}</strong>{' '}
            {pendingRole === 'user'
              ? 'will be moved off the team and will appear under Users. '
              : 'will become '}
            {pendingRole !== 'user' && (
              <strong>{pendingRole ? ROLE_LABELS[pendingRole] : ''}</strong>
            )}
            {pendingRole !== 'user' && '. '}
            {pendingRole ? ROLE_BLURBS[pendingRole] : ''}
          </>
        }
        variant={pendingRole === 'user' ? 'destructive' : undefined}
        confirmLabel={
          isLoading
            ? 'Updating...'
            : pendingRole === 'user'
              ? 'Move to portal users'
              : `Make ${pendingRole ? ROLE_LABELS[pendingRole].toLowerCase() : ''}`
        }
        isPending={isLoading}
        onConfirm={handleRoleChange}
      />

      <ConfirmDialog
        open={resetTfaDialogOpen}
        onOpenChange={setResetTfaDialogOpen}
        title="Reset two-factor authentication?"
        description={
          <>
            <strong>{memberName}</strong>&apos;s two-factor enrollment will be cleared and any
            trusted devices revoked. They&apos;ll be able to sign in with just their password until
            they re-enroll. Use this only when they&apos;ve lost their authenticator and backup
            codes.
          </>
        }
        variant="destructive"
        confirmLabel={isLoading ? 'Resetting...' : 'Reset two-factor'}
        isPending={isLoading}
        onConfirm={handleResetTfa}
      />

      <ConfirmDialog
        open={forceSignOutDialogOpen}
        onOpenChange={setForceSignOutDialogOpen}
        title="Sign out everywhere?"
        description={
          <>
            All active sessions for <strong>{memberName}</strong> will be revoked. They&apos;ll need
            to sign in again on every device. Use this when an account is compromised, a device is
            lost, or a team member is leaving.
          </>
        }
        variant="destructive"
        confirmLabel={isLoading ? 'Signing out...' : 'Sign out everywhere'}
        isPending={isLoading}
        onConfirm={handleForceSignOut}
      />
    </>
  )
}
