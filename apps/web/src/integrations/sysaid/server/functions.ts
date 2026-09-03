/**
 * SysAid server functions: connect with an API user, and list SysAid values for
 * the settings pickers. SysAid uses username/password (no OAuth); the pair is
 * stored encrypted as the integration's accessToken, "username:password".
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { randomBytes } from 'crypto'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { db, integrations, eq } from '@/lib/server/db'
import { listValues, login, normaliseAccountUrl, SysAidApiError } from './api'

export const saveSysAidCredentialsFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      accountUrl: z.string().trim().min(4).max(200),
      username: z.string().trim().min(1).max(200),
      password: z.string().min(1).max(500),
    })
  )
  .handler(async ({ data }) => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { saveIntegration } = await import('@/lib/server/integrations/save')
    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const accountUrl = normaliseAccountUrl(data.accountUrl)
    const accessToken = `${data.username}:${data.password}`
    // Verify the credentials by logging in once.
    try {
      await login(accountUrl, accessToken)
    } catch (error) {
      throw new Error(
        error instanceof SysAidApiError ? error.message : 'Could not reach SysAid at that address'
      )
    }

    // Keep an existing webhook secret across reconnects so a configured
    // escalation rule keeps working; mint one the first time.
    const existing = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'sysaid'),
      columns: { config: true },
    })
    const existingSecret = (existing?.config as { webhookSecret?: string } | null)?.webhookSecret
    await saveIntegration('sysaid', {
      principalId: auth.principal.id,
      accessToken,
      config: {
        accountUrl,
        workspaceName: new URL(accountUrl).host,
        webhookSecret: existingSecret ?? randomBytes(24).toString('hex'),
      },
    })
    return { success: true }
  })

const SAFE_LIST = /^[a-z_]{1,60}$/

/** Values of a SysAid list (urgency, priority, sr_type, problem_type, responsibility, …). */
export const fetchSysAidListFn = createServerFn({ method: 'POST' })
  .validator(z.object({ listName: z.string().regex(SAFE_LIST) }))
  .handler(async ({ data }): Promise<Array<{ id: string; caption: string }>> => {
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const { decryptSecrets } = await import('@/lib/server/integrations/encryption')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    const integration = await db.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'sysaid'),
    })
    if (!integration?.secrets || integration.status !== 'active') return []
    const { accessToken } = decryptSecrets<{ accessToken?: string }>(integration.secrets)
    const accountUrl = (integration.config as { accountUrl?: string }).accountUrl
    if (!accessToken || !accountUrl) return []
    const session = await login(normaliseAccountUrl(accountUrl), accessToken)
    return listValues(session, data.listName)
  })
