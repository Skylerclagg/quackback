/**
 * "What does this integration do?" — opened from any card on the Integrations
 * page before anything is set up. Shows the catalog description, the derived
 * capability list and the setup guide, then hands off: to the integration's
 * settings page ("Set up this integration" / "Manage integration") or, for a
 * provider that first needs platform credentials, to the credentials form.
 * Coming-soon providers only describe themselves.
 */
import { Link } from '@tanstack/react-router'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { INTEGRATION_ICON_MAP } from '@/components/icons/integration-icons'
import {
  INTEGRATION_CATEGORIES,
  type IntegrationCatalogEntry,
} from '@/lib/shared/integration-types'
import { cn } from '@/lib/shared/utils'

export type IntegrationConnectionStatus = 'active' | 'paused' | 'error'

interface IntegrationDetailsDialogProps {
  /** The integration being described; null keeps the dialog closed. */
  entry: IntegrationCatalogEntry | null
  status?: IntegrationConnectionStatus
  onOpenChange: (open: boolean) => void
  /** Called for a provider that needs platform credentials before it can be used. */
  onSetUp: (entry: IntegrationCatalogEntry) => void
}

function StatusBadge({
  entry,
  status,
}: {
  entry: IntegrationCatalogEntry
  status?: IntegrationConnectionStatus
}) {
  if (status === 'active')
    return (
      <Badge variant="outline" className="border-green-500/30 text-green-600">
        Enabled
      </Badge>
    )
  if (status === 'paused')
    return (
      <Badge variant="outline" className="border-yellow-500/30 text-yellow-600">
        Paused
      </Badge>
    )
  if (status === 'error')
    return (
      <Badge variant="outline" className="border-destructive/30 text-destructive">
        Needs attention
      </Badge>
    )
  if (!entry.available && !entry.configurable)
    return (
      <Badge variant="outline" className="text-muted-foreground/60 border-border/40">
        Coming soon
      </Badge>
    )
  if (!entry.available && entry.configurable)
    return (
      <Badge variant="outline" className="text-muted-foreground/60 border-border/40">
        Not configured
      </Badge>
    )
  return null
}

export function IntegrationDetailsDialog({
  entry,
  status,
  onOpenChange,
  onSetUp,
}: IntegrationDetailsDialogProps) {
  const Icon = entry ? INTEGRATION_ICON_MAP[entry.id] : undefined
  const connected = !!status
  const comingSoon = !!entry && !entry.available && !entry.configurable
  const capabilities = entry?.capabilities ?? []

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      {entry && (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                  entry.iconBg,
                  comingSoon && 'opacity-60'
                )}
              >
                {Icon ? (
                  <Icon className="h-5 w-5 text-white" />
                ) : (
                  <span className="text-white font-semibold">{entry.name.charAt(0)}</span>
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {entry.name}
                  {entry.beta && (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                      Beta
                    </Badge>
                  )}
                  <StatusBadge entry={entry} status={status} />
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {INTEGRATION_CATEGORIES[entry.category]?.label ?? entry.category}
                </p>
              </div>
            </div>
            <DialogDescription className="pt-2 text-left">{entry.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">
              {comingSoon ? 'What this integration will do' : 'What this integration does'}
            </h3>
            {capabilities.length > 0 ? (
              <ul className="space-y-2.5">
                {capabilities.map((cap) => (
                  <li key={cap.label} className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                    <div>
                      <span className="text-sm font-medium text-foreground">{cap.label}</span>
                      <p className="text-xs text-muted-foreground">{cap.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{entry.description}</p>
            )}
            {entry.docsUrl && (
              <a
                href={entry.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Setup guide
                <ArrowTopRightOnSquareIcon className="h-3 w-3" />
              </a>
            )}
            {comingSoon && (
              <p className="text-xs text-muted-foreground">
                Not yet available. It will appear here as soon as it can be set up.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {entry.available ? (
              <Button asChild>
                <Link to={entry.settingsPath} onClick={() => onOpenChange(false)}>
                  {connected ? 'Manage integration' : 'Set up this integration'}
                </Link>
              </Button>
            ) : entry.configurable ? (
              <Button type="button" onClick={() => onSetUp(entry)}>
                Set up this integration
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
