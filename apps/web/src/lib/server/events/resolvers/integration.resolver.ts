/**
 * Integration sink resolver (EVENTING-V2 WO-8b) — the DomainEvent-native port of
 * getIntegrationTargets(). Reads the cached integration_event_mappings, applies
 * the board filter, dedupes by (integrationType, channelId), decrypts the
 * per-integration access token, and emits one target per channel. Behavior +
 * target shape are preserved; only the event access (payload vs data) changes.
 */
import {
  db,
  integrations,
  integrationEventMappings,
  posts,
  postTagAssignments,
  eq,
  and,
} from '@/lib/server/db'
import type { PostId } from '@quackback/ids'
import type { EventMappingFilters } from '@/lib/server/db'
import { cacheGet, cacheSet, CACHE_KEYS } from '@/lib/server/cache'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import { buildHookContext } from '../hook-context'
import { logger } from '@/lib/server/logger'
import { getEventDefinition } from '../catalogue'
import { boardIdsFromEvent } from './webhook.resolver'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

const log = logger.child({ component: 'integration-resolver' })

export interface CachedMapping {
  eventType: string
  integrationType: string
  /** Integration row id — lets the worker refresh an expired token by id. */
  integrationId?: string
  secrets: string | null
  integrationConfig: unknown
  actionConfig: unknown
  filters: unknown
}

async function loadMappings(): Promise<CachedMapping[]> {
  const cached = await cacheGet<CachedMapping[]>(CACHE_KEYS.INTEGRATION_MAPPINGS)
  if (cached) return cached
  const rows = await db
    .select({
      eventType: integrationEventMappings.eventType,
      integrationType: integrations.integrationType,
      integrationId: integrations.id,
      secrets: integrations.secrets,
      integrationConfig: integrations.config,
      actionConfig: integrationEventMappings.actionConfig,
      filters: integrationEventMappings.filters,
    })
    .from(integrationEventMappings)
    .innerJoin(integrations, eq(integrationEventMappings.integrationId, integrations.id))
    .where(and(eq(integrationEventMappings.enabled, true), eq(integrations.status, 'active')))
  await cacheSet(CACHE_KEYS.INTEGRATION_MAPPINGS, rows, 300)
  return rows
}

/**
 * Pure target construction (unit-testable): filter mappings for this event type,
 * apply the board filter, dedupe by (integrationType, channelId), decrypt the
 * token via the injected `decrypt`. Mirrors getIntegrationTargets exactly.
 */
/**
 * Facts about the event's post that routing conditions may test. Absent
 * fields mean "unknown": a condition that needs an unknown fact does not
 * match, so a misconfigured row fails closed rather than fanning out.
 */
export interface TargetConditions {
  /** Tag ids currently on the post. */
  tagIds?: string[]
  /** The post's status id after the event. */
  statusId?: string
  /** The post's vote count after the event. */
  voteCount?: number
  /** Whether the provider creates one external item per post (dedupes on the link). */
  isTracker?: (integrationType: string) => boolean
}

/** Whether this mapping's filters accept the event. Exported for tests. */
export function mappingMatches(
  filters: Partial<EventMappingFilters> | null | undefined,
  eventType: string,
  boardIds: string[],
  conditions: TargetConditions,
  integrationType: string
): boolean {
  if (!filters) return true
  if (
    filters.boardIds?.length &&
    boardIds.length > 0 &&
    !boardIds.some((id) => filters.boardIds!.includes(id))
  ) {
    return false
  }
  if (filters.tagIds?.length) {
    const tags = conditions.tagIds
    if (!tags || !tags.some((id) => filters.tagIds!.includes(id))) return false
  }
  if (eventType === 'post.status_changed' && filters.statusIds?.length) {
    if (!conditions.statusId || !filters.statusIds.includes(conditions.statusId)) return false
  }
  if (eventType === 'post.voted' && typeof filters.minVotes === 'number' && filters.minVotes > 0) {
    const votes = conditions.voteCount
    if (votes === undefined || votes < filters.minVotes) return false
    // A channel message should announce the threshold once; a tracker
    // dedupes on the external link, so "at or above" is safe for it.
    if (!conditions.isTracker?.(integrationType) && votes !== filters.minVotes) return false
  }
  return true
}

/** Whether any of these mappings needs facts that only a post lookup provides. */
export function needsPostFacts(mappings: CachedMapping[]): boolean {
  return mappings.some((m) => {
    const f = m.filters as Partial<EventMappingFilters> | null
    return !!(f?.tagIds?.length || f?.statusIds?.length)
  })
}

