/**
 * Audience controls shared by every resource carrying the isPublic +
 * allowedSegmentIds + allowedTeamPrincipalIds trio (roadmaps,
 * changelog entries). Public switch; when off, a searchable
 * team-member picker and a segment checklist appear. Admins always
 * have access, so only member-role teammates are pickable.
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
import { Switch } from '@/components/ui/switch'
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

interface AudienceFieldsProps {
  idPrefix: string
  /** Noun used in helper copy, e.g. "roadmap" or "entry". */
  entityLabel: string
  isPublic: boolean
  onIsPublicChange: (next: boolean) => void
  segmentIds: string[]
  onSegmentIdsChange: (next: string[]) => void
  teamPrincipalIds: string[]
  onTeamPrincipalIdsChange: (next: string[]) => void
}

export function AudienceFields({
  idPrefix,
  entityLabel,
  isPublic,
  onIsPublicChange,
  segmentIds,
  onSegmentIdsChange,
  teamPrincipalIds,
  onTeamPrincipalIdsChange,
}: AudienceFieldsProps) {
  const { data: segments } = useSegments()
  const { data: teamMembers } = useQuery(adminQueries.teamMembers())
  const segmentItems = (segments ?? []).map((seg) => ({
    id: String(seg.id),
    name: seg.name,
    memberCount: seg.memberCount,
  }))
  // Admins bypass the allowlist, so only member-role teammates are pickable.
  const memberItems = (teamMembers ?? [])
    .filter((m) => m.role === 'member')
    .map((m) => ({
      id: String(m.id),
      name: m.name || m.email || 'Team member',
      email: m.email ?? undefined,
    }))

  return (
    <>
      <div className="flex items-center space-x-2">
        <Switch id={`${idPrefix}-isPublic`} checked={isPublic} onCheckedChange={onIsPublicChange} />
        <Label htmlFor={`${idPrefix}-isPublic`}>Public</Label>
      </div>
      {!isPublic && (
        <div className="space-y-2">
          <Label>Team access</Label>
          <p className="text-xs text-muted-foreground">
            {memberItems.length > 0
              ? `Admins always see this ${entityLabel}. Select team members who can also view it.`
              : `Admins always see this ${entityLabel}. Team members you invite later can be granted access here.`}
          </p>
          {memberItems.length > 0 && (
            <TeamMemberPicker
              options={memberItems}
              value={teamPrincipalIds}
              onChange={onTeamPrincipalIdsChange}
            />
          )}
        </div>
      )}
      {!isPublic && (
        <div className="space-y-2">
          <Label>Share with segments</Label>
          <p className="text-xs text-muted-foreground">
            {segmentItems.length > 0
              ? `Select segments to share this ${entityLabel} with their members on the portal.`
              : `Create segments under Settings → People to share private ${entityLabel === 'entry' ? 'entries' : `${entityLabel}s`} with specific customers.`}
          </p>
          {segmentItems.length > 0 && (
            <div className="max-h-36 overflow-y-auto pr-1">
              <SegmentMultiSelect
                segments={segmentItems}
                value={segmentIds}
                onChange={onSegmentIdsChange}
                ariaLabel={`${entityLabel} segment allowlist`}
              />
            </div>
          )}
        </div>
      )}
    </>
  )
}

interface TeamMemberOption {
  id: string
  name: string
  email?: string
}

/**
 * Searchable multi-select for granting team members access: a combobox
 * (Popover + cmdk) to find people by name or email, with the current
 * grants shown as removable chips. Stays open on select so several
 * people can be added in one pass.
 */
function TeamMemberPicker({
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
