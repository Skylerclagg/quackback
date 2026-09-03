/**
 * Routing for trackers (GitHub, Asana, Linear, …): which posts create an item
 * in which destination. Reuses the notification router — one row per
 * destination (repository, project, team, board, database) with the routed
 * events and conditions (boards, tags, vote threshold, status) — so a tracker
 * is configured the same way as Slack or Discord.
 *
 * Replaces the per-provider "Events" switches, which could only say "create on
 * every new post" for a single destination.
 */
import { useQuery } from '@tanstack/react-query'
import { Squares2X2Icon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { adminQueries } from '@/lib/client/queries/admin'
import { fetchIntegrationDestinationsFn } from '@/lib/server/functions/integration-destinations'
import type { EventType } from '@/lib/server/events/types'
import {
  NotificationChannelRouter,
  type NotificationChannel,
  type EventConfig,
} from './notification-channel-router'

/** The creation triggers every tracker hook understands (see creation-event.ts). */
export const TRACKER_EVENT_CONFIG: EventConfig[] = [
  {
    id: 'post.created' as EventType,
    label: 'New post submitted',
    shortLabel: 'New post',
    description: 'Create an item as soon as someone submits a post',
  },
  {
    id: 'post.voted' as EventType,
    label: 'Post reaches a vote threshold',
    shortLabel: 'Votes',
    description: 'Create an item once a post has enough votes. Set the minimum on the row.',
  },
  {
    id: 'post.status_changed' as EventType,
    label: 'Post status changed',
    shortLabel: 'Status',
    description: 'Create an item when a post moves to a status. Pick which statuses on the row.',
  },
  {
    id: 'post.updated' as EventType,
    label: 'Post edited',
    shortLabel: 'Edited',
    description: 'Create an item when a post is edited (if it has none yet)',
  },
]

const LEGACY_ID_KEYS = ['channelId', 'boardId', 'databaseId', 'projectId', 'teamId', 'repoId']

interface TrackerRoutingSectionProps {
  integrationId: string
  /** Registry id, e.g. `github`. */
  integrationType: string
  /** Destination kind declared by the provider, e.g. `repo`, `project`. */
  kind: string
  /** Human noun for the destination, e.g. "repository". */
  destinationNoun: string
  /** Human noun for the created item, e.g. "issue". */
  itemNoun: string
  initialConfig: Record<string, unknown>
  initialEventMappings: { eventType: string; enabled: boolean }[]
  notificationChannels?: NotificationChannel[]
  enabled: boolean
}

export function TrackerRoutingSection({
  integrationId,
  integrationType,
  kind,
  destinationNoun,
  itemNoun,
  initialConfig,
  initialEventMappings,
  notificationChannels: initialChannels,
  enabled,
}: TrackerRoutingSectionProps) {
  const destinations = useQuery({
    queryKey: ['admin', 'integration-destinations', integrationType, kind],
    queryFn: () => fetchIntegrationDestinationsFn({ data: { integrationType, kind } }),
    staleTime: 60_000,
  })
  const boardsQuery = useQuery(adminQueries.boards())
  const boards = (boardsQuery.data ?? []).map((b) => ({ id: b.id, name: b.name }))

  // A tracker configured before routing rows existed has one destination in
  // its config and its events on `default` rows; show that as the first row.
  const legacyId = LEGACY_ID_KEYS.map((k) => initialConfig[k]).find(
    (v): v is string => typeof v === 'string' && v.length > 0
  )
  const channels: NotificationChannel[] = initialChannels?.length
    ? initialChannels
    : legacyId
      ? [
          {
            channelId: legacyId,
            events: TRACKER_EVENT_CONFIG.map((e) => ({
              eventType: e.id,
              enabled: initialEventMappings.find((m) => m.eventType === e.id)?.enabled ?? false,
            })),
            boardIds: null,
          },
        ]
      : []

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-base font-medium">Routing</Label>
        <p className="text-xs text-muted-foreground">
          Choose which posts create {itemNoun}s in each {destinationNoun}. Expand a row to limit it
          to boards, tags, a vote threshold or particular statuses; add another {destinationNoun} to
          route different posts elsewhere.
        </p>
      </div>
      <NotificationChannelRouter
        integrationId={integrationId}
        enabled={enabled}
        events={TRACKER_EVENT_CONFIG}
        channels={(destinations.data ?? []).map((d) => ({ id: String(d.id), name: d.name }))}
        notificationChannels={channels}
        boards={boards}
        loadingChannels={destinations.isLoading}
        channelError={destinations.error ? `Could not load ${destinationNoun} list` : null}
        onRefreshChannels={() => void destinations.refetch()}
        renderChannelIcon={() => <Squares2X2Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      />
    </div>
  )
}
