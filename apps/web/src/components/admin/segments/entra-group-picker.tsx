'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/shared/utils'
import { searchEntraGroupsFn, getEntraGroupByIdFn } from '@/lib/server/functions/entra'

interface EntraGroupPickerProps {
  /** The stored rule value — a group Object ID. */
  value: string
  onChange: (groupId: string) => void
  className?: string
}

/**
 * Group selector that displays a name while storing an Object ID.
 *
 * Deliberately not `SearchableInput`: that component's contract is that
 * the text in the box IS the stored value, which is right for free-text
 * attributes and wrong here. A rule has to store the Object ID — it is
 * the only identifier that survives a rename — but a GUID is
 * meaningless to whoever opens the rule later. So the two are kept
 * separate: typing searches, selecting commits an ID, and the box shows
 * the resolved name whenever it isn't being edited.
 *
 * Keeping the stored value untouched while typing also removes a
 * hazard the shared component would have carried here: half-typed
 * search text can never overwrite a valid group ID.
 */
export function EntraGroupPicker({ value, onChange, className }: EntraGroupPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [debounced, setDebounced] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 250)
    return () => window.clearTimeout(t)
  }, [query])

  // Name for the currently stored id. Cached per id so reopening the
  // dialog doesn't re-hit Graph, and falls back to the raw id when the
  // group is gone, renamed away, or Graph is unreachable.
  const { data: current } = useQuery({
    queryKey: ['admin', 'entra-group', value],
    queryFn: () => getEntraGroupByIdFn({ data: { groupId: value } }),
    enabled: !!value,
    staleTime: 5 * 60 * 1000,
  })

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['admin', 'entra-group-search', debounced],
    queryFn: () => searchEntraGroupsFn({ data: { query: debounced } }),
    enabled: open,
    staleTime: 30 * 1000,
  })

  const display = editing ? query : (current?.displayName ?? value)

  return (
    <Popover open={open} onOpenChange={(next) => next && setOpen(true)}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          className={cn('h-8 text-xs', className)}
          value={display}
          placeholder="Search groups by name…"
          onFocus={() => {
            setEditing(true)
            setQuery('')
            setOpen(true)
          }}
          onChange={(e) => {
            setEditing(true)
            setQuery(e.target.value)
            setOpen(true)
          }}
          onBlur={() => {
            // Leaving without picking reverts to the stored group rather
            // than stranding the box on an abandoned search.
            setEditing(false)
            setOpen(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditing(false)
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-64">
            {results.length === 0 && (
              <CommandEmpty>{isFetching ? 'Loading…' : 'No matching groups'}</CommandEmpty>
            )}
            {results.map((group) => (
              <CommandItem
                key={group.id}
                value={group.id}
                // Keeps focus on the input so onBlur can't pre-empt the click.
                onMouseDown={(e) => e.preventDefault()}
                onSelect={() => {
                  onChange(group.id)
                  setEditing(false)
                  setOpen(false)
                  inputRef.current?.blur()
                }}
                className="text-xs"
              >
                {group.displayName}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
