/**
 * External changelog sources: pages Quackback imports releases from, one entry
 * per release, into a collection. Hourly sync plus "Sync now"; "Preview" shows
 * what a URL would import before anything is written.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowPathIcon, EyeIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import {
  createChangelogSourceFn,
  deleteChangelogSourceFn,
  listChangelogSourcesFn,
  previewChangelogSourceFn,
  syncChangelogSourceNowFn,
  updateChangelogSourceFn,
} from '@/lib/server/functions/changelog-sources'

type Source = Awaited<ReturnType<typeof listChangelogSourcesFn>>[number]
type Kind = 'vitepress' | 'json'

interface CategoryOption {
  id: string
  name: string
  slug?: string | null
}

const sourcesKey = ['admin', 'changelog', 'sources'] as const
const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

const KIND_LABELS: Record<Kind, string> = {
  vitepress: 'VitePress changelog page',
  json: 'JSON release feed',
}

export function ChangelogSourcesCard({ categories }: { categories: CategoryOption[] }) {
  const queryClient = useQueryClient()
  const sources = useQuery({ queryKey: sourcesKey, queryFn: () => listChangelogSourcesFn() })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Source | null>(null)
  const [deleting, setDeleting] = useState<Source | null>(null)
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: sourcesKey })
    void queryClient.invalidateQueries({ queryKey: ['admin', 'changelog'] })
  }

  const sync = useMutation({
    mutationFn: (id: string) => syncChangelogSourceNowFn({ data: { id } }),
    onSuccess: (summary) => {
      toast.success(
        `Imported ${summary.fetched} release${summary.fetched === 1 ? '' : 's'}: ${summary.created} new, ${summary.updated} updated, ${summary.unchanged} unchanged.`
      )
      invalidate()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Sync failed')
      invalidate()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteChangelogSourceFn({ data: { id } }),
    onSuccess: () => {
      toast.success('Source removed. Imported entries stay.')
      setDeleting(null)
      invalidate()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not remove'),
  })
  const toggle = useMutation({
    mutationFn: (s: Source) => updateChangelogSourceFn({ data: { id: s.id, enabled: !s.enabled } }),
    onSuccess: invalidate,
  })

  const rows = sources.data ?? []

  return (
    <SettingsCard
      title="External changelogs"
      description="Import releases from another site's changelog into a collection here. Each release becomes one entry, updated when its notes change, never duplicated. Synced hourly."
      contentClassName="p-4"
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <PlusIcon className="h-4 w-4 mr-1" />
          Add source
        </Button>
      }
    >
      {sources.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sources yet. Add the changelog page of a product site to mirror its releases here.
        </p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg border border-border/50">
          {rows.map((s) => {
            const collection = categories.find((c) => c.id === s.categoryId)
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{s.name}</span>
                    <Badge variant="outline" className="text-[11px]">
                      {KIND_LABELS[s.kind as Kind] ?? s.kind}
                    </Badge>
                    {collection && (
                      <Badge variant="secondary" className="text-[11px]">
                        {collection.name}
                      </Badge>
                    )}
                    {!s.enabled && (
                      <Badge variant="outline" className="text-[11px] text-muted-foreground">
                        Paused
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{s.url}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.lastError ? (
                      <span className="text-destructive">Last run failed: {s.lastError}</span>
                    ) : s.lastRunAt ? (
                      `Last synced ${new Date(s.lastRunAt).toLocaleString()}`
                    ) : (
                      'Not synced yet'
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={() => toggle.mutate(s)}
                    aria-label={s.enabled ? 'Pause source' : 'Resume source'}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sync.mutate(s.id)}
                    disabled={sync.isPending}
                  >
                    {sync.isPending && sync.variables === s.id ? (
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    ) : (
                      'Sync now'
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(s)
                      setDialogOpen(true)
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove source"
                    onClick={() => setDeleting(s)}
                  >
                    <TrashIcon className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <SourceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        source={editing}
        categories={categories}
        onSaved={invalidate}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove ${deleting?.name ?? 'this source'}?`}
        description="Quackback stops importing from it. Entries already imported stay in the changelog."
        confirmLabel="Remove"
        variant="destructive"
        isPending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
        }}
      />
    </SettingsCard>
  )
}

function SourceDialog({
  open,
  onOpenChange,
  source,
  categories,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: Source | null
  categories: CategoryOption[]
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<Kind>('vitepress')
  const [categoryId, setCategoryId] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'team' | 'segment'>('public')
  const [publishAs, setPublishAs] = useState<'published' | 'draft'>('published')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewChangelogSourceFn>
  > | null>(null)

  useEffect(() => {
    if (!open) return
    setName(source?.name ?? '')
    setUrl(source?.url ?? '')
    setKind((source?.kind as Kind) ?? 'vitepress')
    setCategoryId(source?.categoryId ?? '')
    setVisibility((source?.visibility as 'public' | 'team' | 'segment') ?? 'public')
    setPublishAs((source?.publishAs as 'published' | 'draft') ?? 'published')
    setError(null)
    setPreview(null)
  }, [open, source])

  const previewMutation = useMutation({
    mutationFn: () => previewChangelogSourceFn({ data: { url: url.trim(), kind } }),
    onSuccess: (releases) => {
      setPreview(releases)
      setError(releases.length === 0 ? 'No releases found on that page.' : null)
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not read that page'),
  })
  const save = useMutation({
    mutationFn: () => {
      const data = {
        name: name.trim(),
        url: url.trim(),
        kind,
        categoryId: categoryId || null,
        visibility,
        publishAs,
      }
      return source
        ? updateChangelogSourceFn({ data: { id: source.id, ...data } })
        : createChangelogSourceFn({ data })
    },
    onSuccess: () => {
      toast.success(
        source
          ? 'Source updated'
          : 'Source added. First sync runs within the hour, or use Sync now.'
      )
      onSaved()
      onOpenChange(false)
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save'),
  })

  const canSave = name.trim().length > 0 && /^https?:\/\//.test(url.trim()) && !save.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{source ? 'Edit source' : 'Add an external changelog'}</DialogTitle>
          <DialogDescription>
            Point at a changelog page. VitePress pages are read as rendered; a JSON feed is an array
            of releases with version, date and html or markdown.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="source-name">Name</Label>
            <Input
              id="source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Competition Control"
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-url">URL</Label>
            <Input
              id="source-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://c2.recf.org/changelog.html"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="source-kind">Format</Label>
              <select
                id="source-kind"
                className={selectClass}
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                <option value="vitepress">{KIND_LABELS.vitepress}</option>
                <option value="json">{KIND_LABELS.json}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-collection">Collection</Label>
              <select
                id="source-collection"
                className={selectClass}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">None (general changelog)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.slug ? '' : ' (label only)'}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-visibility">Visibility of imported entries</Label>
              <select
                id="source-visibility"
                className={selectClass}
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'team' | 'segment')}
              >
                <option value="public">Public</option>
                <option value="team">Team only</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-publish">New entries land as</Label>
              <select
                id="source-publish"
                className={selectClass}
                value={publishAs}
                onChange={(e) => setPublishAs(e.target.value as 'published' | 'draft')}
              >
                <option value="published">Published</option>
                <option value="draft">Drafts to review</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!/^https?:\/\//.test(url.trim()) || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <EyeIcon className="h-4 w-4 mr-1" />
              )}
              Preview
            </Button>
            <span className="text-xs text-muted-foreground">
              Reads the page now, imports nothing.
            </span>
          </div>
          {preview && preview.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-xs space-y-1.5 max-h-48 overflow-y-auto">
              <p className="font-medium text-foreground">
                {preview.length} release{preview.length === 1 ? '' : 's'} found
              </p>
              {preview.map((r) => (
                <div key={r.key}>
                  <span className="font-medium text-foreground">{r.title}</span>
                  {r.date && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {new Date(r.date).toLocaleDateString()}
                    </span>
                  )}
                  <p className="text-muted-foreground truncate">{r.excerpt}</p>
                </div>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : source ? 'Save changes' : 'Add source'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
