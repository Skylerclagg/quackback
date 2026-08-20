/**
 * Retroactive backfill of `user.given_name` / `user.family_name` from
 * the ID tokens already stored on `account.id_token`.
 *
 * `mapProfileToUser` only runs when Better-Auth first creates the user
 * row, so without this every account that existed before the columns
 * were added would stay blank until its owner happened to sign in
 * again. The claims are already on disk: `given_name` / `family_name`
 * are standard `profile`-scope claims, and `profile` has always been in
 * DEFAULT_OIDC_SCOPES, so tokens captured months ago carry them. This
 * decodes what is stored rather than calling the IdP — no network, no
 * new scope, and no Graph permission.
 *
 * Idempotent and additive: only rows still NULL on both columns are
 * considered, and a row is written only when a token actually yields a
 * name. Anyone this can't resolve (no OIDC account, a token that
 * predates the claim, malformed base64) is simply left for the
 * sign-in-time sync in `handleSsoCallbackAfter` to fill on next login.
 */

import { db, and, eq, isNull, account, user, sql } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'oidc-name-backfill' })

/** Cap per run so a large tenant can't stall startup; the rest fill on next sign-in. */
const MAX_ROWS = 5000

function claimString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Decode a JWT payload without verifying it.
 *
 * Safe here for two reasons: the token was already signature-verified
 * by Better-Auth at sign-in before being persisted, and the decoded
 * values are used purely as display text on an admin-only pane — never
 * for authentication or authorization decisions.
 */
export function readNameClaims(idToken: string | null): {
  givenName: string | null
  familyName: string | null
} {
  if (!idToken) return { givenName: null, familyName: null }
  const parts = idToken.split('.')
  if (parts.length !== 3) return { givenName: null, familyName: null }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<
      string,
      unknown
    >
    return {
      givenName: claimString(payload.given_name),
      familyName: claimString(payload.family_name),
    }
  } catch {
    return { givenName: null, familyName: null }
  }
}

/**
 * Populate the two name columns for users that have none.
 *
 * Returns how many rows were written so the caller can log a single
 * line rather than one per user.
 */
export async function backfillOidcNames(): Promise<{ updated: number }> {
  // Only users missing BOTH columns — never overwrite a name already
  // synced from a more recent sign-in.
  const rows = await db
    .select({ userId: user.id, idToken: account.idToken })
    .from(user)
    .innerJoin(account, eq(account.userId, user.id))
    .where(
      and(isNull(user.givenName), isNull(user.familyName), sql`${account.idToken} IS NOT NULL`)
    )
    .limit(MAX_ROWS)

  // One user can hold several accounts; keep the first token that
  // actually yields a name rather than letting a nameless provider
  // (e.g. a password row) mask a good OIDC one.
  const resolved = new Map<string, { givenName: string | null; familyName: string | null }>()
  for (const row of rows) {
    if (resolved.has(row.userId)) continue
    const claims = readNameClaims(row.idToken)
    if (claims.givenName || claims.familyName) resolved.set(row.userId, claims)
  }
  if (resolved.size === 0) return { updated: 0 }

  let updated = 0
  for (const [userId, claims] of resolved) {
    await db
      .update(user)
      .set({
        ...(claims.givenName ? { givenName: claims.givenName } : {}),
        ...(claims.familyName ? { familyName: claims.familyName } : {}),
      })
      // Re-assert the NULL guard: a concurrent sign-in may have filled
      // this row between the SELECT and here, and that value is fresher.
      .where(
        and(
          eq(user.id, userId as `user_${string}`),
          isNull(user.givenName),
          isNull(user.familyName)
        )
      )
    updated++
  }

  log.info({ updated, candidates: rows.length }, 'backfilled oidc name claims')
  return { updated }
}
