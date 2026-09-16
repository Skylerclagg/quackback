/**
 * Tests for the recent-AI-activity read.
 *
 * This is one hand-written grouping query whose whole job is to fold many
 * rows into a few findings, and no mocked query builder can demonstrate that
 * — a GROUP BY with the wrong key mocks out exactly like a correct one. So it
 * runs against a real database, following the profile-sync / parity harness:
 * DATABASE_URL (vitest sets quackback_test), falling back to the dev DB,
 * skipping when neither is reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { aiUsageLog, type Database } from '@/lib/server/db'
// Direct client import to own a short-lived pool, as the parity tests do.
// eslint-disable-next-line no-restricted-imports
import { createDb } from '@quackback/db/client'
import { getRecentAiActivity } from '../recent-failures'

const CANDIDATE_URLS = [
  process.env.DATABASE_URL,
  'postgresql://postgres:password@localhost:5432/quackback',
].filter((u): u is string => !!u)

async function pickWorkingDb(): Promise<{ db: Database; close: () => Promise<void> } | null> {
  for (const url of CANDIDATE_URLS) {
    try {
      const database = createDb(url, { max: 2, prepare: false })
      await database.execute(sql`select 1`)
      await database.execute(sql`select pipeline_step, status, error from ai_usage_log limit 0`)
      return {
        db: database,
        close: async () => {
          const raw = (database as unknown as { $client?: { end?: () => Promise<void> } }).$client
          await raw?.end?.()
        },
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

let activeDb: Database | null = null
let closeDb: (() => Promise<void>) | null = null

const resolved = await pickWorkingDb()
const dbAvailable = resolved !== null
if (resolved) {
  activeDb = resolved.db
  closeDb = resolved.close
}

// Every fixture carries this marker in pipeline_step so the sweep can find
// its own rows and nothing else's — the table is shared with other suites.
const RUN = `t${Date.now()}${Math.floor(Math.random() * 1000)}`
const step = (name: string) => `${RUN}_${name}`.slice(0, 30)

// Inserted through the query builder, not raw SQL: `id` is a TypeID whose
// default is generated in the app layer, so a raw INSERT omitting it violates
// the not-null constraint.
async function insert(row: {
  step: string
  model: string
  status: 'success' | 'error'
  error?: string | null
  minutesAgo?: number
}) {
  await activeDb!.insert(aiUsageLog).values({
    pipelineStep: row.step,
    callType: 'chat_completion',
    model: row.model,
    inputTokens: 0,
    totalTokens: 0,
    durationMs: 1,
    status: row.status,
    error: row.error ?? null,
    createdAt: new Date(Date.now() - (row.minutesAgo ?? 1) * 60 * 1000),
  })
}

/**
 * Only this run's rows, so a shared table cannot skew an assertion. Generic
 * so the caller keeps the full group type rather than just the filter key.
 */
function mine<T extends { pipelineStep: string }>(groups: T[]): T[] {
  return groups.filter((g) => g.pipelineStep.startsWith(RUN))
}

