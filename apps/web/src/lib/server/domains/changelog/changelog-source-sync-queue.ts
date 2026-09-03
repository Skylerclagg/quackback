/** Hourly job: import releases from every enabled external changelog source. */
import type { JobHandler } from '@/lib/server/jobs/definitions'
import { hasEnabledChangelogSources, syncAllChangelogSources } from './changelog-source.service'

export const runChangelogSourceSync: JobHandler = async () => {
  await syncAllChangelogSources()
}

export async function isChangelogSourceSyncDue(): Promise<boolean> {
  return hasEnabledChangelogSources()
}
