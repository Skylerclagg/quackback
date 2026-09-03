/**
 * Tests for directory-sourced name backfill.
 *
 * The flattening half is pure and always runs. The write half is a
 * single hand-written statement whose whole job is "fill blanks, never
 * clobber", and that is not a property a mocked query builder can
 * demonstrate — an UPDATE with a wrong guard mocks out exactly like a
 * correct one. So it runs against a real database, following the
 * board-view / changelog parity harness: DATABASE_URL (vitest sets
 * quackback_test), falling back to the dev DB, skipping when neither is
 * reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { user, principal, type Database } from '@/lib/server/db'
// Direct client import to own a short-lived pool, as the parity tests do.
// eslint-disable-next-line no-restricted-imports
import { createDb } from '@quackback/db/client'
import { createId, type UserId, type PrincipalId } from '@quackback/ids'
import { collectDirectoryProfiles, syncDirectoryProfiles } from '../profile-sync'
import type { EntraGroupMember } from '../graph'

function member(overrides: Partial<EntraGroupMember> & { emails: string[] }): EntraGroupMember {
  return {
    id: overrides.id ?? 'obj-1',
    displayName: overrides.displayName ?? null,
    givenName: overrides.givenName ?? null,
    familyName: overrides.familyName ?? null,
    email: overrides.emails[0] ?? null,
    emails: overrides.emails,
  }
}

describe('collectDirectoryProfiles', () => {
  it('emits one row per candidate address, lowercased', () => {
    const profiles = collectDirectoryProfiles([
      member({
        displayName: 'Ada Lovelace',
        givenName: 'Ada',
        familyName: 'Lovelace',
        emails: ['Ada@Example.com', 'ada.l@example.org'],
      }),
    ])

    expect(profiles.map((p) => p.email).sort()).toEqual(['ada.l@example.org', 'ada@example.com'])
    // A member matchable under several addresses must carry its name on
    // every one — the account here could have been created under any.
    for (const p of profiles) {
      expect(p.displayName).toBe('Ada Lovelace')
      expect(p.givenName).toBe('Ada')
      expect(p.familyName).toBe('Lovelace')
    }
  })

  it('skips members with nothing to contribute', () => {
    expect(collectDirectoryProfiles([member({ emails: ['nobody@example.com'] })])).toEqual([])
  })

  it('treats blank and whitespace-only directory values as absent', () => {
    const profiles = collectDirectoryProfiles([
      member({ displayName: '  ', givenName: '', familyName: 'Hopper', emails: ['g@example.com'] }),
    ])

    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({
      displayName: null,
      givenName: null,
      familyName: 'Hopper',
    })
  })

  it('lets a named member win a collision over a nameless one', () => {
    // Two members can resolve to the same address (a guest's decoded UPN
    // colliding with another member's mail). Whichever row actually has
    // the data has to survive, or the collision costs us the name.
    const profiles = collectDirectoryProfiles([
      member({ id: 'a', emails: ['shared@example.com'], familyName: 'Only-Family' }),
      member({ id: 'b', emails: ['shared@example.com'], displayName: 'Grace Hopper' }),
    ])

    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({
      displayName: 'Grace Hopper',
      familyName: 'Only-Family',
    })
  })
})

// ---------------------------------------------------------------------------
// Real-database half
// ---------------------------------------------------------------------------

const CANDIDATE_URLS = [
  process.env.DATABASE_URL,
  'postgresql://postgres:password@localhost:5432/quackback',
].filter((u): u is string => !!u)

async function pickWorkingDb(): Promise<{ db: Database; close: () => Promise<void> } | null> {
  for (const url of CANDIDATE_URLS) {
    try {
      const database = createDb(url, { max: 2, prepare: false })
      await database.execute(sql`select 1`)
      // given_name/family_name arrived in a later migration; a database
      // that predates it should skip rather than fail.
      await database.execute(sql`select given_name, family_name from "user" limit 0`)
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

const runPrefix = `entra-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const addr = (local: string) => `${runPrefix}-${local}@example.com`

interface Seed {
  local: string
  name: string
  givenName?: string | null
  familyName?: string | null
  displayName?: string | null
}

async function seedAccount(seed: Seed): Promise<{ userId: UserId; principalId: PrincipalId }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId

  await activeDb!.insert(user).values({
    id: userId,
    name: seed.name,
    email: addr(seed.local),
    givenName: seed.givenName ?? null,
    familyName: seed.familyName ?? null,
  })
  await activeDb!.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: seed.displayName ?? null,
    createdAt: new Date(),
  })

  return { userId, principalId }
}

// Read back through the query builder rather than raw SQL: TypeIDs are
// stored as uuid behind a column mapping, so a prefixed id interpolated
// into raw SQL reaches Postgres unconverted and fails to parse.
async function readAccount(userId: UserId) {
  const rows = await activeDb!
    .select({
      name: user.name,
      given_name: user.givenName,
      family_name: user.familyName,
      display_name: principal.displayName,
    })
    .from(user)
    .leftJoin(principal, eq(principal.userId, user.id))
    .where(eq(user.id, userId))
  return rows[0]
}

describe.skipIf(!dbAvailable)('syncDirectoryProfiles (real database)', () => {
  afterAll(async () => {
    if (activeDb) {
      await activeDb.execute(sql`DELETE FROM "user" WHERE email LIKE ${runPrefix + '%'}`)
    }
    await closeDb?.()
  })

  beforeAll(async () => {
    // Sweep leftovers from prior crashed runs.
    if (activeDb) {
      await activeDb.execute(sql`DELETE FROM "user" WHERE email ~ '^entra-sync-[0-9]+-'`)
    }
  })

  it('names an account the IdP left blank', async () => {
    const { userId } = await seedAccount({ local: 'blank', name: '' })

    const result = await syncDirectoryProfiles(
      [
        member({
          displayName: 'Ada Lovelace',
          givenName: 'Ada',
          familyName: 'Lovelace',
          emails: [addr('blank')],
        }),
      ],
      activeDb!
    )

    expect(result.users).toBe(1)
    expect(await readAccount(userId)).toMatchObject({
      name: 'Ada Lovelace',
      given_name: 'Ada',
      family_name: 'Lovelace',
    })
  })

  it('never overwrites a name the account already has', async () => {
    const { userId } = await seedAccount({
      local: 'existing',
      name: 'Preferred Name',
      givenName: 'Preferred',
      familyName: 'Name',
    })

    await syncDirectoryProfiles(
      [
        member({
          displayName: 'Directory Name',
          givenName: 'Directory',
          familyName: 'Copy',
          emails: [addr('existing')],
        }),
      ],
      activeDb!
    )

    expect(await readAccount(userId)).toMatchObject({
      name: 'Preferred Name',
      given_name: 'Preferred',
      family_name: 'Name',
    })
  })

  it('fills only the fields that are blank', async () => {
    // The common shape once `name` works but the optional claims don't.
    const { userId } = await seedAccount({ local: 'partial', name: 'Grace Hopper' })

    await syncDirectoryProfiles(
      [
        member({
          displayName: 'Directory Display',
          givenName: 'Grace',
          familyName: 'Hopper',
          emails: [addr('partial')],
        }),
      ],
      activeDb!
    )

    expect(await readAccount(userId)).toMatchObject({
      name: 'Grace Hopper',
      given_name: 'Grace',
      family_name: 'Hopper',
    })
  })

  it('matches on address case-insensitively', async () => {
    const { userId } = await seedAccount({ local: 'CasedLocal', name: '' })

    const result = await syncDirectoryProfiles(
      [member({ displayName: 'Case Insensitive', emails: [addr('CasedLocal').toUpperCase()] })],
      activeDb!
    )

    expect(result.users).toBe(1)
    expect((await readAccount(userId)).name).toBe('Case Insensitive')
  })

  it('matches on a secondary address, not just the primary', async () => {
    // Guests are frequently matchable only via a decoded UPN or
    // otherMails, never via `mail`.
    const { userId } = await seedAccount({ local: 'secondary', name: '' })

    await syncDirectoryProfiles(
      [
        member({
          displayName: 'Guest Account',
          emails: ['unrelated@example.net', addr('secondary')],
        }),
      ],
      activeDb!
    )

    expect((await readAccount(userId)).name).toBe('Guest Account')
  })

  it('propagates the filled name to the principal the portal reads', async () => {
    const { userId } = await seedAccount({ local: 'principal-blank', name: '', displayName: null })

    const result = await syncDirectoryProfiles(
      [member({ displayName: 'Portal Visible', emails: [addr('principal-blank')] })],
      activeDb!
    )

    expect(result.principals).toBe(1)
    expect(await readAccount(userId)).toMatchObject({
      name: 'Portal Visible',
      display_name: 'Portal Visible',
    })
  })

  it('leaves a principal display name that is already set', async () => {
    const { userId } = await seedAccount({
      local: 'principal-set',
      name: '',
      displayName: 'Chosen Handle',
    })

    await syncDirectoryProfiles(
      [member({ displayName: 'Directory Name', emails: [addr('principal-set')] })],
      activeDb!
    )

    expect(await readAccount(userId)).toMatchObject({
      name: 'Directory Name',
      display_name: 'Chosen Handle',
    })
  })

  it('reports no writes when every account is already named', async () => {
    await seedAccount({
      local: 'noop',
      name: 'Already Named',
      givenName: 'Already',
      familyName: 'Named',
    })

    const result = await syncDirectoryProfiles(
      [
        member({
          displayName: 'Directory Name',
          givenName: 'Dir',
          familyName: 'Ectory',
          emails: [addr('noop')],
        }),
      ],
      activeDb!
    )

    expect(result).toEqual({ users: 0, principals: 0 })
  })

  it('is a no-op when the directory returns nobody worth writing', async () => {
    const result = await syncDirectoryProfiles([member({ emails: ['x@example.com'] })], activeDb!)
    expect(result).toEqual({ users: 0, principals: 0 })
  })
})
