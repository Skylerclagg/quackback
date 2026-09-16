/**
 * Server Functions for the AI connection test and recent AI activity
 * (see domains/ai/connection-test.ts and domains/ai/recent-failures.ts).
 *
 * The test is separated from the reads: both reads are cheap and safe to call
 * on every page render, while the test makes real outbound requests with the
 * server's API key and should only run when someone asks for it.
 *
 * No try/catch here: server-function failures are logged once by the global
 * functionMiddleware, so a local log.error would report every failure twice.
 */

import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { describeAiConnection, runAiConnectionTest } from '@/lib/server/domains/ai/connection-test'
import { getRecentAiActivity } from '@/lib/server/domains/ai/recent-failures'

/** What is configured — no network. Same audience as the AI agent settings page. */
export const getAiConnectionStatusFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
  return describeAiConnection()
})

/**
 * Probe the configured endpoint and models. POST because it has a side
 * effect (outbound requests using the workspace's key) and must never be
 * cached or prefetched.
 */
export const testAiConnectionFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
  return runAiConnectionTest()
})

/**
 * What actually happened to the real AI calls recently. A database read of
 * ai_usage_log — no provider traffic — so it is a plain GET.
 */
export const getRecentAiActivityFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
  return getRecentAiActivity()
})
