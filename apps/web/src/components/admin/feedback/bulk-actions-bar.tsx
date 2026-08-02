import { useState } from 'react'
import { MapIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useRoadmaps } from '@/lib/client/hooks/use-roadmaps-query'
import type { RoadmapId } from '@quackback/ids'

interface BulkActionsBarProps {
  selectedCount: number
  /** Number of posts currently loaded in the list */
  totalCount: number
  onSelectAll: () => void
  onClear: () => void
  onAddToRoadmap: (roadmapId: RoadmapId) => void
  isAdding: boolean
}

export function BulkActionsBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClear,
  onAddToRoadmap,
  isAdding,
}: BulkActionsBarProps) {
  const [isRoadmapMenuOpen, setIsRoadmapMenuOpen] = useState(false)

  const { data: roadmaps, isLoading: isLoadingRoadmaps } = useRoadmaps({
    enabled: isRoadmapMenuOpen,
  })

  return (
    <div className="sticky bottom-4 z-10 mx-auto w-fit max-w-full px-3 pb-1 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-lg">
        <span className="text-sm font-medium tabular-nums whitespace-nowrap">
          {selectedCount} selected
        </span>
        {selectedCount < totalCount && (
          <Button variant="ghost" size="sm" onClick={onSelectAll} className="text-muted-foreground">
            Select all {totalCount}
          </Button>
        )}
        <DropdownMenu open={isRoadmapMenuOpen} onOpenChange={setIsRoadmapMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={isAdding}>
              {isAdding ? (
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MapIcon className="h-3.5 w-3.5" />
              )}
              Add to roadmap
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {isLoadingRoadmaps ? (
              <div className="flex items-center justify-center py-4">
                <ArrowPathIcon className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : roadmaps && roadmaps.length > 0 ? (
              roadmaps.map((roadmap) => (
                <DropdownMenuItem key={roadmap.id} onClick={() => onAddToRoadmap(roadmap.id)}>
                  <span className="truncate">{roadmap.name}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <div className="px-2 py-4 text-center">
                <p className="text-sm text-muted-foreground">No roadmaps yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create a roadmap in the Roadmap section
                </p>
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClear}
          aria-label="Clear selection"
        >
          <XMarkIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
