/**
 * One-time ask for names when the account is missing them.
 *
 * Shown to signed-in portal visitors whose identity provider sent no first or
 * last name, or a placeholder display name (Entra External ID's "unknown").
 * "Not now" is remembered for the browser session so the dialog doesn't chase
 * people around the site; it comes back next visit until the names exist. For
 * Entra accounts the first/last name is also written back to the person's own
 * directory profile (see integrations/entra/name-writeback.ts), and the toast
 * says plainly whether that happened.
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
import { describeNameWriteBack } from '@/lib/shared/entra-writeback-message'
import { displayNameFromParts } from '@/lib/shared/display-name'

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
  const [displayName, setDisplayName] = useState('')
  const [displayNameTouched, setDisplayNameTouched] = useState(false)

  useEffect(() => {
    if (!data) return
    // Best-effort prefill: the stored parts, else the display name split into
    // first word and the rest. A placeholder display name ("unknown") is not
    // worth keeping, so it starts from the parts instead.
    const usableDisplay = data.displayNameIsPlaceholder ? '' : data.displayName.trim()
    const [first = '', ...rest] = usableDisplay.split(/\s+/)
    const given = data.givenName ?? first
    const family = data.familyName ?? rest.join(' ')
    setGivenName(given)
    setFamilyName(family)
    setDisplayName(usableDisplay || (displayNameFromParts(given, family) ?? ''))
    setDisplayNameTouched(false)
    if (data.needsName && !dismissed) setOpen(true)
  }, [data, dismissed])

  // Until the person edits it, the display name follows the parts.
  useEffect(() => {
    if (displayNameTouched) return
    if (!data || !data.displayNameIsPlaceholder) return
    setDisplayName(displayNameFromParts(givenName, familyName) ?? '')
  }, [givenName, familyName, displayNameTouched, data])

  const save = useMutation({
    mutationFn: (input: { givenName: string; familyName: string; displayName: string }) =>
      updateMyNameFn({ data: input }),
    onSuccess: (result) => {
      toast.success(describeNameWriteBack(result.entra))
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

  const canSave =
    givenName.trim().length > 0 &&
    familyName.trim().length > 0 &&
    displayName.trim().length >= 2 &&
    !save.isPending

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (canSave)
              save.mutate({
                givenName: givenName.trim(),
                familyName: familyName.trim(),
                displayName: displayName.trim(),
              })
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
              {data?.displayNameIsPlaceholder
                ? intl.formatMessage({
                    id: 'portal.namePrompt.description',
                    defaultMessage:
                      'Your account is missing a name. Add it so the team knows who they are talking to.',
                  })
                : intl.formatMessage({
                    id: 'portal.namePrompt.descriptionParts',
                    defaultMessage:
                      'Add your first and last name so the team knows who they are talking to.',
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
          <div className="space-y-2">
            <Label htmlFor="name-prompt-display">
              {intl.formatMessage({
                id: 'portal.namePrompt.displayName',
                defaultMessage: 'Display name',
              })}
            </Label>
            <Input
              id="name-prompt-display"
              value={displayName}
              onChange={(e) => {
                setDisplayNameTouched(true)
                setDisplayName(e.target.value)
              }}
              maxLength={100}
              autoComplete="nickname"
              required
            />
            <p className="text-xs text-muted-foreground">
              {intl.formatMessage({
                id: 'portal.namePrompt.displayNameHint',
                defaultMessage: 'Shown on your posts and comments.',
              })}
            </p>
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
