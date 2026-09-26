/**
 * IdP-claim-driven role resolution. Pure: one claims bag + a role mapping
 * in, a role (or null) out. Shared by production sign-in and the editor's
 * outcome preview.
 *
 * resolveSsoRole matches the resolved claim value against the mapping's
 * rules (first-match-wins). Arrays are scanned member-wise; scalars are
 * compared via case-insensitive equality. Returns null when no rule matches
 * (or no mapping is set) so the caller can fall back to the provider's
 * default role.
 */

import { getClaimByPath, type ClaimRoleMapping } from './oidc-claim-mapping'
import type { Role } from './roles'

type Claims = Record<string, unknown>

/**
 * Resolve a claim by dotted path OR by literal URL-shaped key.
 * Kept as a named export so existing tests that import getNestedClaim
 * continue to pass through the server shim.
 */
export function getNestedClaim(claims: Claims, path: string): unknown {
  return getClaimByPath(claims, path)
}

/**
 * Whether a claim value carries `needle`: an array is scanned member-wise, a
 * scalar compared whole, both case-insensitively. The one matcher behind every
 * rule that reads a claim, so a group id matches the same way whether it is
 * granting a role or admitting an account.
 */
export function claimContains(claim: unknown, needle: string): boolean {
  const wanted = needle.toLowerCase()
  if (Array.isArray(claim)) {
    return claim.some((entry) => typeof entry === 'string' && entry.toLowerCase() === wanted)
  }
  if (typeof claim === 'string') {
    return claim.toLowerCase() === wanted
  }
  return false
}

export function resolveSsoRoleMatch(
  claims: Claims,
  mapping: ClaimRoleMapping | undefined
): { role: Role; ruleIndex: number } | null {
  if (!mapping) return null
  const claim = getNestedClaim(claims, mapping.claimPath)
  for (let i = 0; i < mapping.rules.length; i++) {
    const rule = mapping.rules[i]
    if (rule && claimContains(claim, rule.whenContains)) {
      return { role: rule.role, ruleIndex: i }
    }
  }
  return null
}

export function resolveSsoRole(claims: Claims, mapping: ClaimRoleMapping | undefined): Role | null {
  return resolveSsoRoleMatch(claims, mapping)?.role ?? null
}
