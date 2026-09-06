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
        ...(requireTag !== initialRequireTag
          ? { settings: { ...(board.settings ?? {}), requireTag } }
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
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
