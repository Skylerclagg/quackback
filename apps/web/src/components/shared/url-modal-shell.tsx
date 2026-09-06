import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

interface UrlModalShellProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Accessible title for screen readers */
  srTitle: string
  /** Content is only rendered when a validated ID exists */
  hasValidId: boolean
  children: React.ReactNode
}

export function UrlModalShell({
  open,
  onOpenChange,
  srTitle,
  hasValidId,
  children,
}: UrlModalShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Phones: full-screen, 100dvh, so the body scrolls inside the modal and
        // the comment composer stays reachable with the keyboard open. From sm
        // up: the centred dialog as before.
        className="max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none sm:w-[90vw] lg:max-w-5xl xl:max-w-6xl sm:h-[85vh] p-0 gap-0 flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{srTitle}</DialogTitle>
        {hasValidId && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            {children}
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  )
}
