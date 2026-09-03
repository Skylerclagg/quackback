import type { NameWriteBackResult } from '@/lib/server/integrations/entra/name-writeback'

/** Plain-language outcome of an Entra name write-back, for toasts. */
export function describeNameWriteBack(result: NameWriteBackResult): string {
  switch (result.status) {
    case 'synced':
      return 'Name saved and updated in your Microsoft account.'
    case 'failed':
      return `Name saved here. Microsoft rejected the update: ${result.reason}`
    case 'skipped':
      switch (result.reason) {
        case 'token-expired':
          return 'Name saved here. Sign out and back in to also update your Microsoft profile.'
        case 'scope-missing':
          return "Name saved here. Your Microsoft profile wasn't updated: the sign-in provider doesn't grant permission to edit it."
        default:
          return 'Name saved.'
      }
  }
}
