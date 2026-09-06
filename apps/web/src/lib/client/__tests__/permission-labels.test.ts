/**
 * Every catalogue category must have a display label — a new category that
 * lands without one would render as its raw snake_case key in the roles tab
 * and the role editor (the exact bug this replaces: ai, survey, and
 * status_page were missing from the old hand-maintained map).
 */
import { describe, it, expect } from 'vitest'
import { PERMISSIONS, PERMISSION_CATEGORIES } from '@/lib/shared/permissions'
import { CATEGORY_LABELS, PERMISSION_LABELS } from '../permission-labels'

describe('CATEGORY_LABELS', () => {
  it('labels every permission category', () => {
    for (const category of PERMISSION_CATEGORIES) {
      expect(CATEGORY_LABELS[category], `missing label for '${category}'`).toBeTruthy()
      expect(CATEGORY_LABELS[category]).not.toMatch(/_/)
    }
  })

  it('has no labels for unknown categories', () => {
    const known = new Set<string>(PERMISSION_CATEGORIES)
    for (const key of Object.keys(CATEGORY_LABELS)) {
      expect(known.has(key), `stale label '${key}'`).toBe(true)
    }
  })
})

describe('PERMISSION_LABELS', () => {
  it('names and describes every permission in plain English', () => {
    for (const key of Object.values(PERMISSIONS)) {
      const entry = PERMISSION_LABELS[key]
      expect(entry, `missing entry for '${key}'`).toBeTruthy()
      expect(entry.label).not.toMatch(/[._]/)
      expect(entry.label).not.toBe(key)
      expect(entry.description.length).toBeGreaterThan(15)
    }
  })
  it('has no entries for unknown permissions', () => {
    const known = new Set<string>(Object.values(PERMISSIONS))
    for (const key of Object.keys(PERMISSION_LABELS)) {
      expect(known.has(key), `stale entry '${key}'`).toBe(true)
    }
  })
})
