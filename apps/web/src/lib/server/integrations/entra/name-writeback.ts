/**
 * Write a person's own first/last name back to their Entra ID profile.
 *
 * Delegated, not app-only: the PATCH goes to Graph's `/me` with the access
 * token the person's own sign-in produced, so it can only ever change the
 * profile of whoever is asking, and only when the identity provider's
 * scopes include `User.ReadWrite`. Nothing here needs the app registration
 * to hold a write permission on the directory.
 *
 * Every non-success path is a *skip with a reason*, never a throw: the local
 * save has already happened by the time this runs, and the caller turns the
 * reason into a plain sentence for the person ("sign out and back in", "the
 * provider doesn't grant permission to edit it").
 */
import { db, account, and, desc, eq, inArray } from '@/lib/server/db'
import type { UserId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { isEntraProvider, resolveEntraDirectoryAccess, type EntraDirectoryAccess } from './graph'

const log = logger.child({ component: 'entra-name-writeback' })

const GRAPH_ME = 'https://graph.microsoft.com/v1.0/me'
/** What a refresh asks for: the write scope plus the identity scopes already granted. */
const REFRESH_SCOPE =
  'https://graph.microsoft.com/User.ReadWrite offline_access openid profile email'
/** Treat a token that expires within this window as already expired. */
const EXPIRY_SLACK_MS = 30_000

export type NameWriteBackResult =
  | { status: 'synced' }
  | {
      status: 'skipped'
      reason: 'no-entra-account' | 'scope-missing' | 'token-expired' | 'provider-unavailable'
    }
  | { status: 'failed'; reason: string }

/**
 * Scopes as Better-Auth stored them. Providers return them space- or
 * comma-separated, and Graph scopes may carry their resource prefix, so both
 * are normalised away: `email,openid,User.Read` and
 * `https://graph.microsoft.com/User.ReadWrite openid` both parse.
 */
export function grantedScopes(scope: string | null | undefined): Set<string> {
  return new Set(
    (scope ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim().replace(/^https:\/\/graph\.microsoft\.com\//i, ''))
      .filter(Boolean)
  )
}

/** Whether the stored consent lets the person edit their own profile. */
export function hasProfileWriteScope(scope: string | null | undefined): boolean {
  const granted = grantedScopes(scope)
  return (
    granted.has('User.ReadWrite') ||
    granted.has('User.ReadWrite.All') ||
    granted.has('Directory.AccessAsUser.All')
  )
}

interface RefreshedToken {
  accessToken: string
  expiresAt: Date | null
  refreshToken: string | null
}

async function refreshDelegatedToken(
  access: EntraDirectoryAccess,
  refreshToken: string
): Promise<RefreshedToken | null> {
  const res = await fetch(access.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: access.clientId,
      client_secret: access.clientSecret,
      refresh_token: refreshToken,
      scope: REFRESH_SCOPE,
    }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    refresh_token?: string
    error?: string
    error_description?: string
  }
  if (!res.ok || !body.access_token) {
    log.warn({ error: body.error, status: res.status }, 'entra delegated token refresh failed')
    return null
  }
  return {
    accessToken: body.access_token,
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null,
    refreshToken: body.refresh_token ?? null,
  }
}

/**
 * PATCH the person's own Entra profile with the names they just saved here.
 * Resolves to a result, never rejects: see the file header.
 */
export async function writeNameBackToEntra(
  userId: UserId,
  name: { givenName: string; familyName: string }
): Promise<NameWriteBackResult> {
  try {
    const { listIdentityProviders } =
      await import('@/lib/server/domains/settings/identity-providers.service')
    const entraIds = (await listIdentityProviders())
      .filter((p) => isEntraProvider(p))
      .map((p) => p.registrationId)
    if (entraIds.length === 0) return { status: 'skipped', reason: 'provider-unavailable' }

    const [row] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), inArray(account.providerId, entraIds)))
      .orderBy(desc(account.updatedAt))
      .limit(1)
    if (!row) return { status: 'skipped', reason: 'no-entra-account' }
    if (!hasProfileWriteScope(row.scope)) return { status: 'skipped', reason: 'scope-missing' }

    let token = row.accessToken
    const stillValid =
      !!row.accessTokenExpiresAt &&
      row.accessTokenExpiresAt.getTime() > Date.now() + EXPIRY_SLACK_MS
    if (!token || !stillValid) {
      if (!row.refreshToken) return { status: 'skipped', reason: 'token-expired' }
      const access = await resolveEntraDirectoryAccess()
      if (!access) return { status: 'skipped', reason: 'provider-unavailable' }
      const refreshed = await refreshDelegatedToken(access, row.refreshToken)
      if (!refreshed) return { status: 'skipped', reason: 'token-expired' }
      token = refreshed.accessToken
      await db
        .update(account)
        .set({
          accessToken: refreshed.accessToken,
          accessTokenExpiresAt: refreshed.expiresAt,
          ...(refreshed.refreshToken && { refreshToken: refreshed.refreshToken }),
          updatedAt: new Date(),
        })
        .where(eq(account.id, row.id))
    }

    const res = await fetch(GRAPH_ME, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // Graph's field for a family name is `surname`.
      body: JSON.stringify({ givenName: name.givenName, surname: name.familyName }),
    })
    if (res.ok) {
      log.info({ user_id: userId }, 'entra profile name updated')
      return { status: 'synced' }
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string }
    }
    log.warn(
      { user_id: userId, status: res.status, code: body.error?.code },
      'entra profile name update rejected'
    )
    if (res.status === 401) return { status: 'skipped', reason: 'token-expired' }
    if (res.status === 403) return { status: 'skipped', reason: 'scope-missing' }
    return {
      status: 'failed',
      reason: body.error?.message ?? `Microsoft Graph returned HTTP ${res.status}`,
    }
  } catch (error) {
    log.warn({ err: error, user_id: userId }, 'entra profile name write-back errored')
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'Could not reach Microsoft Graph.',
    }
  }
}
