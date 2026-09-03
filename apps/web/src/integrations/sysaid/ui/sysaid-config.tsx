/**
 * SysAid settings: routing (which posts become records, in which category),
 * the fields every record is created with, and optional status sync back.
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowPathIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useUpdateIntegration } from '@/lib/client/mutations'
import { fetchExternalStatusesFn } from '@/lib/server/functions/external-statuses'
import { fetchSysAidListFn } from '@/integrations/sysaid/server/functions'
import {
  StatusSyncConfig,
  type ExternalStatus,
} from '@/components/admin/settings/integrations/status-sync-config'
import { TrackerRoutingSection } from '@/components/admin/settings/integrations/shared/tracker-routing-section'
import type { NotificationChannel } from '@/components/admin/settings/integrations/shared/notification-channel-router'

interface EventMapping {
  eventType: string
  enabled: boolean
}

interface SysAidConfigProps {
  integrationId: string
  initialConfig: Record<string, unknown>
  initialEventMappings: EventMapping[]
  notificationChannels?: NotificationChannel[]
  enabled: boolean
}

interface FieldDefault {
  key: string
  value: string
}

/** SysAid record types accepted by POST /api/v1/sr?type= */
const SR_TYPES = [
  { value: '', label: 'Account default' },
  { value: 'incident', label: 'Incident' },
  { value: 'request', label: 'Request' },
  { value: 'problem', label: 'Problem' },
  { value: 'change', label: 'Change' },
]

/** Fields with a SysAid value list behind them; anything else is free text. */
const KNOWN_FIELDS: Array<{ key: string; label: string; list?: string }> = [
  { key: 'urgency', label: 'Urgency', list: 'urgency' },
  { key: 'priority', label: 'Priority', list: 'priority' },
  { key: 'impact', label: 'Impact', list: 'impact' },
  { key: 'responsibility', label: 'Assigned to (admin)', list: 'responsibility' },
  { key: 'assigned_group', label: 'Assigned group', list: 'assigned_group' },
  { key: 'status', label: 'Initial status', list: 'status' },
  { key: 'due_date', label: 'Due date' },
  { key: 'custom', label: 'Other field (enter its key)' },
]

const selectClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

