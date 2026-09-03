/**
 * Claim normalisation applied to every OAuth/OIDC profile via the
 * genericOAuth + social `mapProfileToUser` hook.
 *
 * The hook's return value is spread OVER the resolved user info by
 * Better-Auth, so whatever this returns wins for the keys it sets. That is
 * what lets us tighten `email_verified` without patching the library.
 *
 * Kept pure and standalone (no DB, no config) so the rules are unit-testable
 * and so `createAuth()` holds no inline claim logic.
 *
 * The one rule it tightens is `email_verified`. OIDC Core types it as a
 * boolean, but SAML-to-OIDC bridges routinely stringify it, and the string
 * `"false"` is truthy — which is how an unverified address ended up marking the
 * local account verified. That value then renders a verified badge in admin,
 * ships as a boolean on the public API, and satisfies the local-verification
 * guard that gates trusted-provider linking. `isAffirmativeClaim` is shared
 * with identity resolution so the two cannot disagree about it.
 */
import { isAffirmativeClaim } from '@/lib/shared/oidc-claim-mapping'
import { displayNameFromParts, isPlaceholderDisplayName } from '@/lib/shared/display-name'

/**
 * Declared as a type alias rather than an interface deliberately: Better-Auth
 * types the hook's return as `Record<string, unknown>`, and TypeScript grants
 * an implicit index signature to type aliases but not to interfaces.
 */
export type MappedProfileClaims = {
  /** BCP-47 locale claim, or null when absent/blank/non-string. */
  locale: string | null
  /** Strictly coerced `email_verified`. */
  emailVerified: boolean
  /** OIDC `given_name`. Present ONLY when the claim carried a value — see below. */
  givenName?: string
  /** OIDC `family_name`. Present ONLY when the claim carried a value. */
  familyName?: string
  /**
   * Display name, present ONLY when the IdP's `name` claim was blank or a
   * placeholder (Entra External ID sends "unknown") and given/family could
   * stand in for it. A real `name` claim is never overridden here.
   */
  name?: string
}

/**
 * Read a name claim, treating blank and non-string as absent.
 *
 * Returns null rather than '' so callers cannot accidentally write an empty
 * string over a real name.
 */
function readNameClaim(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function mapProfileClaims(profile: unknown): MappedProfileClaims {
  const p = profile as
    | {
        locale?: unknown
        email_verified?: unknown
        given_name?: unknown
        family_name?: unknown
        name?: unknown
      }
    | null
    | undefined

  const mapped: MappedProfileClaims = {
    locale: typeof p?.locale === 'string' && p.locale.length > 0 ? p.locale : null,
    emailVerified: isAffirmativeClaim(p?.email_verified),
  }

  // Assigned only when the claim has a value, never set to null/undefined.
  // This return is spread OVER the resolved user info, so a key present with
  // an empty value would overwrite the stored column. A directory that stops
  // releasing given_name — or a person who filled theirs in by hand and then
  // signed in again — must not lose the name that way. Omitting the key
  // leaves the existing column untouched; including it refreshes from the
  // directory, which is what makes the directory authoritative while it
  // actually has an answer.
  const givenName = readNameClaim(p?.given_name)
  if (givenName) mapped.givenName = givenName

  const familyName = readNameClaim(p?.family_name)
  if (familyName) mapped.familyName = familyName

  // Entra External ID hands self-service sign-ups the literal displayName
  // "unknown". That is not a name, so stand in the parts we do have; a real
  // `name` claim is left for the resolver to apply untouched.
  if (isPlaceholderDisplayName(readNameClaim(p?.name))) {
    const derived = displayNameFromParts(givenName, familyName)
    if (derived) mapped.name = derived
  }

  return mapped
}
