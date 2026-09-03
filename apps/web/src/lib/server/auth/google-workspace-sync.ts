/**
 * Google Workspace capture.
 *
 * Google's OIDC ID token carries an `hd` (hosted domain) claim for
 * Workspace accounts only — asserted by Google during the code
 * exchange and absent for consumer Gmail. That makes it a far stronger
 * "belongs to workspace X" signal than matching the email domain,
 * which any provider (or an unverified sign-up) can present.
 *
 * Wired into Better-Auth's account create/update database hooks, so it
 * runs on the first Google sign-in and every subsequent one (token
 * refresh rewrites the account row). The claim is persisted to
 * `user.metadata.googleWorkspaceDomain`, which the dynamic-segment
 * evaluator exposes as the `google_workspace` rule attribute; after a
 * change we re-evaluate the principal's dynamic segments immediately
 * so workspace-based segments (and anything gated on them, like
 * private roadmaps) apply on the very sign-in that established them.
 *
 * Failures are swallowed: segment sync must never break sign-in.
 */
import type { PrincipalId, UserId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'google-workspace-sync' })

export const GOOGLE_WORKSPACE_METADATA_KEY = 'googleWorkspaceDomain'

/**
 * Extract the `hd` claim from a raw ID-token JWT, lowercased.
 * Returns null for consumer accounts (no claim), malformed tokens, or
 * empty input. No signature verification — the token was just obtained
 * by Better-Auth directly from Google's token endpoint over TLS.
 */
export function extractHostedDomain(idToken: string | null | undefined): string | null {
  if (!idToken) return null
  const parts = idToken.split('.')
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      hd?: unknown
    }
    return typeof payload.hd === 'string' && payload.hd.length > 0 ? payload.hd.toLowerCase() : null
  } catch {
    return null
  }
}

interface AccountLike {
  providerId?: string
  userId?: string
  idToken?: string | null
}

/**
 * Persist the account's Workspace domain onto the user record and
 * re-evaluate the principal's dynamic segments when it changed.
 * No-ops for non-Google accounts and when the domain is unchanged.
 */
export async function syncGoogleWorkspaceFromAccount(account: AccountLike): Promise<void> {
  try {
    if (account.providerId !== 'google' || !account.userId || !account.idToken) return
    const hd = extractHostedDomain(account.idToken)

    const { db, user, principal, eq } = await import('@/lib/server/db')
    const userId = account.userId as UserId
    const row = await db.query.user.findFirst({
      where: eq(user.id, userId),
      columns: { metadata: true },
    })
    if (!row) return

    let metadata: Record<string, unknown> = {}
    try {
      metadata = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {}
    } catch {
      metadata = {}
    }
    const current =
      typeof metadata[GOOGLE_WORKSPACE_METADATA_KEY] === 'string'
        ? (metadata[GOOGLE_WORKSPACE_METADATA_KEY] as string)
        : null
    if (current === hd) return

    // hd disappeared (account left the workspace / consumer account
    // relinked) → clear the stale value so segment rules stop matching.
    if (hd === null) delete metadata[GOOGLE_WORKSPACE_METADATA_KEY]
    else metadata[GOOGLE_WORKSPACE_METADATA_KEY] = hd
    await db
      .update(user)
      .set({ metadata: JSON.stringify(metadata) })
      .where(eq(user.id, userId))
    log.info({ user_id: userId, workspace: hd }, 'google workspace domain updated')

    const p = await db.query.principal.findFirst({
      where: eq(principal.userId, userId),
      columns: { id: true },
    })
    if (!p) return
    const { evaluatePrincipalDynamicSegments } =
      await import('@/lib/server/domains/segments/segment.evaluation')
    await evaluatePrincipalDynamicSegments(p.id as PrincipalId)
  } catch (error) {
    // Never let segment bookkeeping break a sign-in.
    log.warn({ err: error }, 'google workspace sync failed')
  }
}
