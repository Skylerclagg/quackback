/**
 * Placeholder display names an identity provider may send instead of nothing.
 *
 * Entra External ID (CIAM) creates self-service sign-ups with the literal
 * displayName "unknown" when the person never entered one, so a non-empty
 * `name` claim is not proof of a real name. Anything here is treated exactly
 * like a blank: derived from the given/family names when possible, and
 * otherwise asked for.
 */
const PLACEHOLDER_DISPLAY_NAMES = new Set(['unknown', 'n/a', 'none', 'null', 'undefined', '-'])

export function isPlaceholderDisplayName(value: string | null | undefined): boolean {
  const normalised = (value ?? '').trim().toLowerCase()
  return normalised.length === 0 || PLACEHOLDER_DISPLAY_NAMES.has(normalised)
}

/** "Given Family" from whatever parts exist, or null when there are none. */
export function displayNameFromParts(
  givenName: string | null | undefined,
  familyName: string | null | undefined
): string | null {
  const joined = [givenName, familyName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ')
  return joined.length > 0 ? joined : null
}
