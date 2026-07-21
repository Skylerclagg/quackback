/**
 * Execution-level parity test: changelogAudienceFilter (SQL) ↔
 * canViewChangelogEntry (in-memory).
 *
 * The public changelog list and RSS feed are cursor-paginated, so they
 * filter audience in SQL while single-row reads use the in-memory
 * predicate. A drift between the two would ship a subtle list-vs-detail
 * visibility gap (an entry that 404s on open but appears in the list,
 * or vice versa). This pins: for every (actor, audience shape) pair,
 * the SQL predicate admits a row exactly when the predicate allows it.
 *
 * Follows the board-view-filter parity harness: connects via
 * DATABASE_URL (vitest sets quackback_test), falls back to the dev DB,
 * and skips gracefully when neither is reachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, and } from 'drizzle-orm'
import { changelogEntries, type Database } from '@/lib/server/db'
// Direct client import to spin up our own pool — bypasses the global
// `db` proxy/singleton so this test can keep its own short-lived
// connection (and close it cleanly in afterAll). The lint rule
// reserves @quackback/db/client for the canonical db.ts entry; the
// parity tests are the legitimate second caller of `createDb`.
// eslint-disable-next-line no-restricted-imports
import { createDb } from '@quackback/db/client'
import { canViewChangelogEntry, changelogAudienceFilter } from '../changelog'
import { ANONYMOUS_ACTOR, isAllowed, type Actor } from '../types'
import { createId, type SegmentId, type PrincipalId, type ChangelogId } from '@quackback/ids'

const SEGMENT_ALPHA = createId('segment') as SegmentId
const SEGMENT_BETA = createId('segment') as SegmentId
const LISTED_MEMBER = createId('principal') as PrincipalId

interface AudienceCase {
  name: string
  isPublic: boolean
  segs: string[]
  team: string[]
}

const audienceShapes: AudienceCase[] = [
  { name: 'public', isPublic: true, segs: [], team: [] },
  // Stale lists on a public entry must be ignored by both predicates.
  { name: 'public_stale_lists', isPublic: true, segs: [SEGMENT_ALPHA], team: [LISTED_MEMBER] },
  { name: 'private_empty', isPublic: false, segs: [], team: [] },
  { name: 'private_alpha', isPublic: false, segs: [SEGMENT_ALPHA], team: [] },
  { name: 'private_beta', isPublic: false, segs: [SEGMENT_BETA], team: [] },
  { name: 'private_alpha_beta', isPublic: false, segs: [SEGMENT_ALPHA, SEGMENT_BETA], team: [] },
  { name: 'private_team', isPublic: false, segs: [], team: [LISTED_MEMBER] },
  { name: 'private_mixed', isPublic: false, segs: [SEGMENT_ALPHA], team: [LISTED_MEMBER] },
]

function buildActor(overrides: Partial<Actor>): Actor {
  return {
    principalId: null,
    role: null,
    principalType: 'anonymous',
    segmentIds: new Set(),
    ...overrides,
  }
}

const actors: Record<string, Actor> = {
  anon: ANONYMOUS_ACTOR,
  user: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
  }),
  userInAlpha: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set([SEGMENT_ALPHA]),
  }),
  userInAlphaBeta: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set([SEGMENT_ALPHA, SEGMENT_BETA]),
  }),
  serviceInAlpha: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'service',
    segmentIds: new Set([SEGMENT_ALPHA]),
  }),
  memberUnlisted: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'member',
    principalType: 'user',
  }),
  memberListed: buildActor({
    principalId: LISTED_MEMBER,
    role: 'member',
    principalType: 'user',
  }),
  // A member whose segments match must still be denied — members only
  // enter through the team allowlist.
  memberInAlpha: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set([SEGMENT_ALPHA]),
  }),
  admin: buildActor({
    principalId: createId('principal') as PrincipalId,
    role: 'admin',
    principalType: 'user',
  }),
}

const CANDIDATE_URLS = [
  process.env.DATABASE_URL,
  'postgresql://postgres:password@localhost:5432/quackback',
].filter((u): u is string => !!u)

async function pickWorkingDb(): Promise<{ db: Database; close: () => Promise<void> } | null> {
  for (const url of CANDIDATE_URLS) {
    try {
      const db = createDb(url, { max: 2, prepare: false })
      await db.execute(sql`select 1`)
      await db.execute(sql`select id, is_public from ${changelogEntries} limit 0`)
      return {
        db,
        close: async () => {
          const raw = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
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
const seeded = new Map<string, AudienceCase>() // id -> case
const runPrefix = `clog-parity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-`

const resolved = await pickWorkingDb()
const dbAvailable = resolved !== null
if (resolved) {
  activeDb = resolved.db
  closeDb = resolved.close
}

describe.skipIf(!dbAvailable)(
  'changelogAudienceFilter ↔ canViewChangelogEntry parity (execution-level)',
  () => {
    beforeAll(async () => {
      if (!activeDb) return
      // Sweep leftovers from prior crashed runs before seeding.
      await activeDb
        .delete(changelogEntries)
        .where(sql`${changelogEntries.title} ~ '^clog-parity-[0-9]+-'`)
      for (const shape of audienceShapes) {
        const id = createId('changelog') as ChangelogId
        await activeDb.insert(changelogEntries).values({
          id,
          title: `${runPrefix}${shape.name}`,
          content: 'parity fixture',
          isPublic: shape.isPublic,
          allowedSegmentIds: shape.segs,
          allowedTeamPrincipalIds: shape.team,
        })
        seeded.set(String(id), shape)
      }
    })

    afterAll(async () => {
      if (activeDb) {
        await activeDb
          .delete(changelogEntries)
          .where(sql`${changelogEntries.title} LIKE ${runPrefix + '%'}`)
      }
      await closeDb?.()
    })

    for (const [actorName, actor] of Object.entries(actors)) {
      it(`SQL admits exactly the rows the predicate allows — actor: ${actorName}`, async () => {
        const rows = await activeDb!
          .select({ id: changelogEntries.id })
          .from(changelogEntries)
          .where(
            and(
              sql`${changelogEntries.title} LIKE ${runPrefix + '%'}`,
              changelogAudienceFilter(actor)
            )
          )
        const admitted = new Set(rows.map((r) => String(r.id)))

        for (const [id, shape] of seeded) {
          const expected = isAllowed(
            canViewChangelogEntry(actor, {
              isPublic: shape.isPublic,
              allowedSegmentIds: shape.segs,
              allowedTeamPrincipalIds: shape.team,
              deletedAt: null,
            })
          )
          expect(
            admitted.has(id),
            `actor=${actorName} shape=${shape.name}: SQL=${admitted.has(id)} predicate=${expected}`
          ).toBe(expected)
        }
      })
    }
  }
)
