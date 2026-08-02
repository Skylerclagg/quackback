import { useQuery } from '@tanstack/react-query'
import { LockClosedIcon } from '@heroicons/react/24/outline'
import { FilterSection } from '@/components/shared/filter-section'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { cn } from '@/lib/shared/utils'
import type { ChangelogStatusFilter } from './use-changelog-filters'

interface ChangelogFiltersProps {
  status: ChangelogStatusFilter
  onStatusChange: (status: ChangelogStatusFilter) => void
  changelog: string
  onChangelogChange: (changelog: string) => void
}

const CHANGELOG_STATUSES = [
  { id: 'all', name: 'All', color: undefined },
  { id: 'draft', name: 'Draft', color: '#6b7280' }, // gray
  { id: 'scheduled', name: 'Scheduled', color: '#3b82f6' }, // blue
  { id: 'published', name: 'Published', color: '#22c55e' }, // green
] as const

export function ChangelogFiltersPanel({
  status,
  onStatusChange,
  changelog,
  onChangelogChange,
}: ChangelogFiltersProps) {
  // Named collections — the "Changelog" section only renders once some exist.
  const { data: collections = [] } = useQuery(changelogQueries.collections())

  const changelogOptions = [
    { id: 'all', name: 'All', isPublic: true },
    { id: 'general', name: 'General', isPublic: true },
    ...collections.map((c) => ({ id: c.id as string, name: c.name, isPublic: c.isPublic })),
  ]

  return (
    <div className="space-y-0">
      <FilterSection title="Status">
        <div className="space-y-1" role="listbox" aria-label="Status filter">
          {CHANGELOG_STATUSES.map((item) => {
            const isSelected = status === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onStatusChange(item.id as ChangelogStatusFilter)}
                className={cn(
                  'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                  isSelected
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                <span className="flex items-center gap-2">
                  {item.color && (
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{item.name}</span>
                </span>
              </button>
            )
          })}
        </div>
      </FilterSection>

      {collections.length > 0 && (
        <FilterSection title="Changelog">
          <div className="space-y-1" role="listbox" aria-label="Changelog filter">
            {changelogOptions.map((item) => {
              const isSelected = changelog === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onChangelogChange(item.id)}
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                    isSelected
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate">{item.name}</span>
                    {!item.isPublic && (
                      <LockClosedIcon className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </FilterSection>
      )}
    </div>
  )
}
