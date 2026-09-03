'use client'

import { useState, useEffect, useCallback } from 'react'
import { TrackerRoutingSection } from '@/components/admin/settings/integrations/shared/tracker-routing-section'
import type { NotificationChannel } from '@/components/admin/settings/integrations/shared/notification-channel-router'
import { ArrowPathIcon, FolderIcon } from '@heroicons/react/24/solid'
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
import { useUpdateIntegration } from '@/lib/client/mutations'
import { fetchExternalStatusesFn } from '@/lib/server/functions/external-statuses'
import {
  StatusSyncConfig,
  type ExternalStatus,
} from '@/components/admin/settings/integrations/status-sync-config'
import { TicketStatusSyncConfig } from '@/components/admin/settings/integrations/ticket-status-sync-config'
import { OnDeleteConfig } from '@/components/admin/settings/integrations/on-delete-config'
import {
  fetchShortcutProjectsFn,
  type ShortcutProject,
} from '@/integrations/shortcut/server/functions'

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
}

interface ShortcutConfigProps {
  integrationId: string
  initialConfig: Record<string, unknown>
  initialEventMappings: EventMapping[]
  notificationChannels?: NotificationChannel[]
  enabled: boolean
}

export function ShortcutConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  enabled,
  notificationChannels,
}: ShortcutConfigProps) {
  const updateMutation = useUpdateIntegration()
  const [teams, setTeams] = useState<ShortcutProject[]>([])
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [teamError, setTeamError] = useState<string | null>(null)
  const [selectedTeam, setSelectedTeam] = useState((initialConfig.channelId as string) || '')
  const [externalStatuses, setExternalStatuses] = useState<ExternalStatus[]>([])
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)

  const fetchTeams = useCallback(async () => {
    setLoadingTeams(true)
    setTeamError(null)
    try {
      const result = await fetchShortcutProjectsFn()
      setTeams(result)
    } catch {
      setTeamError('Failed to load teams. Please try again.')
    } finally {
      setLoadingTeams(false)
    }
  }, [])

  useEffect(() => {
    fetchTeams()
    fetchExternalStatusesFn({ data: { integrationType: 'shortcut' } })
      .then(setExternalStatuses)
      .catch(() => {})
  }, [fetchTeams])

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const handleTeamChange = (teamId: string) => {
    setSelectedTeam(teamId)
    updateMutation.mutate({ id: integrationId, config: { channelId: teamId } })
  }

  const saving = updateMutation.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Integration enabled
          </Label>
          <p className="text-xs text-muted-foreground">
            Turn off to pause all Shortcut story syncing
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
          <Label htmlFor="team-select">Team</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchTeams}
            disabled={loadingTeams}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingTeams ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        {teamError ? (
          <p className="text-sm text-destructive">{teamError}</p>
        ) : (
          <Select
            value={selectedTeam}
            onValueChange={handleTeamChange}
            disabled={loadingTeams || saving || !integrationEnabled}
          >
            <SelectTrigger id="team-select" className="w-full">
              {loadingTeams ? (
                <div className="flex items-center gap-2">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  <span>Loading teams...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select a team" />
              )}
            </SelectTrigger>
            <SelectContent>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  <div className="flex items-center gap-2">
                    <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{team.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          New feedback stories will be created in this team.
        </p>
      </div>

      <TrackerRoutingSection
        integrationId={integrationId}
        integrationType="shortcut"
        kind="project"
        destinationNoun="project"
        itemNoun="story"
        initialConfig={initialConfig as Record<string, unknown>}
        initialEventMappings={initialEventMappings}
        notificationChannels={notificationChannels}
        enabled={integrationEnabled}
      />

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

      <StatusSyncConfig
        integrationId={integrationId}
        integrationType="shortcut"
        config={initialConfig}
        enabled={integrationEnabled}
        externalStatuses={externalStatuses}
        isManual={true}
      />

      <TicketStatusSyncConfig
        integrationId={integrationId}
        config={initialConfig}
        enabled={integrationEnabled}
        externalStatuses={externalStatuses}
      />

      <OnDeleteConfig
        integrationId={integrationId}
        integrationType="shortcut"
        config={initialConfig}
        enabled={integrationEnabled}
      />
    </div>
  )
}
