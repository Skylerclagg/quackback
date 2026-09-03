'use client'

import { useState, useEffect, useCallback } from 'react'
import { TrackerRoutingSection } from '@/components/admin/settings/integrations/shared/tracker-routing-section'
import type { NotificationChannel } from '@/components/admin/settings/integrations/shared/notification-channel-router'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowPathIcon,
  FolderIcon,
  ChevronRightIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MENU_LABEL } from '@/components/ui/menu'
import { useUpdateIntegration } from '@/lib/client/mutations'
import {
  fetchGitHubReposFn,
  getGitHubChannelStatusFn,
  type GitHubRepo,
} from '@/integrations/github/server/functions'
import { StatusSyncConfig } from '@/components/admin/settings/integrations/status-sync-config'
import { TicketStatusSyncConfig } from '@/components/admin/settings/integrations/ticket-status-sync-config'
import { OnDeleteConfig } from '@/components/admin/settings/integrations/on-delete-config'
import { IntegrationHealthPanel } from '@/components/admin/settings/integrations/integration-health-panel'
import type { IntegrationHealth } from '@/components/admin/settings/integrations/integration-health-panel'

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
}

interface GitHubConfigProps {
  integrationId: string
  initialConfig: Record<string, unknown>
  initialEventMappings: EventMapping[]
  notificationChannels?: NotificationChannel[]
  enabled: boolean
  health?: IntegrationHealth
}

const GITHUB_STATUSES = [
  { id: 'Open', name: 'Open' },
  { id: 'Closed', name: 'Closed' },
]

export function GitHubConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  enabled,
  health,
  notificationChannels,
}: GitHubConfigProps) {
  const updateMutation = useUpdateIntegration()
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [selectedRepo, setSelectedRepo] = useState((initialConfig.channelId as string) || '')
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)
  const inboxQuery = useQuery({
    queryKey: ['settings', 'github-channel-status'],
    queryFn: () => getGitHubChannelStatusFn(),
    staleTime: 60_000,
  })

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true)
    setRepoError(null)
    try {
      const result = await fetchGitHubReposFn()
      setRepos(result)
    } catch {
      setRepoError('Failed to load repositories. Please try again.')
    } finally {
      setLoadingRepos(false)
    }
  }, [])

  useEffect(() => {
    fetchRepos()
  }, [fetchRepos])

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const handleRepoChange = (ownerRepo: string) => {
    setSelectedRepo(ownerRepo)
    updateMutation.mutate({ id: integrationId, config: { channelId: ownerRepo } })
  }

  const saving = updateMutation.isPending
  const inbox = inboxQuery.data
  const inboxAttention = !!inbox?.connected && (!!inbox.lastError || inbox.status !== 'active')
  const inboxBadge = !inbox?.connected
    ? { label: 'Set up', variant: 'secondary' as const }
    : inboxAttention
      ? { label: 'Attention', variant: 'destructive' as const }
      : inbox.inboxEnabled
        ? { label: 'On', variant: 'default' as const }
        : { label: 'Off', variant: 'secondary' as const }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border/50 px-6 py-4">
          <h2 className="text-base font-semibold">Connection</h2>
        </div>
        <div className="space-y-6 p-6">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="enabled-toggle" className="text-base font-medium">
                Integration enabled
              </Label>
              <p className="text-xs text-muted-foreground">
                Turn off to pause all GitHub issue syncing
              </p>
            </div>
            <Switch
              id="enabled-toggle"
              checked={integrationEnabled}
              onCheckedChange={handleEnabledChange}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="repo-select">Repository</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchRepos}
                disabled={loadingRepos}
                className="h-8 gap-1.5 text-xs"
              >
                <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingRepos ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            {repoError ? (
              <p className="text-sm text-destructive">{repoError}</p>
            ) : (
              <Select
                value={selectedRepo}
                onValueChange={handleRepoChange}
                disabled={loadingRepos || saving || !integrationEnabled}
              >
                <SelectTrigger id="repo-select" className="w-full">
                  {loadingRepos ? (
                    <div className="flex items-center gap-2">
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      <span>Loading repositories...</span>
                    </div>
                  ) : (
                    <SelectValue placeholder="Select a repository" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {repos.map((repo) => (
                    <SelectItem key={repo.id} value={repo.fullName}>
                      <div className="flex items-center gap-2">
                        <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{repo.fullName}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              New feedback issues will be created in this repository.
            </p>
          </div>

          {saving && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              <span>Saving...</span>
            </div>
          )}

          {updateMutation.isError && (
            <div className="text-sm text-destructive">
              {updateMutation.error?.message || 'Failed to save changes'}
            </div>
          )}
        </div>
      </section>

      <IntegrationHealthPanel health={health} />

      <div className="space-y-2">
        <span className={MENU_LABEL}>Feedback</span>
        <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <div className="px-4 py-4">
            <TrackerRoutingSection
              integrationId={integrationId}
              integrationType="github"
              kind="repo"
              destinationNoun="repository"
              itemNoun="issue"
              initialConfig={initialConfig as Record<string, unknown>}
              initialEventMappings={initialEventMappings}
              notificationChannels={notificationChannels}
              enabled={integrationEnabled}
            />
          </div>
          <div className="border-t border-border px-4 py-4">
            <StatusSyncConfig
              integrationId={integrationId}
              integrationType="github"
              config={initialConfig}
              enabled={integrationEnabled}
              externalStatuses={GITHUB_STATUSES}
            />
            <OnDeleteConfig
              integrationId={integrationId}
              integrationType="github"
              config={initialConfig}
              enabled={integrationEnabled}
            />
          </div>
        </section>
      </div>

      <div className="space-y-2">
        <span className={MENU_LABEL}>Support</span>
        <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
          <Link
            to="/admin/settings/channels/github"
            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
          >
            <div className="flex items-center gap-3 min-w-0">
              <ChatBubbleLeftRightIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Inbox channel</p>
                <p className="text-xs text-muted-foreground">
                  Issues and comments as conversations. Managed in Channels.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge size="sm" shape="pill" variant={inboxBadge.variant}>
                {inboxBadge.label}
              </Badge>
              <ChevronRightIcon className="size-3.5 text-muted-foreground" />
            </div>
          </Link>
          <div className="border-t border-border px-4 py-4">
            <p className="mb-3 text-sm font-medium">Sync ticket statuses</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Update linked issues when ticket status changes.
            </p>
            <TicketStatusSyncConfig
              integrationId={integrationId}
              config={initialConfig}
              enabled={integrationEnabled}
              externalStatuses={GITHUB_STATUSES}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