describe.skipIf(!dbAvailable)('getRecentAiActivity (real database)', () => {
  beforeAll(async () => {
    // Sweep leftovers from prior crashed runs.
    await activeDb!.execute(sql`DELETE FROM ai_usage_log WHERE pipeline_step ~ '^t[0-9]{10,}_'`)
  })

  afterAll(async () => {
    if (activeDb) {
      await activeDb.execute(sql`DELETE FROM ai_usage_log WHERE pipeline_step LIKE ${RUN + '%'}`)
    }
    await closeDb?.()
  })

  it('collapses repeats of the same failure into one group with a count', async () => {
    const s = step('extraction')
    for (let i = 0; i < 3; i++) {
      await insert({
        step: s,
        model: 'gpt-4.1-nano',
        status: 'error',
        error: '404 Resource not found',
      })
    }

    const groups = mine((await getRecentAiActivity(168, activeDb!)).groups)
    const group = groups.find((g) => g.pipelineStep === s)!
    expect(group.count).toBe(3)
    expect(group.model).toBe('gpt-4.1-nano')
    expect(group.error).toBe('404 Resource not found')
    expect(new Date(group.lastAt).getTime()).not.toBeNaN()
  })

  it('keeps different steps, models and messages as separate findings', async () => {
    // The whole point of the grouping: one broken override must not be hidden
    // behind another feature's unrelated failure.
    const a = step('summary')
    const b = step('sentiment')
    await insert({ step: a, model: 'model-a', status: 'error', error: 'boom A' })
    await insert({ step: b, model: 'model-a', status: 'error', error: 'boom A' })
    await insert({ step: a, model: 'model-b', status: 'error', error: 'boom A' })
    await insert({ step: a, model: 'model-a', status: 'error', error: 'boom B' })

    const groups = mine((await getRecentAiActivity(168, activeDb!)).groups).filter((g) =>
      [a, b].includes(g.pipelineStep)
    )
    expect(groups).toHaveLength(4)
    expect(groups.every((g) => g.count === 1)).toBe(true)
  })

  it('counts successes and failures, and never lists a success as a finding', async () => {
    const s = step('mixed')
    await insert({ step: s, model: 'm', status: 'success' })
    await insert({ step: s, model: 'm', status: 'success' })
    await insert({ step: s, model: 'm', status: 'error', error: 'nope' })

    const summary = await getRecentAiActivity(168, activeDb!)
    expect(summary.successes).toBeGreaterThanOrEqual(2)
    expect(summary.failures).toBeGreaterThanOrEqual(1)
    const groups = mine(summary.groups).filter((g) => g.pipelineStep === s)
    expect(groups).toHaveLength(1)
    expect(groups[0].error).toBe('nope')
  })

  it('excludes rows outside the window', async () => {
    const s = step('stale')
    await insert({ step: s, model: 'm', status: 'error', error: 'old', minutesAgo: 60 })

    const inWindow = mine((await getRecentAiActivity(168, activeDb!)).groups)
    expect(inWindow.some((g) => g.pipelineStep === s)).toBe(true)

    // A 30-minute window must not reach a row logged an hour ago.
    const narrow = mine((await getRecentAiActivity(0.5, activeDb!)).groups)
    expect(narrow.some((g) => g.pipelineStep === s)).toBe(false)
  })

  it('orders findings most-recent-first', async () => {
    const older = step('older')
    const newer = step('newer')
    await insert({ step: older, model: 'm', status: 'error', error: 'x', minutesAgo: 30 })
    await insert({ step: newer, model: 'm', status: 'error', error: 'x', minutesAgo: 2 })

    const groups = mine((await getRecentAiActivity(168, activeDb!)).groups)
    const iNewer = groups.findIndex((g) => g.pipelineStep === newer)
    const iOlder = groups.findIndex((g) => g.pipelineStep === older)
    expect(iNewer).toBeGreaterThanOrEqual(0)
    expect(iNewer).toBeLessThan(iOlder)
  })

  it('reports a quiet window as zero without inventing findings', async () => {
    const summary = await getRecentAiActivity(0.001, activeDb!)
    expect(summary.groups).toEqual([])
    expect(summary.windowHours).toBe(0.001)
  })

  it('substitutes a placeholder when a failure recorded no message', async () => {
    const s = step('nomsg')
    await insert({ step: s, model: 'm', status: 'error', error: null })

    const groups = mine((await getRecentAiActivity(168, activeDb!)).groups)
    expect(groups.find((g) => g.pipelineStep === s)!.error).toBe('(no message recorded)')
  })

  it('truncates a very long provider message', async () => {
    const s = step('long')
    await insert({ step: s, model: 'm', status: 'error', error: 'x'.repeat(600) })

    const group = mine((await getRecentAiActivity(168, activeDb!)).groups).find(
      (g) => g.pipelineStep === s
    )!
    expect(group.error.length).toBeLessThanOrEqual(300)
    expect(group.error.endsWith('…')).toBe(true)
  })
})
