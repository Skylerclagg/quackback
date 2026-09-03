/**
 * Roadmap timeline bucket helpers.
 *
 * A timeline item carries a date plus a precision — how vaguely the
 * admin wants it shown: an exact day ("Mar 14, 2026"), a month
 * ("March 2026"), a quarter ("Q2 2026"), or a year ("2026"). Items
 * sharing (date, precision) form a bucket; buckets sort
 * chronologically and items inside a bucket are ordered manually via
 * timelinePosition.
 *
 * Dates are normalized to their bucket start (month → 1st, quarter →
 * first month, year → Jan 1) on write, so equal buckets compare equal.
 * All bucket math uses UTC so a placement never shifts buckets across
 * server/client timezones.
 *
 * Client-safe: no server imports.
 */
import {
  TIMELINE_PRECISIONS,
  TIMELINE_SPECIFICITIES,
  type TimelinePrecision,
  type TimelineSpecificity,
} from '@/lib/shared/db-types'

export { TIMELINE_PRECISIONS, TIMELINE_SPECIFICITIES }
export type { TimelinePrecision, TimelineSpecificity }

export const TIMELINE_PRECISION_LABELS: Record<TimelinePrecision, string> = {
  day: 'Exact day',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
}

/** Audience-cap labels for the roadmap "Timeline dates" setting. */
export const TIMELINE_SPECIFICITY_LABELS: Record<TimelineSpecificity, string> = {
  hidden: 'Hidden',
  year: 'Year only',
  quarter: 'Quarter',
  month: 'Month',
  day: 'Exact day',
}

/** Higher = more specific. 'hidden' shows nothing at all. */
export const TIMELINE_SPECIFICITY_RANK: Record<TimelineSpecificity, number> = {
  hidden: 0,
  year: 1,
  quarter: 2,
  month: 3,
  day: 4,
}

/**
 * Coarsen a placement to an audience cap: an item more specific than
 * the cap is re-bucketed (and its date re-normalized so the finer
 * date never leaks); an item already vaguer keeps its own precision.
 */
export function clampTimelinePlacement(
  date: Date,
  precision: TimelinePrecision,
  cap: Exclude<TimelineSpecificity, 'hidden'>
): { date: Date; precision: TimelinePrecision } {
  if (TIMELINE_SPECIFICITY_RANK[precision] <= TIMELINE_SPECIFICITY_RANK[cap]) {
    return { date, precision }
  }
  return { date: normalizeTimelineDate(date, cap), precision: cap }
}

/** Coarseness rank — lower = vaguer. Drives tie-breaks between buckets
 * that share a start date ("2026" renders before "Q1 2026" before
 * "Jan 2026"), reading as increasingly specific. */
const PRECISION_RANK: Record<TimelinePrecision, number> = {
  year: 0,
  quarter: 1,
  month: 2,
  day: 3,
}

/** Snap a date to the start of its bucket for the given precision (UTC). */
export function normalizeTimelineDate(date: Date, precision: TimelinePrecision): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  switch (precision) {
    case 'day':
      return new Date(Date.UTC(y, m, date.getUTCDate()))
    case 'month':
      return new Date(Date.UTC(y, m, 1))
    case 'quarter':
      return new Date(Date.UTC(y, m - (m % 3), 1))
    case 'year':
      return new Date(Date.UTC(y, 0, 1))
  }
}

/** Stable identity for a bucket, e.g. "month:2026-03". */
export function timelineBucketKey(date: Date, precision: TimelinePrecision): string {
  const d = normalizeTimelineDate(date, precision)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  switch (precision) {
    case 'day':
      return `day:${y}-${m}-${String(d.getUTCDate()).padStart(2, '0')}`
    case 'month':
      return `month:${y}-${m}`
    case 'quarter':
      return `quarter:${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
    case 'year':
      return `year:${y}`
  }
}

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Human bucket label: "Mar 14, 2026" / "March 2026" / "Q2 2026" / "2026". */
export function formatTimelineLabel(date: Date, precision: TimelinePrecision): string {
  const d = normalizeTimelineDate(date, precision)
  const y = d.getUTCFullYear()
  switch (precision) {
    case 'day':
      return `${MONTHS_LONG[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${y}`
    case 'month':
      return `${MONTHS_LONG[d.getUTCMonth()]} ${y}`
    case 'quarter':
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${y}`
    case 'year':
      return `${y}`
  }
}

export interface TimelinePlacement {
  timelineDate: Date
  timelinePrecision: TimelinePrecision
}

/**
 * Bucket ordering: chronological by bucket start, vaguer precision
 * first on equal starts. Returns negative when a sorts before b.
 */
export function compareTimelineBuckets(a: TimelinePlacement, b: TimelinePlacement): number {
  const aStart = normalizeTimelineDate(a.timelineDate, a.timelinePrecision).getTime()
  const bStart = normalizeTimelineDate(b.timelineDate, b.timelinePrecision).getTime()
  if (aStart !== bStart) return aStart - bStart
  return PRECISION_RANK[a.timelinePrecision] - PRECISION_RANK[b.timelinePrecision]
}

export interface TimelineBucket<T> {
  key: string
  label: string
  date: Date
  precision: TimelinePrecision
  items: T[]
}

/**
 * Group placed items into sorted buckets. Items must carry a
 * placement plus a timelinePosition; within a bucket they sort by
 * timelinePosition, tie-broken by the supplied stable key so renders
 * are deterministic.
 */
export function groupTimelineItems<T extends TimelinePlacement & { timelinePosition: number }>(
  items: T[],
  stableKey: (item: T) => string
): TimelineBucket<T>[] {
  const buckets = new Map<string, TimelineBucket<T>>()
  for (const item of items) {
    const key = timelineBucketKey(item.timelineDate, item.timelinePrecision)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        key,
        label: formatTimelineLabel(item.timelineDate, item.timelinePrecision),
        date: normalizeTimelineDate(item.timelineDate, item.timelinePrecision),
        precision: item.timelinePrecision,
        items: [],
      }
      buckets.set(key, bucket)
    }
    bucket.items.push(item)
  }
  const sorted = Array.from(buckets.values()).sort((a, b) =>
    compareTimelineBuckets(
      { timelineDate: a.date, timelinePrecision: a.precision },
      { timelineDate: b.date, timelinePrecision: b.precision }
    )
  )
  for (const bucket of sorted) {
    bucket.items.sort(
      (a, b) => a.timelinePosition - b.timelinePosition || stableKey(a).localeCompare(stableKey(b))
    )
  }
  return sorted
}
