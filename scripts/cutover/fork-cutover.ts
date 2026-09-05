/**
 * Fork → upstream cutover as a command the app image carries.
 *
 * The runbook in README.md assumes a laptop with psql and a route to the
 * database. A Coolify host offers neither, but the app container has Bun and
 * DATABASE_URL — so this bundles the runbook's SQL and the phase-4 transform
 * into one executable that the entrypoint runs around the normal migration
 * step when FORK_CUTOVER=auto is set:
 *
 *   fork-cutover status             ledger + cutover state, as JSON
 *   fork-cutover pre                phase 1 + 2 in one transaction
 *   fork-cutover post [--dry-run]   phase 4, once migrations are complete
 *
 * Every step decides from the database what it must do, and does nothing once
 * the database is past the fork tip — so the variable can stay set across
 * restarts until an operator removes it. Wrong-database protection is the
 * ledger itself: `pre` refuses anything that is not exactly the fork tip or a
 * cutover already in progress, and 02-rewind-ledger.sql re-checks the counts.
 *
 * Exit codes: 0 done or nothing to do, 1 a step failed, 2 refused (the
 * database is in a state this command must not touch).
 */
// oxlint-disable-next-line no-restricted-imports
import postgres from 'postgres'
import extractSql from './01-extract-pre-upgrade.sql' with { type: 'text' }
import rewindSql from './02-rewind-ledger.sql' with { type: 'text' }
import journal from '../../packages/db/drizzle/meta/_journal.json' with { type: 'json' }
import { runTransform } from './transform'

/** The fork's tip: 134 applied, high-water mark = 0133_user_given_family_name. */
const FORK_TIP = { applied: 134, hwm: 1787184000000 }
/** The last migration the fork and upstream share (idx 125); 02-rewind stops here. */
const SHARED_CUTOFF = { applied: 126, hwm: 1783641600000 }
/** What "migrations complete" means for THIS build: the journal it ships with. */
const JOURNAL_TIP = {
  applied: journal.entries.length,
  hwm: journal.entries[journal.entries.length - 1]!.when,
}

interface State {
  applied: number
  hwm: number | null
  extracted: boolean
  transformed: boolean
  phase: 'fork-tip' | 'rewound' | 'migrated' | 'transformed' | 'other'
}

async function readState(sql: postgres.Sql): Promise<State> {
  const [ledger] = await sql`
    SELECT count(*)::int AS applied, max(created_at)::bigint AS hwm
    FROM drizzle.__drizzle_migrations
  `
  const applied = Number(ledger?.applied ?? 0)
  const hwm = ledger?.hwm == null ? null : Number(ledger.hwm)
  const [{ t: extractTable }] = await sql`SELECT to_regclass('public.cutover_post_roadmaps') AS t`
  const [{ t: stateTable }] = await sql`SELECT to_regclass('public.cutover_state') AS t`
  let transformed = false
  if (stateTable) {
    const [row] = await sql`SELECT 1 FROM cutover_state WHERE step = 'transform'`
    transformed = !!row
  }
  let phase: State['phase'] = 'other'
  if (transformed) phase = 'transformed'
  else if (applied === FORK_TIP.applied && hwm === FORK_TIP.hwm) phase = 'fork-tip'
  else if (applied === SHARED_CUTOFF.applied && hwm === SHARED_CUTOFF.hwm && extractTable)
    phase = 'rewound'
  else if (applied === JOURNAL_TIP.applied && hwm === JOURNAL_TIP.hwm) phase = 'migrated'
  return { applied, hwm, extracted: !!extractTable, transformed, phase }
}

async function pre(sql: postgres.Sql, state: State): Promise<number> {
  if (state.phase !== 'fork-tip') {
    if (state.phase === 'other') {
      console.error(
        `fork-cutover pre: refusing — ledger has ${state.applied} rows with high-water mark ` +
          `${state.hwm}; that is neither the fork tip (${FORK_TIP.applied} @ ${FORK_TIP.hwm}) ` +
          'nor a cutover in progress. Nothing was changed.'
      )
      return 2
    }
    console.log(`fork-cutover pre: nothing to do (${state.phase})`)
    return 0
  }
  await sql.begin(async (tx) => {
    await tx.unsafe(extractSql)
    await tx.unsafe(rewindSql)
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS cutover_state (
        step text PRIMARY KEY,
        done_at timestamptz NOT NULL DEFAULT now()
      )`)
    await tx`INSERT INTO cutover_state (step) VALUES ('extract'), ('rewind') ON CONFLICT DO NOTHING`
  })
  const after = await readState(sql)
  console.log(
    `fork-cutover pre: extracted post_roadmaps and rewound the ledger to idx 125 ` +
      `(${after.applied} rows remain). The migrator applies upstream 0126+ next.`
  )
  return 0
}

async function post(sql: postgres.Sql, state: State, dryRun: boolean): Promise<number> {
  if (state.phase === 'transformed') {
    console.log('fork-cutover post: nothing to do (already transformed)')
    return 0
  }
  if (state.phase !== 'migrated') {
    console.error(
      `fork-cutover post: refusing — migrations are not complete (ledger ${state.applied} rows, ` +
        `high-water mark ${state.hwm}; this build expects ${JOURNAL_TIP.applied} @ ${JOURNAL_TIP.hwm}). ` +
        'Run the migrator first. Nothing was changed.'
    )
    return 2
  }
  if (!state.extracted) {
    // A database that never came from the fork (fresh install) has nothing to
    // translate; the transform would only report zeros anyway.
    console.log('fork-cutover post: nothing to do (no fork data to translate)')
    return 0
  }
  await runTransform(sql, !dryRun)
  if (dryRun) return 0
  await sql`
    CREATE TABLE IF NOT EXISTS cutover_state (step text PRIMARY KEY, done_at timestamptz NOT NULL DEFAULT now())`
  await sql`INSERT INTO cutover_state (step) VALUES ('transform') ON CONFLICT DO NOTHING`
  console.log('fork-cutover post: transform committed and recorded.')
  return 0
}

async function main(): Promise<number> {
  const [command, ...flags] = process.argv.slice(2)
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('fork-cutover: DATABASE_URL is required')
    return 2
  }
  if (!command || !['status', 'pre', 'post'].includes(command)) {
    console.error('usage: fork-cutover <status|pre|post> [--dry-run]')
    return 2
  }
  // Surface RAISE NOTICE lines (02-rewind reports its counts that way) as one
  // line each instead of postgres-js's default object dump.
  const sql = postgres(url, {
    max: 2,
    prepare: false,
    onnotice: (n) => console.log(`notice: ${n.message}`),
  })
  try {
    const state = await readState(sql)
    if (command === 'status') {
      console.log(JSON.stringify({ ...state, expects: JOURNAL_TIP }, null, 2))
      return 0
    }
    if (command === 'pre') return await pre(sql, state)
    return await post(sql, state, flags.includes('--dry-run'))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
