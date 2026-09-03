import type { IntegrationCatalogEntry } from '@/lib/server/integrations/types'

export const sysaidCatalog: IntegrationCatalogEntry = {
  id: 'sysaid',
  name: 'SysAid',
  description:
    'Turn feedback into SysAid service records — on submission, once a post reaches a vote threshold, or when it moves to a status — and sync their status back.',
  category: 'support_crm',
  iconBg: 'bg-[#0f6cbd]',
  settingsPath: '/admin/settings/integrations/sysaid',
  available: true,
  configurable: false,
  // Built against SysAid's REST API v1 documentation; not yet exercised against
  // a live account, so it is labelled Beta until it has been.
  beta: true,
  docsUrl: 'https://documentation.sysaid.com/docs/rest-api-guide',
}
