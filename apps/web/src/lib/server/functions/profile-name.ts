/**
 * A person's own first/last name (`user.givenName` / `user.familyName`).
 *
 * Normally these arrive as OIDC claims at sign-in. When the identity provider
 * sends none, the portal asks the person once and, for Entra accounts, offers
 * to write the answer back to their directory profile so the next sign-in
 * carries it. Any signed-in user may edit their own names; nothing else.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { UserId } from '@quackback/ids'
import { getSession } from '@/lib/server/auth/session'
import { db, user, eq } from '@/lib/server/db'
import { syncPrincipalProfile } from '@/lib/server/domains/principals/principal.service'
import {
  writeNameBackToEntra,
  type NameWriteBackResult,
} from '@/lib/server/integrations/entra/name-writeback'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'profile-name' })

const nameSchema = z.object({
  givenName: z.string().trim().min(1).max(64),
  familyName: z.string().trim().min(1).max(64),
})

async function requireSessionUserId(): Promise<UserId> {
  const session = await getSession()
  if (!session?.user) throw new Error('Authentication required')
  return session.user.id as UserId
}

/** What the portal needs to decide whether to ask for a name. */
export const getMyNameStatusFn = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireSessionUserId()
  const [row] = await db
    .select({ name: user.name, givenName: user.givenName, familyName: user.familyName })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return {
    displayName: row?.name ?? '',
    givenName: row?.givenName ?? null,
    familyName: row?.familyName ?? null,
    needsName: !row?.givenName || !row?.familyName,
  }
})

/**
 * Save first/last name, then try the Entra write-back. The local save is the
 * contract; the write-back result is reported, never a reason to fail.
 */
export const updateMyNameFn = createServerFn({ method: 'POST' })
  .validator(nameSchema)
  .handler(
    async ({
      data,
    }): Promise<{
      givenName: string
      familyName: string
      displayName: string
      entra: NameWriteBackResult
    }> => {
      const userId = await requireSessionUserId()
      const [current] = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
      if (!current) throw new Error('Authentication required')

      // A blank display name (an IdP that sent no `name` claim) is filled in
      // from the parts; a display name the person already has is left alone.
      const displayName = current.name.trim() || `${data.givenName} ${data.familyName}`
      await db
        .update(user)
        .set({ givenName: data.givenName, familyName: data.familyName, name: displayName })
        .where(eq(user.id, userId))
      if (displayName !== current.name) {
        await syncPrincipalProfile(userId, { displayName })
      }
      log.info({ user_id: userId }, 'profile given/family name updated')

      const entra = await writeNameBackToEntra(userId, data)
      return { givenName: data.givenName, familyName: data.familyName, displayName, entra }
    }
  )
