/**
 * SysAid statuses for the status-mapping UI. Names are used as ids: the
 * inbound webhook reports the status caption, so the mapping must key on it.
 */
import type { ExternalStatusItem } from '@/lib/server/integrations/types'
import { listValues, login, normaliseAccountUrl } from './api'

export async function listSysAidStatuses(params: {
  accessToken: string
  config: Record<string, unknown>
}): Promise<ExternalStatusItem[]> {
  const accountUrl = params.config.accountUrl as string | undefined
  if (!accountUrl || !params.accessToken) return []
  const session = await login(normaliseAccountUrl(accountUrl), params.accessToken)
  const values = await listValues(session, 'status')
  return values.map((v) => ({ id: v.caption, name: v.caption }))
}
