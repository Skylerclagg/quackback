import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { updateBoardSchema, type UpdateBoardInput } from '@/lib/shared/schemas/boards'
import { Input } from '@/components/ui/input'
import { FormError } from '@/components/shared/form-error'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { useNavigate } from '@tanstack/react-router'
import { useUpdateBoard } from '@/lib/client/mutations'
import type { BoardId } from '@quackback/ids'
import type { BoardSettings } from '@/lib/shared/db-types'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

interface Board {
  id: BoardId
  name: string
  slug: string
  description: string | null
  settings?: BoardSettings
}

interface BoardGeneralFormProps {
  board: Board
}

export function BoardGeneralForm({ board }: BoardGeneralFormProps) {
  const mutation = useUpdateBoard()
  const navigate = useNavigate()
  // Not part of the react-hook-form schema: a plain switch whose value is
  // merged into the FULL settings object on save (the update replaces settings
  // wholesale, so sending only this key would drop roadmap statuses and fields).
  const initialRequireTag = board.settings?.requireTag ?? false
  const [requireTag, setRequireTag] = useState(initialRequireTag)
  // Auto-close: same merge-into-settings treatment. The target defaults to the
  // first Closed-category status so turning the switch on is enough.
  const { data: statuses } = useQuery(adminQueries.statuses())
  const closedStatuses = (statuses ?? []).filter((s) => s.category === 'closed')
  const initialAutoClose = board.settings?.autoClose ?? null
  const [autoCloseEnabled, setAutoCloseEnabled] = useState(!!initialAutoClose)
  const [autoCloseDays, setAutoCloseDays] = useState(initialAutoClose?.afterDays ?? 30)
  const [autoCloseStatusId, setAutoCloseStatusId] = useState<string>(
    initialAutoClose?.toStatusId ?? ''
  )
  const effectiveAutoCloseStatusId = autoCloseStatusId || closedStatuses[0]?.id || ''
  const nextAutoClose =
    autoCloseEnabled && effectiveAutoCloseStatusId
      ? { afterDays: autoCloseDays, toStatusId: effectiveAutoCloseStatusId }
      : null
  const settingsChanged =
    requireTag !== initialRequireTag ||
    JSON.stringify(nextAutoClose) !== JSON.stringify(initialAutoClose)

  const form = useForm<UpdateBoardInput>({
    resolver: standardSchemaResolver(updateBoardSchema),
    defaultValues: {
      name: board.name,
      description: board.description || '',
    },
  })

  function onSubmit(data: UpdateBoardInput) {
    mutation.mutate(
      {
        id: board.id,
        name: data.name,
        description: data.description,
        ...(settingsChanged
          ? {
              settings: {
                ...(board.settings ?? {}),
                requireTag,
                autoClose: nextAutoClose as BoardSettings['autoClose'],
              },
            }
          : {}),
      },
      {
        onSuccess: (updated) => {
          if (updated.slug !== board.slug) {
            void navigate({
              to: '/admin/settings/boards/$slug',
              params: { slug: updated.slug },
              search: {},
              replace: true,
            })
          }
        },
      }
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {mutation.isError && <FormError message={mutation.error?.message ?? 'An error occurred'} />}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Board name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border/50 p-3">
          <div className="space-y-0.5">
            <Label htmlFor="board-require-tag">Require a tag on new posts</Label>
            <p className="text-xs text-muted-foreground">
              People submitting on the portal must pick at least one tag (team-only tags are never
              offered). Widget and team submissions are exempt, and nothing is required while no
              portal-visible tag exists.
            </p>
          </div>
          <Switch
            id="board-require-tag"
            checked={requireTag}
            onCheckedChange={setRequireTag}
            disabled={mutation.isPending}
          />
        </div>
        <div className="space-y-3 rounded-lg border border-border/50 p-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="board-auto-close">Auto-close completed posts</Label>
              <p className="text-xs text-muted-foreground">
                Posts that have sat in a Complete status for the number of days below move to the
                status you pick, checked hourly. It counts as a normal status change: the timeline
                records it and subscribers are notified.
              </p>
            </div>
            <Switch
              id="board-auto-close"
              checked={autoCloseEnabled}
              onCheckedChange={setAutoCloseEnabled}
              disabled={mutation.isPending || closedStatuses.length === 0}
            />
          </div>
          {closedStatuses.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Create a status in the Closed category first (Settings → Statuses).
            </p>
          ) : (
            autoCloseEnabled && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="board-auto-close-days">After</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="board-auto-close-days"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={365}
                      value={autoCloseDays}
                      onChange={(e) =>
                        setAutoCloseDays(Math.min(365, Math.max(1, Number(e.target.value) || 1)))
                      }
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">days in a Complete status</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="board-auto-close-status">Move to</Label>
                  <select
                    id="board-auto-close-status"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={effectiveAutoCloseStatusId}
                    onChange={(e) => setAutoCloseStatusId(e.target.value)}
                  >
                    {closedStatuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )
          )}
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
