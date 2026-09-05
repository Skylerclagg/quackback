/**
 * A person's own names: display name (`user.name`), first name
 * (`user.givenName`) and last name (`user.familyName`).
 *
 * Normally these arrive as OIDC claims at sign-in. When the identity provider
 * sends none — or a placeholder such as Entra External ID's "unknown" — the
 * portal asks the person once and, for Entra accounts, writes the answer back
 * to their directory profile so the next sign-in carries it. Any signed-in
 * user may edit their own names; nothing else.
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
import { displayNameFromParts, isPlaceholderDisplayName } from '@/lib/shared/display-name'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'profile-name' })

const namePart = z.string().trim().min(1).max(64)
const nameSchema = z
  .object({
    givenName: namePart.optional(),
    familyName: namePart.optional(),
    displayName: z.string().trim().min(2).max(100).optional(),
  })
  .refine((v) => v.givenName || v.familyName || v.displayName, 'Nothing to save')

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
  const displayName = row?.name ?? ''
  const displayNameIsPlaceholder = isPlaceholderDisplayName(displayName)
  return {
    displayName,
    displayNameIsPlaceholder,
    givenName: row?.givenName ?? null,
    familyName: row?.familyName ?? null,
    needsName: !row?.givenName || !row?.familyName || displayNameIsPlaceholder,
  }
})

/**
 * Save whichever names were provided, then try the Entra write-back for the
 * first/last name. The local save is the contract; the write-back result is
 * reported, never a reason to fail.
 */
export const updateMyNameFn = createServerFn({ method: 'POST' })
  .validator(nameSchema)
  .handler(
    async ({
      data,
    }): Promise<{
      givenName: string | null
      familyName: string | null
      displayName: string
      entra: NameWriteBackResult
    }> => {
      const userId = await requireSessionUserId()
      const [current] = await db
        .select({ name: user.name, givenName: user.givenName, familyName: user.familyName })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
      if (!current) throw new Error('Authentication required')

      const givenName = data.givenName ?? current.givenName
      const familyName = data.familyName ?? current.familyName
      // A display name the person typed wins. Otherwise a blank or placeholder
      // display name (an IdP that sent "unknown") is filled in from the parts,
      // and a real one is left alone.
      const displayName =
        data.displayName ??
        (isPlaceholderDisplayName(current.name)
          ? (displayNameFromParts(givenName, familyName) ?? current.name)
          : current.name)

      await db
        .update(user)
        .set({ givenName, familyName, name: displayName })
        .where(eq(user.id, userId))
      if (displayName !== current.name) {
        await syncPrincipalProfile(userId, { displayName })
      }
      log.info({ user_id: userId }, 'profile names updated')

      // The directory gets the parts that were typed plus the display name this
      // save ends up with, so a profile Entra created as "unknown" is repaired
      // even when the app already showed the real name.
      const entra =
        data.givenName || data.familyName || displayName !== current.name
          ? await writeNameBackToEntra(userId, {
              givenName: data.givenName,
              familyName: data.familyName,
              displayName,
            })
          : ({ status: 'skipped', reason: 'no-entra-account' } as const)
      return { givenName, familyName, displayName, entra }
    }
  )
