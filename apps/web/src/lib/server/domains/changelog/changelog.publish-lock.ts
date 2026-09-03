/**
 * Published changelog entries are frozen. While an entry is live the only
 * accepted change is taking it off the changelog again; edits go
 * draft → edit → publish so nothing half-finished shows on the portal.
 */
import type { UpdateChangelogInput } from './changelog.types'

export interface UpdateChangelogOptions {
  /**
   * Let the caller rewrite a live entry. Only external-source sync uses this:
   * the source page is the truth for imported entries, so it refreshes them
   * in place.
   */
  allowPublishedEdits?: boolean
}

/** Every update field that changes what readers see on a live entry. */
const LOCKED_FIELDS = [
  'title',
  'content',
  'contentJson',
  'linkedPostIds',
  'categoryIds',
  'displayDate',
  'featuredImageUrl',
  'segmentIds',
  'visibility',
  'visibleSegmentIds',
  'allowedTeamPrincipalIds',
] as const satisfies readonly (keyof UpdateChangelogInput)[]

/**
 * True when `input`, applied to a published entry, would do anything other
 * than unpublish it. Re-asserting `published` counts as a violation too: the
 * update path would stamp a fresh publishedAt on an entry that already has one.
 */
export function violatesPublishedLock(input: UpdateChangelogInput): boolean {
  if (LOCKED_FIELDS.some((field) => input[field] !== undefined)) return true
  return input.publishState?.type === 'published'
}
