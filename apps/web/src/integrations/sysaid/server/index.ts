import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { sysaidCatalog } from './catalog'
import { sysaidHook } from './hook'
import { sysaidIssues } from './issues'
import { sysaidInboundHandler } from './inbound'
import { listSysAidStatuses } from './statuses'
import { listValues, login, normaliseAccountUrl } from './api'

export const sysaidIntegration: IntegrationDefinition = {
  id: 'sysaid',
  catalog: sysaidCatalog,
  // Connected per workspace with an API user; nothing at platform level.
  platformCredentials: [],
  hook: sysaidHook,
  issues: sysaidIssues,
  inbound: sysaidInboundHandler,
  // SysAid has no webhook API; an escalation rule calls Quackback's inbound URL.
  webhookRegistration: 'manual',
  listExternalStatuses: listSysAidStatuses,
  // Routing destination: the SysAid category (problem_type) a record lands in.
  destinations: {
    category: {
      label: 'Category',
      async list({ accessToken, config }) {
        const accountUrl = config.accountUrl as string | undefined
        if (!accountUrl || !accessToken) return []
        const session = await login(normaliseAccountUrl(accountUrl), accessToken)
        const values = await listValues(session, 'problem_type')
        return values.map((v) => ({ id: v.id, name: v.caption }))
      },
    },
  },
}
