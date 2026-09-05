/**
 * Fill empty first/last name from the identity provider after an OIDC sign-in.
 *
 * Why this exists: Entra's ID token carries `name`, `email` and `groups` but
 * no `given_name` / `family_name`, and the identity resolver stops at the ID
 * token once it has an id, email and name — so the parts were never learned
 * and every account had them empty, which made the portal ask each person for
 * a name the directory could have supplied. This step runs after the callback,
 * reads the parts from the ID token claims when the IdP releases them there,
 * and otherwise asks the provider's userinfo endpoint with the sign-in's
 * access token (Entra's returns them under the `profile` scope).
 *
 * It only ever fills blanks. A name someone typed is never replaced; the one
 * exception is a placeholder display name ("unknown"), which is rebuilt from
 * the parts exactly as the profile form does. Nothing here can fail a sign-in:
 * every error is logged and swallowed.
 */
import { displayNameFromParts, isPlaceholderDisplayName } from '@/lib/shared/display-name'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'auth-name-fill' })

export interface NameParts {
  given: string | null
  family: string | null
}

export interface CurrentNames {
  name: string | null
  givenName: string | null
  familyName: string | null
}

export interface NameFillPatch {
  givenName?: string
  familyName?: string
  name?: string
}

function readPart(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** `given_name` / `family_name` from an OIDC claim set, trimmed; null when absent. */
export function readNameParts(claims: Record<string, unknown> | null | undefined): NameParts {
  return { given: readPart(claims?.given_name), family: readPart(claims?.family_name) }
}

/**
 * What to write, given what is stored and what the IdP says. Only empty parts
 * are filled. The display name changes only when it is a placeholder and the
 * parts (stored or incoming) can replace it. Returns null when nothing changes.
 */
export function planNameFill(current: CurrentNames, incoming: NameParts): NameFillPatch | null {
  const patch: NameFillPatch = {}
  if (!readPart(current.givenName) && incoming.given) patch.givenName = incoming.given
  if (!readPart(current.familyName) && incoming.family) patch.familyName = incoming.family
  if (isPlaceholderDisplayName(current.name)) {
    const derived = displayNameFromParts(
      patch.givenName ?? readPart(current.givenName),
      patch.familyName ?? readPart(current.familyName)
    )
    if (derived) patch.name = derived
  }
  return Object.keys(patch).length > 0 ? patch : null
}

function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8'))
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

type ProviderRow = {
  registrationId: string
  userInfoUrl?: string | null
  discoveryUrl?: string | null
}

/** The provider's userinfo endpoint: the stored one, else discovery's. */
async function resolveUserInfoUrl(provider: ProviderRow): Promise<string | null> {
  if (provider.userInfoUrl) return provider.userInfoUrl
  if (!provider.discoveryUrl) return null
  const { safeFetch } = await import('@/lib/server/content/ssrf-guard')
  const res = await safeFetch(provider.discoveryUrl, { timeoutMs: 5000 })
  if (!res.ok) return null
  const doc: unknown = await res.json()
  const endpoint = (doc as { userinfo_endpoint?: unknown } | null)?.userinfo_endpoint
  return typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : null
}

async function fetchUserInfoParts(url: string, accessToken: string): Promise<NameParts> {
  const { safeFetch } = await import('@/lib/server/content/ssrf-guard')
  const res = await safeFetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 5000,
  })
  if (!res.ok) return { given: null, family: null }
  const body: unknown = await res.json()
  return readNameParts(body as Record<string, unknown>)
}

/**
 * After-hook step for `/oauth2/callback/:providerId`. Same gating as the other
 * callback steps: a registered OIDC provider and a session that was just
 * created. Everything else is best-effort.
 */
export async function handleNamePartsFillAfter(
  ctx: {
    path?: string
    params?: Record<string, unknown>
    context?: { newSession?: { user?: { id?: string } } | null }
  },
  providers: readonly ProviderRow[],
  registeredOidcIds: Set<string>
): Promise<void> {
  if (ctx.path !== '/oauth2/callback/:providerId') return
  const providerId = ctx.params?.providerId
  const { isRegisteredOidcProvider } = await import('./provider-ids')
  if (typeof providerId !== 'string' || !isRegisteredOidcProvider(providerId, registeredOidcIds))
    return
  const userId = ctx.context?.newSession?.user?.id
  if (typeof userId !== 'string') return
  const provider = providers.find((p) => p.registrationId === providerId)
  if (!provider) return

  try {
    const { db, user, account, and, eq, desc, sql } = await import('@/lib/server/db')
    type UserId = `user_${string}`
    const userIdTyped = userId as UserId
    const [row] = await db
      .select({ name: user.name, givenName: user.givenName, familyName: user.familyName })
      .from(user)
      .where(eq(user.id, userIdTyped))
      .limit(1)
    if (!row) return
    const complete =
      readPart(row.givenName) && readPart(row.familyName) && !isPlaceholderDisplayName(row.name)
    if (complete) return

    const linked = await db.query.account.findFirst({
      where: and(eq(account.userId, userIdTyped), eq(account.providerId, providerId)),
      columns: { idToken: true, accessToken: true },
      orderBy: desc(account.createdAt),
    })
    let incoming = readNameParts(decodeJwtPayload(linked?.idToken))
    if ((!incoming.given || !incoming.family) && linked?.accessToken) {
      const url = await resolveUserInfoUrl(provider)
      if (url) {
        const fromUserInfo = await fetchUserInfoParts(url, linked.accessToken)
        incoming = {
          given: incoming.given ?? fromUserInfo.given,
          family: incoming.family ?? fromUserInfo.family,
        }
      }
    }

    const patch = planNameFill(row, incoming)
    if (!patch) return
    await db.update(user).set(patch).where(eq(user.id, userIdTyped))
    if (patch.name) {
      // The principal's cached display name follows when it was blank or the
      // same placeholder; a name set deliberately on the principal stays.
      await db.execute(sql`
        UPDATE principal SET display_name = ${patch.name}
        WHERE user_id = ${userIdTyped}
          AND (NULLIF(display_name, '') IS NULL OR lower(display_name) = lower(${row.name ?? ''}))
      `)
    }
    log.info(
      { user_id: userId, provider_id: providerId, filled: Object.keys(patch) },
      'filled name parts from identity provider'
    )
  } catch (err) {
    log.warn(
      { err, user_id: userId, provider_id: providerId },
      'name-part fill failed; sign-in unaffected'
    )
  }
}
