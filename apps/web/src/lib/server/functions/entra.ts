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
} from '@/lib/server/integrations/entra/graph'
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
