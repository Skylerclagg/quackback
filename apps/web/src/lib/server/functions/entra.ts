/**
 * Server Functions for Entra ID directory integration.
 *
 * Graph access reuses the workspace's own Entra OIDC provider
 * registration — the client secret lives encrypted in
 * platform_credentials and is managed through the SSO settings UI, so
 * nothing Entra-related is ever configured through code or env vars.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import {
  resolveEntraDirectoryAccess,
  searchEntraGroups,
  getEntraGroupMemberEmails,
} from '@/lib/server/integrations/entra/graph'
import { db, user, sql } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'entra' })

/**
 * Whether Entra-backed features (the `entra_group` segment rule) should
 * be offered in the UI: requires an enabled, configured Entra identity
 * provider. Members can see the affordance — the segment rule builder
 * is an admin+member surface.
 */
export const getEntraAvailabilityFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAuth({ roles: ['admin', 'member'] })
    const access = await resolveEntraDirectoryAccess()
    return { available: access !== null }
  } catch (error) {
    log.error({ err: error }, 'entra availability check failed')
    throw error
  }
})

const searchGroupsSchema = z.object({
  query: z.string().max(200),
})

/**
 * Name-prefix group search for the rule builder's picker. Read-only
 * directory metadata (names + ids), same audience as the rule builder
 * itself. Failures propagate — the picker degrades to paste-a-GUID.
 */
export const searchEntraGroupsFn = createServerFn({ method: 'GET' })
  .validator(searchGroupsSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ roles: ['admin', 'member'] })
      return await searchEntraGroups(data.query)
    } catch (error) {
      log.error({ err: error }, 'entra group search failed')
      throw error
    }
  })

const previewGroupSchema = z.object({
  groupId: z.string(),
})

/**
 * Dry-run an Entra group rule and report where the members go.
 *
 * A group rule that resolves to nobody has three quite different
 * causes — the group is empty, the members expose no address Graph will
 * return, or their addresses simply don't match any account here — and
 * from the outside all three look identical: an empty segment. Reading
 * this off the database is not an option for a compose deployment,
 * where Postgres has no published port and no console, so the answer
 * has to be available from the product itself.
 *
 * Runs the SAME lowercased-email comparison the evaluator compiles, so
 * a match counted here is a match the sweep will make.
 *
 * Admin-only: it reports directory addresses, which is a wider set than
 * the portal users an admin already browses.
 */
export const previewEntraGroupFn = createServerFn({ method: 'GET' })
  .validator(previewGroupSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ roles: ['admin'] })
      const emails = await getEntraGroupMemberEmails(data.groupId)

      if (emails.length === 0) {
        return { addresses: 0, matched: 0, unmatchedSample: [] as string[] }
      }

      // Mirror of the evaluator's predicate (segment.evaluation.ts).
      const rows = await db
        .select({ email: sql<string>`LOWER(${user.email})` })
        .from(user)
        .where(
          sql`LOWER(${user.email}) IN (${sql.join(
            emails.map((e) => sql`${e}`),
            sql`, `
          )})`
        )

      const matchedSet = new Set(rows.map((r) => r.email))
      const unmatched = emails.filter((e) => !matchedSet.has(e))

      return {
        addresses: emails.length,
        matched: matchedSet.size,
        // Enough to spot a pattern (wrong domain, wrong namespace)
        // without dumping a directory into the browser.
        unmatchedSample: unmatched.slice(0, 5),
      }
    } catch (error) {
      log.error({ err: error }, 'entra group preview failed')
      throw error
    }
  })