export function buildIntegrationTargets(
  mappings: CachedMapping[],
  eventType: string,
  boardIds: string[],
  rootUrl: string,
  decrypt: (blob: string) => { accessToken?: string },
  conditions: TargetConditions = {}
): HookTarget[] {
  const targets: HookTarget[] = []
  const seen = new Set<string>()

  for (const m of mappings) {
    if (m.eventType !== eventType) continue

    const filters = m.filters as Partial<EventMappingFilters> | null
    if (!mappingMatches(filters, eventType, boardIds, conditions, m.integrationType)) continue

    const integrationConfig = (m.integrationConfig as Record<string, unknown>) || {}
    const actionConfig = (m.actionConfig as Record<string, unknown>) || {}
    const channelId = (actionConfig.channelId || integrationConfig.channelId) as string | undefined
    if (!channelId) {
      log.warn({ integration_type: m.integrationType }, 'no channel id for integration, skipping')
      continue
    }

    const dedupeKey = `${m.integrationType}:${channelId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    let accessToken: string | undefined
    if (m.secrets) {
      try {
        accessToken = decrypt(m.secrets).accessToken
      } catch (error) {
        log.error(
          { err: error, integration_type: m.integrationType },
          'failed to decrypt integration secrets'
        )
        continue
      }
    }

    // Inbound-only fields stay on the integration row; they must not ride
    // along in hook jobs (webhookSecret especially). Everything else — Jira
    // cloudId/siteUrl, Azure org name — is what the outbound hook needs.
    const {
      webhookSecret: _webhookSecret,
      statusMappings: _statusMappings,
      statusSyncEnabled: _statusSyncEnabled,
      externalWebhookId: _externalWebhookId,
      ...hookConfig
    } = integrationConfig

    targets.push({
      type: m.integrationType,
      target: { channelId },
      config: {
        ...hookConfig,
        accessToken,
        rootUrl,
        ...(m.integrationId ? { integrationId: m.integrationId } : {}),
      },
    })
  }

  return targets
}

/**
 * Facts the routing conditions can test, from the payload where it carries
 * them and from one post lookup when a mapping asks for tags or statuses.
 */
async function conditionsFor(
  event: DomainEvent,
  relevant: CachedMapping[]
): Promise<TargetConditions> {
  const p = event.payload as { post?: { id?: string; voteCount?: number }; voteCount?: number }
  const conditions: TargetConditions = {}
  const voteCount = typeof p.voteCount === 'number' ? p.voteCount : p.post?.voteCount
  if (typeof voteCount === 'number') conditions.voteCount = voteCount
  const postId = p.post?.id
  if (postId && needsPostFacts(relevant)) {
    const [row, tagRows] = await Promise.all([
      db.query.posts.findFirst({
        where: eq(posts.id, postId as PostId),
        columns: { statusId: true },
      }),
      db
        .select({ tagId: postTagAssignments.tagId })
        .from(postTagAssignments)
        .where(eq(postTagAssignments.postId, postId as PostId)),
    ])
    if (row?.statusId) conditions.statusId = row.statusId
    conditions.tagIds = tagRows.map((t) => t.tagId)
  }
  // The registry is imported lazily: it pulls in every provider module.
  const { getIntegration } = await import('@/lib/server/integrations')
  conditions.isTracker = (type) => !!getIntegration(type)?.issues
  return conditions
}

/** Private comments never reach external integrations. */
function isPrivateComment(event: DomainEvent): boolean {
  if (
    event.type !== 'comment.created' &&
    event.type !== 'comment.updated' &&
    event.type !== 'comment.deleted'
  ) {
    return false
  }
  return (event.payload as { comment?: { isPrivate?: boolean } }).comment?.isPrivate === true
}

export const integrationResolver: SinkResolver = {
  sink: 'integration',
  // Any type with at least one active mapping is interesting. The cheap
  // pre-filter can't know mappings without a query, so accept all types; the
  // mapping filter in resolve() is the real gate (mirrors the monolith, which
  // also queried unconditionally). Private-comment types short-circuit below.
  interestedIn(type: string): boolean {
    return getEventDefinition(type) !== undefined
  },
  async resolve(event: DomainEvent): Promise<HookTarget[]> {
    if (isPrivateComment(event)) return []
    const mappings = await loadMappings()
    const relevant = mappings.filter((m) => m.eventType === event.type)
    if (relevant.length === 0) return []
    const context = await buildHookContext()
    if (!context) throw new Error('Failed to build integration hook context')
    return buildIntegrationTargets(
      relevant,
      event.type,
      boardIdsFromEvent(event),
      context.portalBaseUrl,
      (blob) => decryptSecrets<{ accessToken?: string }>(blob),
      await conditionsFor(event, relevant)
    )
  },
}
