/**
 * CUTOVER PHASE 4 — run AFTER the upstream migrator.
 *
 * Translates the fork's audience model onto upstream's, and rebuilds the
 * curated roadmap membership that upstream's 0199 deliberately discarded. The
 * logic lives in transform.ts; this file is the laptop CLI. The app image runs
 * the same code through `fork-cutover post` (see README, "Coolify").
 *
 * Usage:
 *   DATABASE_URL=postgresql://... bun scripts/cutover/04-transform.ts [--apply]
 *
 * Without --apply it reports what it WOULD do and changes nothing.
 */
// oxlint-disable-next-line no-restricted-imports
import postgres from 'postgres'
import { runTransform } from './transform'

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')

const sql = postgres(DATABASE_URL, { max: 2, prepare: false })

runTransform(sql, APPLY)
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (error) => {
    console.error(error)
    await sql.end({ timeout: 5 })
    process.exit(1)
  })