function ListValueSelect({
  list,
  value,
  onChange,
  disabled,
}: {
  list: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const query = useQuery({
    queryKey: ['admin', 'sysaid', 'list', list],
    queryFn: () => fetchSysAidListFn({ data: { listName: list } }),
    staleTime: 5 * 60 * 1000,
  })
  return (
    <select
      className={selectClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || query.isLoading}
    >
      <option value="">{query.isLoading ? 'Loading…' : 'Choose…'}</option>
      {(query.data ?? []).map((v) => (
        <option key={v.id} value={v.id}>
          {v.caption}
        </option>
      ))}
      {value && !(query.data ?? []).some((v) => v.id === value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  )
}

export function SysAidConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  notificationChannels,
  enabled,
}: SysAidConfigProps) {
  const updateMutation = useUpdateIntegration()
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)
  const [srType, setSrType] = useState((initialConfig.srType as string) || '')
  const [fields, setFields] = useState<FieldDefault[]>(
    Array.isArray(initialConfig.fieldDefaults)
      ? (initialConfig.fieldDefaults as FieldDefault[])
      : []
  )
  const [externalStatuses, setExternalStatuses] = useState<ExternalStatus[]>([])

  useEffect(() => {
    if (!enabled) return
    fetchExternalStatusesFn({ data: { integrationType: 'sysaid' } })
      .then(setExternalStatuses)
      .catch(() => setExternalStatuses([]))
  }, [enabled])

  const saving = updateMutation.isPending
  const saveFields = (next: FieldDefault[], nextType = srType) => {
    setFields(next)
    updateMutation.mutate({
      id: integrationId,
      config: { fieldDefaults: next.filter((f) => f.key.trim()), srType: nextType },
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Integration enabled
          </Label>
          <p className="text-xs text-muted-foreground">Turn off to pause all SysAid features</p>
        </div>
        <Switch
          id="enabled-toggle"
          checked={integrationEnabled}
          onCheckedChange={(checked) => {
            setIntegrationEnabled(checked)
            updateMutation.mutate({ id: integrationId, enabled: checked })
          }}
          disabled={saving}
        />
      </div>

      <div className="border-t border-border/30" />

      <TrackerRoutingSection
        integrationId={integrationId}
        integrationType="sysaid"
        kind="category"
        destinationNoun="category"
        itemNoun="service record"
        initialConfig={initialConfig}
        initialEventMappings={initialEventMappings}
        notificationChannels={notificationChannels}
        enabled={integrationEnabled}
      />

      <div className="border-t border-border/30" />

      {/* Fields every record is created with */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-medium">Service record fields</Label>
          <p className="text-xs text-muted-foreground">
            Title, description and the routed category are always set. Add the fields your SysAid
            account requires — urgency, assigned group, and so on — and their values.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
          <Label className="text-xs text-muted-foreground self-center">Record type</Label>
          <select
            className={selectClass}
            value={srType}
            onChange={(e) => {
              setSrType(e.target.value)
              saveFields(fields, e.target.value)
            }}
            disabled={saving || !integrationEnabled}
          >
            {SR_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          {fields.map((f, i) => {
            const known = KNOWN_FIELDS.find((k) => k.key === f.key)
            const isCustom = !known
            return (
              <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_auto] items-center">
                <select
                  className={selectClass}
                  value={known ? f.key : 'custom'}
                  onChange={(e) => {
                    const next = [...fields]
                    next[i] = { key: e.target.value === 'custom' ? '' : e.target.value, value: '' }
                    saveFields(next)
                  }}
                  disabled={saving || !integrationEnabled}
                >
                  {KNOWN_FIELDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <div className="grid gap-2 sm:grid-cols-2">
                  {isCustom && (
                    <Input
                      className="h-8 text-xs"
                      placeholder="SysAid field key, e.g. cust_project"
                      value={f.key}
                      onChange={(e) => {
                        const next = [...fields]
                        next[i] = { ...f, key: e.target.value }
                        setFields(next)
                      }}
                      onBlur={() => saveFields(fields)}
                      disabled={saving || !integrationEnabled}
                    />
                  )}
                  {known?.list ? (
                    <ListValueSelect
                      list={known.list}
                      value={f.value}
                      onChange={(v) => {
                        const next = [...fields]
                        next[i] = { ...f, value: v }
                        saveFields(next)
                      }}
                      disabled={saving || !integrationEnabled}
                    />
                  ) : (
                    <Input
                      className="h-8 text-xs"
                      placeholder="Value"
                      value={f.value}
                      onChange={(e) => {
                        const next = [...fields]
                        next[i] = { ...f, value: e.target.value }
                        setFields(next)
                      }}
                      onBlur={() => saveFields(fields)}
                      disabled={saving || !integrationEnabled}
                    />
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove field"
                  onClick={() => saveFields(fields.filter((_, j) => j !== i))}
                  disabled={saving}
                >
                  <XMarkIcon className="h-4 w-4" />
                </Button>
              </div>
            )
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFields([...fields, { key: 'urgency', value: '' }])}
            disabled={saving || !integrationEnabled}
          >
            <PlusIcon className="h-4 w-4 mr-1" />
            Add field
          </Button>
        </div>
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

      <div className="border-t border-border/30" />

      {/* Optional: SysAid status → post status, fed by an escalation rule */}
      <StatusSyncConfig
        integrationId={integrationId}
        integrationType="sysaid"
        config={initialConfig}
        enabled={integrationEnabled}
        externalStatuses={externalStatuses}
        isManual
      />
      <p className="text-xs text-muted-foreground">
        To sync status changes back, create a SysAid escalation rule (or automation) that sends an
        HTTP POST to the URL above whenever a service record&apos;s status changes, with the record
        id and status in the body (for example <code className="font-mono">id</code> and{' '}
        <code className="font-mono">status</code>) and the secret in an{' '}
        <code className="font-mono">X-Webhook-Secret</code> header or a{' '}
        <code className="font-mono">?secret=</code> parameter.
      </p>
    </div>
  )
}
