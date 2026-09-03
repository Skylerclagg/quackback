/**
 * One-time ask for a first and last name when the account has none.
 *
 * Shown to signed-in portal visitors whose identity provider sent no
 * given/family name. "Not now" is remembered for the browser session so the
 * dialog doesn't chase people around the site; it comes back next visit until
 * the names exist. For Entra accounts the answer is also written back to the
 * person's own directory profile (see integrations/entra/name-writeback.ts),
 * and the toast says plainly whether that happened.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getMyNameStatusFn, updateMyNameFn } from '@/lib/server/functions/profile-name'
import type { NameWriteBackResult } from '@/lib/server/integrations/entra/name-writeback'

const DISMISS_KEY = 'quackback:name-prompt-dismissed'
export const nameStatusQueryKey = ['portal', 'me', 'name'] as const

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}
function writeDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // Storage blocked — the prompt simply returns next render cycle.
  }
}

/** Plain-language outcome of the Entra write-back for the toast. */
function describeWriteBack(intl: ReturnType<typeof useIntl>, result: NameWriteBackResult): string {
  switch (result.status) {
    case 'synced':
      return intl.formatMessage({
        id: 'portal.namePrompt.synced',
        defaultMessage: 'Name saved and updated in your Microsoft account.',
      })
    case 'failed':
      return intl.formatMessage(
        {
          id: 'portal.namePrompt.failed',
          defaultMessage: 'Name saved here. Microsoft rejected the update: {reason}',
        },
        { reason: result.reason }
      )
    case 'skipped':
      switch (result.reason) {
        case 'token-expired':
          return intl.formatMessage({
            id: 'portal.namePrompt.tokenExpired',
            defaultMessage:
              'Name saved here. Sign out and back in to also update your Microsoft profile.',
          })
        case 'scope-missing':
          return intl.formatMessage({
            id: 'portal.namePrompt.scopeMissing',
            defaultMessage:
              "Name saved here. Your Microsoft profile wasn't updated: the sign-in provider doesn't grant permission to edit it.",
          })
        default:
          return intl.formatMessage({
            id: 'portal.namePrompt.saved',
            defaultMessage: 'Name saved.',
          })
      }
  }
}

export function PortalNamePrompt({ enabled }: { enabled: boolean }) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: nameStatusQueryKey,
    queryFn: () => getMyNameStatusFn(),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  const [dismissed, setDismissed] = useState(readDismissed)
  const [open, setOpen] = useState(false)
  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')

  useEffect(() => {
    if (!data) return
    // Best-effort prefill from the display name: first word, then the rest.
    const [first = '', ...rest] = data.displayName.trim().split(/\s+/)
    setGivenName(data.givenName ?? first)
    setFamilyName(data.familyName ?? rest.join(' '))
    if (data.needsName && !dismissed) setOpen(true)
  }, [data, dismissed])

  const save = useMutation({
    mutationFn: (input: { givenName: string; familyName: string }) =>
      updateMyNameFn({ data: input }),
    onSuccess: (result) => {
      toast.success(describeWriteBack(intl, result.entra))
      void queryClient.invalidateQueries({ queryKey: nameStatusQueryKey })
      setOpen(false)
    },
    onError: () => {
      toast.error(
        intl.formatMessage({
          id: 'portal.namePrompt.error',
          defaultMessage: "Couldn't save your name. Please try again.",
        })
      )
    },
  })

  const dismiss = () => {
    writeDismissed()
    setDismissed(true)
    setOpen(false)
  }

  const canSave = givenName.trim().length > 0 && familyName.trim().length > 0 && !save.isPending

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (canSave) save.mutate({ givenName: givenName.trim(), familyName: familyName.trim() })
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({
                id: 'portal.namePrompt.title',
                defaultMessage: 'What should we call you?',
              })}
            </DialogTitle>
            <DialogDescription>
              {intl.formatMessage({
                id: 'portal.namePrompt.description',
                defaultMessage:
                  'Your account is missing a first or last name. Add them so the team knows who they are talking to.',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name-prompt-given">
                {intl.formatMessage({
                  id: 'portal.namePrompt.firstName',
                  defaultMessage: 'First name',
                })}
              </Label>
              <Input
                id="name-prompt-given"
                value={givenName}
                onChange={(e) => setGivenName(e.target.value)}
                maxLength={64}
                autoComplete="given-name"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name-prompt-family">
                {intl.formatMessage({
                  id: 'portal.namePrompt.lastName',
                  defaultMessage: 'Last name',
                })}
              </Label>
              <Input
                id="name-prompt-family"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                maxLength={64}
                autoComplete="family-name"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={dismiss} disabled={save.isPending}>
              {intl.formatMessage({ id: 'portal.namePrompt.later', defaultMessage: 'Not now' })}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {save.isPending
                ? intl.formatMessage({ id: 'portal.namePrompt.saving', defaultMessage: 'Saving…' })
                : intl.formatMessage({ id: 'portal.namePrompt.save', defaultMessage: 'Save' })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
