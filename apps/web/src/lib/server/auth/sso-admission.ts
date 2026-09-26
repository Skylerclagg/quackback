/**
 * Who a provider's group rule admits — the one answer both the account-creation
 * gate (signup-policy.ts) and role provisioning (hooks.ts) read, so the person
 * the gate let in is the person the promoter gives the default role.
 *
 * Two sources, tried in order:
 *
 *  1. The claim the token carried (`groups` for Entra). Free, and the IdP's own
 *     statement about this sign-in.
 *  2. For an Entra provider, the directory: is the address a member of one of
 *     the listed groups according to Microsoft Graph. The same app-only
 *     credentials and the same cached group-member lookup the segment rules
 *     use, so a workspace whose segments already follow Entra groups needs no
 *     token configuration at all — and a person in hundreds of groups, whose
 *     token cannot list them, is still admitted. Direct members only, as with
 *     segments.
 *
 * A directory failure is reported as `unavailable`, never as "not a member":
 * the caller fails closed, but with a code that says to try again rather than
 * to ask for a group they may already be in.
 */
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { accessRuleFor } from '@/lib/shared/oidc-claim-mapping'
import { resolveSsoAccess } from '@/lib/shared/resolve-sso-access'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'sso-admission' })

export type SsoAdmission =
  | { kind: 'allowed'; via: 'claim' | 'directory'; matched: string }
  | { kind: 'denied' }
  /** Entra omitted the claim for a person in too many groups, and no directory
   *  lookup was possible. */
  | { kind: 'overage' }
  /** The directory could not be asked (credentials, permission, outage). */
  | { kind: 'unavailable' }

/**
 * Evaluate the provider's group rule for this sign-in. Returns null when the
 * provider has no rule, so callers keep their domain-based behaviour.
 */
export async function resolveSsoAdmission(
  provider: IdentityProvider,
  email: string,
  claims: Record<string, unknown> | null
): Promise<SsoAdmission | null> {
  const rule = accessRuleFor(provider.claimMapping)
  if (!rule) return null

  const fromClaim = claims ? resolveSsoAccess(claims, rule) : null
  if (fromClaim?.kind === 'allowed') return { ...fromClaim, via: 'claim' }

  const {
    ENTRA_GROUP_ID_RE,
    getEntraGroupMemberEmails,
    isEntraProvider,
    resolveEntraDirectoryAccess,
  } = await import('@/lib/server/integrations/entra/graph')
  if (isEntraProvider(provider)) {
    const groupIds = rule.anyOf.filter((v) => ENTRA_GROUP_ID_RE.test(v))
    const access = groupIds.length > 0 ? await resolveEntraDirectoryAccess() : null
    if (access) {
      const wanted = email.trim().toLowerCase()
      try {
        for (const groupId of groupIds) {
          const members = await getEntraGroupMemberEmails(groupId)
          if (members.includes(wanted))
            return { kind: 'allowed', via: 'directory', matched: groupId }
        }
        return { kind: 'denied' }
      } catch (err) {
        log.warn(
          { err, provider_id: provider.registrationId },
          'directory group lookup failed during sign-up admission'
        )
        return { kind: 'unavailable' }
      }
    }
  }

  return fromClaim ?? { kind: 'denied' }
}
