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
import { fetchAsanaProjectsFn, type AsanaProject } from '@/integrations/asana/server/functions'

interface EventMapping {
  id: string
  eventType: string
  enabled: boolean
}

interface AsanaConfigProps {
  integrationId: string
  initialConfig: Record<string, unknown>
  initialEventMappings: EventMapping[]
  notificationChannels?: NotificationChannel[]
  enabled: boolean
}

export function AsanaConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  enabled,
  notificationChannels,
}: AsanaConfigProps) {
  const updateMutation = useUpdateIntegration()
  const [projects, setProjects] = useState<AsanaProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState((initialConfig.channelId as string) || '')
  const [externalStatuses, setExternalStatuses] = useState<ExternalStatus[]>([])
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)

  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true)
    setProjectError(null)
    try {
      const result = await fetchAsanaProjectsFn()
      setProjects(result)
    } catch {
      setProjectError('Failed to load projects. Please try again.')
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects()
    fetchExternalStatusesFn({ data: { integrationType: 'asana' } })
      .then(setExternalStatuses)
      .catch(() => {})
  }, [fetchProjects])

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const handleProjectChange = (projectId: string) => {
    setSelectedProject(projectId)
    updateMutation.mutate({ id: integrationId, config: { channelId: projectId } })
  }

  const saving = updateMutation.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Integration enabled
          </Label>
          <p className="text-xs text-muted-foreground">Turn off to pause all Asana task syncing</p>
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
          <Label htmlFor="project-select">Project</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchProjects}
            disabled={loadingProjects}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingProjects ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        {projectError ? (
          <p className="text-sm text-destructive">{projectError}</p>
        ) : (
          <Select
            value={selectedProject}
            onValueChange={handleProjectChange}
            disabled={loadingProjects || saving || !integrationEnabled}
          >
            <SelectTrigger id="project-select" className="w-full">
              {loadingProjects ? (
                <div className="flex items-center gap-2">
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  <span>Loading projects...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select a project" />
              )}
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  <div className="flex items-center gap-2">
                    <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{project.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          New feedback tasks will be created in this project.
        </p>
      </div>

      <TrackerRoutingSection
        integrationId={integrationId}
        integrationType="asana"
        kind="project"
        destinationNoun="project"
        itemNoun="task"
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
        integrationType="asana"
        config={initialConfig}
        enabled={integrationEnabled}
        externalStatuses={externalStatuses}
      />

      <TicketStatusSyncConfig
        integrationId={integrationId}
        config={initialConfig}
        enabled={integrationEnabled}
        externalStatuses={externalStatuses}
      />

      <OnDeleteConfig
        integrationId={integrationId}
        integrationType="asana"
        config={initialConfig}
        enabled={integrationEnabled}
      />
    </div>
  )
}
