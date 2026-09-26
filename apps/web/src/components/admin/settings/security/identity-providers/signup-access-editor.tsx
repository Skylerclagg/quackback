/**
 * Sign-up admission from a claim: only people whose claim carries one of the
 * listed values may have an account created through this provider. Written
 * for the Entra ID case — a `groups` claim of group object ids — but any array
 * or scalar claim works, matched the same way role rules match. It decides
 * who gets an account, never who keeps one: existing accounts sign in as
 * before. Persists as absent unless at least one value is filled in (see
 * `normalizeAccessRule`).
 */
import { useState } from 'react'
import { UserGroupIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Autocomplete } from '@/components/ui/autocomplete'
import { deriveClaimSuggestions } from '@/lib/shared/claim-suggestions'
import { useEntraAvailability } from '@/lib/client/hooks/use-entra-availability'
import { EntraGroupPicker } from '@/components/admin/segments/entra-group-picker'
import { TestSignInButton } from '../sso/test-sign-in-button'
import { useSsoTestSignIn } from '../sso/use-sso-test-sign-in'
import type { AccessRule } from './provider-shared'

export function SignupAccessEditor({
  rule,
  disabled,
  registrationId,
  canTest,
  entra,
  onChange,
}: {
  rule: AccessRule | null
  disabled: boolean
  registrationId: string
  /** True once the provider is saved, so a test sign-in can actually run. */
  canTest: boolean
  /** An Entra ID provider: groups are picked by name and membership can be
   *  answered by the directory, not only by the token. */
  entra: boolean
  onChange: (rule: AccessRule | null) => void
}) {
  const current: AccessRule = rule ?? { claimPath: 'groups', anyOf: [] }
  const update = (patch: Partial<AccessRule>) => onChange({ ...current, ...patch })
  const count = current.anyOf.filter((v) => v.trim() !== '').length
  // Same signal that gates the segment builder's picker. Off for other IdPs.
  const directory = useEntraAvailability(entra)

  const { lastSuccess } = useSsoTestSignIn()
  const suggestions =
    lastSuccess && lastSuccess.registrationId === registrationId
      ? deriveClaimSuggestions(lastSuccess.claims)
      : null
  const pathSuggestions = (suggestions?.paths ?? []).map((p) => ({ value: p }))
  const valueSuggestions = (suggestions?.valuesByPath[current.claimPath] ?? []).map((v) => ({
    value: v,
  }))

  const [open, setOpen] = useState(rule !== null)

  return (
    <div className="rounded-md border border-border/50 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <UserGroupIcon className="size-4 text-muted-foreground" />
          Restrict new accounts to a group
          {count > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              · {count} group{count === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <span className="text-muted-foreground">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border/40 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Only members of one of these groups get an account when they first sign in through this
            provider (Create accounts must be on). With no groups, anyone this provider vouches for
            at a verified domain can sign up. People who already have an account are not affected,
            and an invitation still admits anyone.
          </p>

          {entra && (
            <p className="text-xs text-muted-foreground">
              {directory
                ? 'Membership is checked against your directory through Microsoft Graph — the same permissions your Entra ID segment rules use — so the token does not need a groups claim. If it carries one, that is checked first. Direct members only, as with segments.'
                : 'Directory lookup is not available (no usable Entra credentials), so the ID token must carry the groups claim: in the app registration, Token configuration → Add groups claim → “Groups assigned to the application”.'}
            </p>
          )}

          {!entra && (
            <div className="space-y-1.5">
              <Label htmlFor="idp-access-claim-path">Claim path</Label>
              <Autocomplete
                value={current.claimPath}
                onValueChange={(v) => update({ claimPath: v })}
                suggestions={pathSuggestions}
                ariaLabel="Group claim path"
                placeholder="groups"
                emptyHint={
                  <div className="space-y-2 px-1 py-3 text-center">
                    <p className="text-xs text-muted-foreground">
                      Run a test sign-in to discover your IdP&apos;s claims.
                    </p>
                    <TestSignInButton
                      registrationId={registrationId}
                      disabled={disabled || !canTest}
                    />
                  </div>
                }
                disabled={disabled}
                className="w-full"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Allowed groups</Label>
            {current.anyOf.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No groups listed. New accounts are not restricted by group.
              </p>
            )}
            {current.anyOf.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">
                  {entra ? 'member of' : 'contains'}
                </span>
                {entra ? (
                  <EntraGroupPicker
                    value={value}
                    onChange={(id) =>
                      update({ anyOf: current.anyOf.map((x, i) => (i === index ? id : x)) })
                    }
                    className="flex-1"
                  />
                ) : (
                  <Autocomplete
                    value={value}
                    onValueChange={(v) =>
                      update({ anyOf: current.anyOf.map((x, i) => (i === index ? v : x)) })
                    }
                    suggestions={valueSuggestions}
                    ariaLabel={`Allowed group (${index + 1})`}
                    placeholder="group object id or name"
                    emptyHint="No values seen yet. Paste the group's object id."
                    disabled={disabled}
                    className="flex-1"
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  aria-label="Remove group"
                  onClick={() => update({ anyOf: current.anyOf.filter((_, i) => i !== index) })}
                  disabled={disabled}
                >
                  <TrashIcon className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => update({ anyOf: [...current.anyOf, ''] })}
              disabled={disabled}
            >
              <PlusIcon className="size-3.5" />
              Add group
            </Button>
          </div>

          {!entra && (
            <p className="text-xs text-muted-foreground">
              Values are matched the way role rules are: an array claim by member, a scalar claim
              whole, case-insensitively.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
