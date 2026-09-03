import { useState } from 'react'
import { ArrowPathIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { saveSysAidCredentialsFn } from '@/integrations/sysaid/server/functions'
import { useDeleteIntegration } from '@/lib/client/mutations'

interface SysAidConnectionActionsProps {
  integrationId?: string
  isConnected: boolean
}

/** Connect SysAid with an API user: account URL, username, password. */
export function SysAidConnectionActions({
  integrationId,
  isConnected,
}: SysAidConnectionActionsProps) {
  const deleteMutation = useDeleteIntegration()
  const [accountUrl, setAccountUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)

  const handleSave = async () => {
    if (!accountUrl.trim() || !username.trim() || !password) return
    setSaving(true)
    setError(null)
    setShowSuccess(false)
    try {
      await saveSysAidCredentialsFn({
        data: { accountUrl: accountUrl.trim(), username: username.trim(), password },
      })
      setShowSuccess(true)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials')
    } finally {
      setSaving(false)
    }
  }

  if (isConnected) {
    const disconnecting = deleteMutation.isPending
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disconnecting}
          onClick={() => setDisconnectDialogOpen(true)}
        >
          {disconnecting ? (
            <>
              <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
              Disconnecting...
            </>
          ) : (
            'Disconnect'
          )}
        </Button>
        <ConfirmDialog
          open={disconnectDialogOpen}
          onOpenChange={setDisconnectDialogOpen}
          title="Disconnect SysAid?"
          description="Quackback will stop creating service records and syncing their status. Existing records and links stay where they are. You can reconnect at any time."
          confirmLabel="Disconnect"
          isPending={disconnecting}
          onConfirm={() => {
            if (integrationId) deleteMutation.mutate({ id: integrationId })
          }}
        />
      </div>
    )
  }

  return (
    <>
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircleIcon className="h-4 w-4" />
          <span>Connected to SysAid.</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <ExclamationCircleIcon className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="sysaid-account-url" className="text-sm">
            SysAid account URL
          </Label>
          <Input
            id="sysaid-account-url"
            type="text"
            placeholder="recf.sysaidit.com"
            value={accountUrl}
            onChange={(e) => setAccountUrl(e.target.value)}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            The address you open SysAid at. Cloud accounts look like yourcompany.sysaidit.com.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sysaid-username" className="text-sm">
              API user
            </Label>
            <Input
              id="sysaid-username"
              type="text"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sysaid-password" className="text-sm">
              Password
            </Label>
            <Input
              id="sysaid-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={saving}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Use a dedicated SysAid administrator account with REST API access; it needs to create and
          read service records. The password is stored encrypted and never shown again.
        </p>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !accountUrl.trim() || !username.trim() || !password}
        >
          {saving ? (
            <>
              <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
              Verifying...
            </>
          ) : (
            'Connect'
          )}
        </Button>
      </div>
    </>
  )
}
