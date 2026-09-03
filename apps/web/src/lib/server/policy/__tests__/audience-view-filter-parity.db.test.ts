/**
 * Execution-level parity: audienceViewFilter (SQL) ↔ audienceAllows (in-memory).
 *
 * audience.test.ts proves the in-memory rules. It cannot prove that Postgres,
 * executing the predicate, admits the same rows — and the two are used on
 * different paths: a single-entry read calls audienceAllows, a list query
 * applies audienceViewFilter. Drift between them is a visibility bug that
 * shows up as "the detail page 404s but the item is still in the list", or
 * worse, the reverse.
 *
 * Modelled on board-view-filter-parity.db.test.ts, against changelog_entries
 * because that is the first table to carry the audience columns.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { and, inArray } from 'drizzle-orm'
import { changelogEntries, type Database } from '@/lib/server/db'
// oxlint-disable-next-line no-restricted-imports
import { createDb } from '@quackback/db/client'
import { audienceAllows, audienceViewFilter, type AudienceResource } from '../audience'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import { createId, type SegmentId, type PrincipalId, type ChangelogId } from '@quackback/ids'

const SEGMENT_A = createId('segment') as SegmentId
const SEGMENT_B = createId('segment') as SegmentId
const LISTED_MEMBER = createId('principal') as PrincipalId

function actor(overrides: Partial<Actor>): Actor {
  return {
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(),
    ...overrides,
  }
}

const ACTORS: Array<{ name: string; actor: Actor }> = [
  { name: 'anonymous', actor: ANONYMOUS_ACTOR },
  { name: 'portal user, no segments', actor: actor({}) },
  { name: 'portal user in segment A', actor: actor({ segmentIds: new Set([SEGMENT_A]) }) },
  { name: 'portal user in segment B', actor: actor({ segmentIds: new Set([SEGMENT_B]) }) },
  {
    name: 'service principal in segment A',
    actor: actor({ principalType: 'service', segmentIds: new Set([SEGMENT_A]) }),
  },
  { name: 'member, unlisted', actor: actor({ role: 'member' }) },
  { name: 'member, listed', actor: actor({ role: 'member', principalId: LISTED_MEMBER }) },
  {
    name: 'member in segment A',
    actor: actor({ role: 'member', segmentIds: new Set([SEGMENT_A]) }),
  },
  { name: 'admin', actor: actor({ role: 'admin' }) },
]

/** Every audience shape that behaves differently. */
const CASES: Array<{ name: string; resource: AudienceResource }> = [
  { name: 'public', resource: { visibility: 'public' } },
  {
    name: 'public + empty team allowlist',
    resource: { visibility: 'public', allowedTeamPrincipalIds: [] },
  },
  { name: 'team, allowlist null', resource: { visibility: 'team', allowedTeamPrincipalIds: null } },
  { name: 'team, allowlist []', resource: { visibility: 'team', allowedTeamPrincipalIds: [] } },
  {
    name: 'team, allowlist [listed]',
    resource: { visibility: 'team', allowedTeamPrincipalIds: [String(LISTED_MEMBER)] },
  },
  {
    name: 'segment [A]',
    resource: { visibility: 'segment', visibleSegmentIds: [String(SEGMENT_A)] },
  },
  {
    name: 'segment [A] + allowlist []',
    resource: {
      visibility: 'segment',
      visibleSegmentIds: [String(SEGMENT_A)],
      allowedTeamPrincipalIds: [],
    },
  },
  { name: 'segment []', resource: { visibility: 'segment', visibleSegmentIds: [] } },
]

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback'

let db: Database | null = null
let close: (() => Promise<void>) | null = null
let available = false
const ids: ChangelogId[] = []

// Top-level, NOT beforeAll: `skipIf` is evaluated when the test is collected,
// which happens before beforeAll runs. Resolving availability in beforeAll left
// the suite permanently skipped while still reporting green.
try {
  db = createDb(DATABASE_URL, { max: 2, prepare: false })
  // postgres-js keeps its raw client at $client; closing it releases the pool
  // so vitest doesn't hang on exit. Same approach as board-view-filter-parity.
  close = async () => {
    const raw = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
    await raw?.end?.()
  }
  for (const c of CASES) {
    const id = createId('changelog') as ChangelogId
    ids.push(id)
    await db.insert(changelogEntries).values({
      id,
      title: `parity: ${c.name}`,
      content: 'x',
      visibility: c.resource.visibility,
      visibleSegmentIds: (c.resource.visibleSegmentIds ?? null) as string[] | null,
      allowedTeamPrincipalIds: (c.resource.allowedTeamPrincipalIds ?? null) as string[] | null,
    })
  }
  available = true
} catch (error) {
  console.error('audience parity: no reachable database, suite skipped:', error)
  available = false
}

afterAll(async () => {
  if (db && ids.length > 0) {
    await db
      .delete(changelogEntries)
      .where(inArray(changelogEntries.id, ids))
      .catch(() => {})
  }
  await close?.()
})

describe.skipIf(!available)('audienceViewFilter ↔ audienceAllows parity', () => {
  it('agrees on every actor × audience combination', async () => {
    const database = db!
    const mismatches: string[] = []

    for (const { name: actorName, actor: a } of ACTORS) {
      const rows = await database
        .select({ id: changelogEntries.id })
        .from(changelogEntries)
        .where(
          and(
            inArray(changelogEntries.id, ids),
            audienceViewFilter(a, {
              visibility: changelogEntries.visibility,
              visibleSegmentIds: changelogEntries.visibleSegmentIds,
              allowedTeamPrincipalIds: changelogEntries.allowedTeamPrincipalIds,
              deletedAt: changelogEntries.deletedAt,
            })
          )
        )
      const admittedBySql = new Set(rows.map((r) => String(r.id)))

      CASES.forEach((c, i) => {
        const inMemory = audienceAllows(a, c.resource).allowed
        const inSql = admittedBySql.has(String(ids[i]))
        if (inMemory !== inSql) {
          mismatches.push(`${actorName} × ${c.name}: in-memory=${inMemory} sql=${inSql}`)
        }
      })
    }

    expect(mismatches).toEqual([])
  })
})
