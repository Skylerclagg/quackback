/**
 * Recent AI failures, read back out of ai_usage_log.
 *
 * Every AI call already records its outcome here — `withUsageLogging` for the
 * raw-SDK callers and the TanStack middleware's `onError` for the assistant
 * stack — including the provider's own message on failure. That makes this
 * table the only place that knows why a feature produced nothing, and on a
 * compose deployment it is also a place the operator cannot reach: no
 * published Postgres port, no console. So the answer has to come back through
 * the product.
 *
 * This is the counterpart to the connection test. The test proves the
 * endpoint and models answer a request Quackback makes on demand; this shows
 * what actually happened to the real calls, which is the question when the
 * test passes and features still do nothing — a per-feature model override
 * pointing at something that does not exist, a request shape the endpoint
 * rejects, or a quota that ran out yesterday.
 *
 * Failures are grouped by (step, model, message) rather than listed row by
 * row: one broken feature retried a hundred times is one finding, and the
 * count is the useful part. Successes in the same window are reported
 * alongside, because "nothing has worked" and "one thing is broken" call for
 * very different next steps.
 */

import { db, sql, type Database } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'

/** How far back to look. Long enough to cover an idle overnight deployment. */
export const FAILURE_WINDOW_HOURS = 168

/** Distinct failures to return. A glance-level list, not an audit log. */
const GROUP_LIMIT = 10

/** Cap on an echoed provider message, matching the connection test. */
const MAX_MESSAGE = 300

export interface AiFailureGroup {
  /** Which feature made the call (ai_usage_log.pipeline_step). */
  pipelineStep: string
  /** The model id as sent — the value a per-feature override actually resolved to. */
  model: string
  /** The provider's own message, trimmed. */
  error: string
  /** How many calls failed this same way in the window. */
  count: number
  /** ISO timestamp of the most recent occurrence. */
  lastAt: string
}

export interface AiActivitySummary {
  windowHours: number
  successes: number
  failures: number
  /** Most-recent-first, capped at 10 distinct failure shapes. */
  groups: AiFailureGroup[]
}

function truncate(message: string | null): string {
  const oneLine = (message ?? '').replace(/\s+/g, ' ').trim()
  if (!oneLine) return '(no message recorded)'
  return oneLine.length > MAX_MESSAGE ? `${oneLine.slice(0, MAX_MESSAGE - 1)}…` : oneLine
}

interface CountRow {
  successes: number
  failures: number
}

interface GroupRow {
  pipeline_step: string
  model: string
  error: string | null
  count: number
  last_at: string | Date
}

/**
 * Successes, failures, and the distinct failure shapes in the window.
 *
 * Both scans are bounded by created_at and ride `ai_usage_log_created_idx`.
 * `database` is injectable so the SQL can be exercised against a real
 * database in tests.
 */
export async function getRecentAiActivity(
  windowHours: number = FAILURE_WINDOW_HOURS,
  database: Database = db
): Promise<AiActivitySummary> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()

  const [countResult, groupResult] = await Promise.all([
    database.execute(sql`
      SELECT
        count(*) FILTER (WHERE status = 'success')::int AS successes,
        count(*) FILTER (WHERE status = 'error')::int   AS failures
      FROM ai_usage_log
      WHERE created_at >= ${since}::timestamptz
    `),
    database.execute(sql`
      SELECT pipeline_step, model, error,
             count(*)::int AS count,
             max(created_at) AS last_at
      FROM ai_usage_log
      WHERE created_at >= ${since}::timestamptz
        AND status = 'error'
      GROUP BY pipeline_step, model, error
      ORDER BY max(created_at) DESC
      LIMIT ${GROUP_LIMIT}
    `),
  ])

  const counts = getExecuteRows<CountRow>(countResult)[0]
  const groups = getExecuteRows<GroupRow>(groupResult)

  return {
    windowHours,
    successes: Number(counts?.successes ?? 0),
    failures: Number(counts?.failures ?? 0),
    groups: groups.map((row) => ({
      pipelineStep: row.pipeline_step,
      model: row.model,
      error: truncate(row.error),
      count: Number(row.count),
      lastAt: new Date(row.last_at).toISOString(),
    })),
  }
}
