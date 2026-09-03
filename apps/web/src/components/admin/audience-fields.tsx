/**
 * Audience controls shared by every resource carrying the visibility +
 * visibleSegmentIds + allowedTeamPrincipalIds trio (roadmaps, changelog
 * entries, changelog categories). A three-way visibility select — Public,
 * Team only, Customer segments — then, for the two private tiers, the team
 * access field; for the segment tier, a segment checklist.
 *
 * The team allowlist is tri-state and null is the meaningful default: null
 * means every team actor, [] means admins only, [ids] means admins plus those
 * people. `TeamAccessField` maps "Everyone on the team" to null and "Only
 * these people" to a list, so an author cannot reach the admins-only state by
 * accident — clearing the list is a deliberate second step.
 *
 * Admins always have access, so only member-role teammates are pickable.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckIcon, ChevronUpDownIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { adminQueries } from '@/lib/client/queries/admin'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/shared/utils'
import type { AudienceVisibility } from '@/lib/server/policy/audience'

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

interface AudienceFieldsProps {
  idPrefix: string
  /** Noun used in helper copy, e.g. "roadmap" or "entry". */
  entityLabel: string
  visibility: AudienceVisibility
  onVisibilityChange: (next: AudienceVisibility) => void
  visibleSegmentIds: string[]
  onVisibleSegmentIdsChange: (next: string[]) => void
  /** null = every team actor. See the file header. */
  allowedTeamPrincipalIds: string[] | null
  onAllowedTeamPrincipalIdsChange: (next: string[] | null) => void
}

export function AudienceFields({
  idPrefix,
  entityLabel,
  visibility,
  onVisibilityChange,
  visibleSegmentIds,
  onVisibleSegmentIdsChange,
  allowedTeamPrincipalIds,
  onAllowedTeamPrincipalIdsChange,
}: AudienceFieldsProps) {
  const { data: segments } = useSegments()
  const segmentItems = (segments ?? []).map((seg) => ({
    id: String(seg.id),
    name: seg.name,
    memberCount: seg.memberCount,
  }))

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-visibility`}>Visibility</Label>
        <select
          id={`${idPrefix}-visibility`}
          className={selectClass}
          value={visibility}
          onChange={(event) => onVisibilityChange(event.target.value as AudienceVisibility)}
        >
          <option value="public">Public</option>
          <option value="team">Team only</option>
          <option value="segment">Customer segments</option>
        </select>
      </div>

      {visibility === 'segment' && (
        <div className="space-y-2">
          <Label>Share with segments</Label>
          <p className="text-xs text-muted-foreground">
            {segmentItems.length > 0
              ? `Portal users in any of these segments can see this ${entityLabel}.`
              : `Create segments under Settings → People to share private ${
                  entityLabel === 'entry' ? 'entries' : `${entityLabel}s`
                } with specific customers.`}
          </p>
          {segmentItems.length > 0 && (
            <div className="max-h-36 overflow-y-auto pr-1">
              <SegmentMultiSelect
                segments={segmentItems}
                value={visibleSegmentIds}
                onChange={onVisibleSegmentIdsChange}
                ariaLabel={`${entityLabel} segment allowlist`}
              />
            </div>
          )}
          {!visibleSegmentIds.length && (
            <p className="text-xs text-destructive">Select at least one segment.</p>
          )}
        </div>
      )}

      {visibility !== 'public' && (
        <TeamAccessField
          idPrefix={idPrefix}
          entityLabel={entityLabel}
          value={allowedTeamPrincipalIds}
          onChange={onAllowedTeamPrincipalIdsChange}
        />
      )}
    </>
  )
}

/**
 * The tri-state team allowlist as a two-step control: a scope select
 * (everyone on the team / only these people), then a member picker. Standalone
 * so surfaces that already have their own visibility control (the roadmap
 * builder, the category dialog) can reuse just this part.
 */
export function TeamAccessField({
  idPrefix,
  entityLabel,
  value,
  onChange,
}: {
  idPrefix: string
  entityLabel: string
  /** null = every team actor; [] = admins only; [ids] = admins plus those. */
  value: string[] | null
  onChange: (next: string[] | null) => void
}) {
  const { data: teamMembers } = useQuery(adminQueries.teamMembers())
  // Admins bypass the allowlist, so only member-role teammates are pickable.
  const memberItems = (teamMembers ?? [])
    .filter((m) => m.role === 'member')
    .map((m) => ({
      id: String(m.id),
      name: m.name || m.email || 'Team member',
      email: m.email ?? undefined,
    }))
  const restricted = value !== null

  return (
    <div className="space-y-2">
      <Label htmlFor={`${idPrefix}-team-scope`}>Team access</Label>
      <select
        id={`${idPrefix}-team-scope`}
        className={selectClass}
        value={restricted ? 'subset' : 'all'}
        onChange={(event) => onChange(event.target.value === 'subset' ? [] : null)}
      >
        <option value="all">Everyone on the team</option>
        <option value="subset">Only these people</option>
      </select>
      {restricted && (
        <>
          <p className="text-xs text-muted-foreground">
            {memberItems.length > 0
              ? `Admins always see this ${entityLabel}. Pick the team members who can also view it — with nobody picked, only admins can.`
              : `Admins always see this ${entityLabel}. Team members you invite later can be granted access here.`}
          </p>
          {memberItems.length > 0 && (
            <TeamMemberPicker options={memberItems} value={value ?? []} onChange={onChange} />
          )}
        </>
      )}
    </div>
  )
}

interface TeamMemberOption {
  id: string
  name: string
  email?: string
}

/**
 * Searchable multi-select for granting team members access: a combobox
 * (Popover + cmdk) to find people by name or email, with the current grants
 * shown as removable chips. Stays open on select so several people can be
 * added in one pass.
 */
export function TeamMemberPicker({
  options,
  value,
  onChange,
}: {
  options: TeamMemberOption[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = new Set(value)
  const selectedOptions = options.filter((o) => selected.has(o.id))

  const toggle = (id: string) => {
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label="Add team members"
            className="w-full justify-between font-normal text-muted-foreground"
          >
            Search team members…
            <ChevronUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
          {/* Remount Command on each open so the search input is empty. */}
          {open && (
            <Command>
              <CommandInput placeholder="Search by name or email…" />
              <CommandList>
                <CommandEmpty>No team members found.</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option.id}
                      value={`${option.name} ${option.email ?? ''}`}
                      onSelect={() => toggle(option.id)}
                    >
                      <CheckIcon
                        className={cn(
                          'mr-2 h-4 w-4',
                          selected.has(option.id) ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="truncate">{option.name}</span>
                        {option.email && (
                          <span className="text-xs text-muted-foreground truncate">
                            {option.email}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((o) => (
            <Badge key={o.id} variant="secondary" className="gap-1 pr-1">
              {o.name}
              <button
                type="button"
                aria-label={`Remove ${o.name}`}
                className="rounded-sm hover:bg-muted-foreground/20 p-0.5"
                onClick={() => toggle(o.id)}
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
