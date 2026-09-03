/**
 * SysAid hook: create a service record when a routed creation trigger fires.
 */
import type { HookHandler, HookResult } from '@/lib/server/events/hook-types'
import type { EventData } from '@/lib/server/events/types'
import { resolveCreationEvent } from '@/lib/server/integrations/creation-event'
import { buildServiceRecordBody } from './message'
import { sysaidIssues } from './issues'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'sysaid' })

export interface SysAidTarget {
  /** Routing destination: a category (problem_type) id, or 'default'. */
  channelId: string
}

export const sysaidHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId } = target as SysAidTarget
    const cfg = config as Record<string, unknown> & { rootUrl: string }

    // Any routed creation trigger (new post, vote threshold, status change,
    // edit) arrives here; the helper turns it into a post.created-shaped event
    // and returns null for posts already linked to this integration.
    const creation = await resolveCreationEvent(event, 'sysaid')
    if (!creation) return { success: true }
    event = creation

    const { title, description } = buildServiceRecordBody(event, cfg.rootUrl)
    log.debug({ event_type: event.type, category: channelId }, 'creating service record')
    try {
      const created = await sysaidIssues.create!({
        auth: { ...cfg, channelId },
        title,
        bodyMarkdown: description,
      })
      log.info({ sr_id: created.externalId }, 'service record created')
      return {
        success: true,
        externalId: created.externalId,
        externalDisplayId: created.externalDisplayId,
        externalUrl: created.externalUrl ?? undefined,
      }
    } catch (error) {
      const retryable = (error as { retryable?: boolean }).retryable
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error({ err: error }, 'service record creation failed')
      return {
        success: false,
        error: message,
        shouldRetry: retryable ?? true,
        authExpired: /rejected the API user credentials/.test(message),
      }
    }
  },
}
