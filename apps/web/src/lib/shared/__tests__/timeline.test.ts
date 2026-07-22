/**
 * Timeline bucket math — the vague-date core of the roadmap timeline.
 * Pins UTC normalization (a placement must never shift buckets across
 * timezones), bucket identity/labels, chronological bucket ordering
 * with the coarser-first tie-break, and manual in-bucket ordering.
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeTimelineDate,
  timelineBucketKey,
  formatTimelineLabel,
  compareTimelineBuckets,
  clampTimelinePlacement,
  groupTimelineItems,
} from '../timeline'

const d = (iso: string) => new Date(iso)

describe('normalizeTimelineDate', () => {
  it('snaps to the bucket start per precision (UTC)', () => {
    const date = d('2026-08-19T15:30:00Z')
    expect(normalizeTimelineDate(date, 'day').toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(normalizeTimelineDate(date, 'month').toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(normalizeTimelineDate(date, 'quarter').toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(normalizeTimelineDate(date, 'year').toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('quarter snapping covers all four quarters', () => {
    expect(normalizeTimelineDate(d('2026-02-10T00:00:00Z'), 'quarter').getUTCMonth()).toBe(0)
    expect(normalizeTimelineDate(d('2026-05-10T00:00:00Z'), 'quarter').getUTCMonth()).toBe(3)
    expect(normalizeTimelineDate(d('2026-08-10T00:00:00Z'), 'quarter').getUTCMonth()).toBe(6)
    expect(normalizeTimelineDate(d('2026-11-10T00:00:00Z'), 'quarter').getUTCMonth()).toBe(9)
  })
})

describe('timelineBucketKey / formatTimelineLabel', () => {
  it('produces stable keys and human labels', () => {
    const date = d('2026-08-19T15:30:00Z')
    expect(timelineBucketKey(date, 'day')).toBe('day:2026-08-19')
    expect(timelineBucketKey(date, 'month')).toBe('month:2026-08')
    expect(timelineBucketKey(date, 'quarter')).toBe('quarter:2026-Q3')
    expect(timelineBucketKey(date, 'year')).toBe('year:2026')

    expect(formatTimelineLabel(date, 'day')).toBe('Aug 19, 2026')
    expect(formatTimelineLabel(date, 'month')).toBe('August 2026')
    expect(formatTimelineLabel(date, 'quarter')).toBe('Q3 2026')
    expect(formatTimelineLabel(date, 'year')).toBe('2026')
  })

  it('dates inside the same period share a key regardless of the picked day', () => {
    expect(timelineBucketKey(d('2026-03-01T00:00:00Z'), 'month')).toBe(
      timelineBucketKey(d('2026-03-31T23:59:00Z'), 'month')
    )
  })
})

describe('compareTimelineBuckets', () => {
  it('orders chronologically by bucket start', () => {
    const a = { timelineDate: d('2026-03-01T00:00:00Z'), timelinePrecision: 'month' as const }
    const b = { timelineDate: d('2026-04-01T00:00:00Z'), timelinePrecision: 'month' as const }
    expect(compareTimelineBuckets(a, b)).toBeLessThan(0)
  })

  it('breaks equal starts vaguer-first: 2026 → Q1 2026 → Jan 2026 → Jan 1, 2026', () => {
    const jan1 = d('2026-01-01T00:00:00Z')
    const year = { timelineDate: jan1, timelinePrecision: 'year' as const }
    const quarter = { timelineDate: jan1, timelinePrecision: 'quarter' as const }
    const month = { timelineDate: jan1, timelinePrecision: 'month' as const }
    const day = { timelineDate: jan1, timelinePrecision: 'day' as const }
    expect(compareTimelineBuckets(year, quarter)).toBeLessThan(0)
    expect(compareTimelineBuckets(quarter, month)).toBeLessThan(0)
    expect(compareTimelineBuckets(month, day)).toBeLessThan(0)
  })
})

describe('clampTimelinePlacement', () => {
  it('coarsens finer placements and re-normalizes the date so it cannot leak', () => {
    const clamped = clampTimelinePlacement(d('2026-03-14T00:00:00Z'), 'day', 'quarter')
    expect(clamped.precision).toBe('quarter')
    expect(clamped.date.toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('leaves placements at or vaguer than the cap untouched', () => {
    const exact = d('2026-03-01T00:00:00Z')
    expect(clampTimelinePlacement(exact, 'year', 'month')).toEqual({
      date: exact,
      precision: 'year',
    })
    expect(clampTimelinePlacement(exact, 'month', 'month')).toEqual({
      date: exact,
      precision: 'month',
    })
  })
})

describe('groupTimelineItems', () => {
  const item = (
    id: string,
    iso: string,
    precision: 'day' | 'month' | 'quarter' | 'year',
    position: number
  ) => ({ id, timelineDate: d(iso), timelinePrecision: precision, timelinePosition: position })

  it('groups same-bucket items and sorts buckets chronologically', () => {
    const buckets = groupTimelineItems(
      [
        item('later', '2026-06-01T00:00:00Z', 'month', 0),
        item('early-b', '2026-03-15T00:00:00Z', 'month', 1),
        item('early-a', '2026-03-02T00:00:00Z', 'month', 0),
      ],
      (i) => i.id
    )
    expect(buckets.map((b) => b.label)).toEqual(['March 2026', 'June 2026'])
    expect(buckets[0].items.map((i) => i.id)).toEqual(['early-a', 'early-b'])
  })

  it('orders items inside a bucket by timelinePosition with a stable tie-break', () => {
    const buckets = groupTimelineItems(
      [
        item('b', '2026-03-01T00:00:00Z', 'month', 2),
        item('z-tied', '2026-03-01T00:00:00Z', 'month', 1),
        item('a-tied', '2026-03-01T00:00:00Z', 'month', 1),
      ],
      (i) => i.id
    )
    expect(buckets[0].items.map((i) => i.id)).toEqual(['a-tied', 'z-tied', 'b'])
  })

  it('keeps different precisions in distinct buckets even when dates coincide', () => {
    const buckets = groupTimelineItems(
      [
        item('month-item', '2026-01-01T00:00:00Z', 'month', 0),
        item('year-item', '2026-01-01T00:00:00Z', 'year', 0),
      ],
      (i) => i.id
    )
    expect(buckets.map((b) => b.label)).toEqual(['2026', 'January 2026'])
  })
})
