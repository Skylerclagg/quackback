/**
 * Claim-driven sign-up admission. Pure: a claims bag and an access rule in, a
 * verdict out. Shared by the account-creation gate and the provisioning hook
 * so the two can never disagree about who is in the group.
 *
 * Entra ID has a wrinkle worth naming. When a person is in more groups than a
 * token can carry (about 200), the token omits `groups` and leaves an overage
 * marker instead — `_claim_names` / `_claim_sources`, or `hasgroups` in the
 * implicit flow. That is not "in no group", it is "cannot tell", and it gets a
 * verdict of its own so the sign-in page can say what to fix (limit the claim
 * to groups assigned to the application).
 */
import { getClaimByPath, type ClaimAccessRule } from './oidc-claim-mapping'
import { claimContains } from './resolve-sso-role'

export type SsoAccessVerdict =
  { kind: 'allowed'; matched: string } | { kind: 'denied' } | { kind: 'overage' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Entra's "too many groups to list in the token" markers for a claim. */
export function hasGroupsOverage(claims: Record<string, unknown>, claimPath: string): boolean {
  const names = claims._claim_names
  if (isRecord(names) && claimPath in names) return true
  return claimPath === 'groups' && claims.hasgroups === true
}

export function resolveSsoAccess(
  claims: Record<string, unknown>,
  rule: ClaimAccessRule
): SsoAccessVerdict {
  const claim = getClaimByPath(claims, rule.claimPath)
  for (const value of rule.anyOf) {
    if (claimContains(claim, value)) return { kind: 'allowed', matched: value }
  }
  if (claim === undefined && hasGroupsOverage(claims, rule.claimPath)) return { kind: 'overage' }
  return { kind: 'denied' }
}
