/**
 * `resolvePrincipalsByEmail` backs the segment CSV import. It must never
 * create accounts, and it must fold case on both sides — an admin pasting
 * "Alice@Example.com" out of a spreadsheet has to hit the account stored
 * as "alice@example.com" rather than being reported as unmatched.
 *
 * The DB is mocked as a chainable select builder (same spirit as
 * assign-users-audit.test.ts): the terminal `.orderBy()` resolves with
 * whatever rows the fixture registered, and we capture the `inArray`
 * values to assert on normalization / dedupe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateId, type PrincipalId } from '@quackback/ids'

/** Rows the mocked query returns, keyed by lower-cased email. */
let userRows: { principalId: string; email: string | null }[] = []
/** Every value list handed to `inArray`, in call order. */
let inArrayCalls: unknown[][] = []

vi.mock('@/lib/server/db', () => {
  const mockInArray = vi.fn((col: unknown, vals: unknown[]) => {
    inArrayCalls.push(vals)
    return { kind: 'inArray', col, vals }
  })

  // db.select().from().innerJoin().where().orderBy() -> rows
  const mockOrderBy = vi.fn().mockImplementation(() => {
    const chunk = (inArrayCalls[inArrayCalls.length - 1] ?? []) as string[]
    const wanted = new Set(chunk)
    return Promise.resolve(userRows.filter((r) => wanted.has((r.email ?? '').toLowerCase())))
  })
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
  const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere })
  const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin })
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

  return {
    db: { select: mockSelect },
    eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
    and: vi.fn((...parts: unknown[]) => ({ kind: 'and', parts })),
    asc: vi.fn((col) => ({ kind: 'asc', col })),
    inArray: mockInArray,
    sql: Object.assign(
      vi.fn(() => ({ kind: 'sql' })),
      { raw: vi.fn(), join: vi.fn() }
    ),
    user: { id: 'user.id', email: 'user.email' },
    principal: {
      id: 'principal.id',
      userId: 'principal.user_id',
      type: 'principal.type',
      createdAt: 'principal.created_at',
    },
  }
})

import { resolvePrincipalsByEmail } from '../email-resolver'

const ALICE = generateId('principal') as PrincipalId
const BOB = generateId('principal') as PrincipalId

beforeEach(() => {
  vi.clearAllMocks()
  userRows = []
  inArrayCalls = []
})

describe('resolvePrincipalsByEmail — case-insensitive matching', () => {
  it('matches an account stored with different casing than the CSV row', async () => {
    userRows = [{ principalId: ALICE, email: 'Alice@Example.com' }]

    const result = await resolvePrincipalsByEmail(['ALICE@example.COM'])

    expect(result.matched).toEqual([{ principalId: ALICE, email: 'alice@example.com' }])
    expect(result.unmatched).toEqual([])
    expect(result.invalid).toEqual([])
  })

  it('lower-cases the values sent to the DB so the LOWER() index is usable', async () => {
    userRows = [{ principalId: ALICE, email: 'alice@example.com' }]

    await resolvePrincipalsByEmail(['  Alice@Example.com  '])

    expect(inArrayCalls[0]).toEqual(['alice@example.com'])
  })
})

describe('resolvePrincipalsByEmail — de-duplication', () => {
  it('collapses repeated addresses to one lookup value and one matched entry', async () => {
    userRows = [{ principalId: ALICE, email: 'alice@example.com' }]

    const result = await resolvePrincipalsByEmail([
      'alice@example.com',
      'ALICE@EXAMPLE.COM',
      ' alice@example.com ',
    ])

    expect(inArrayCalls[0]).toEqual(['alice@example.com'])
    expect(result.matched).toEqual([{ principalId: ALICE, email: 'alice@example.com' }])
  })

  it('de-duplicates invalid entries too', async () => {
    const result = await resolvePrincipalsByEmail(['not an email', 'NOT AN EMAIL'])

    expect(result.invalid).toEqual(['not an email'])
  })
})

describe('resolvePrincipalsByEmail — invalid entries', () => {
  it('buckets non-email strings as invalid without querying', async () => {
    const result = await resolvePrincipalsByEmail(['nope', 'also@bad', '@example.com', 'x@y.z'])

    expect(result.invalid).toEqual(['nope', 'also@bad', '@example.com'])
    // 'x@y.z' is the only well-formed entry, so it's the only thing looked up.
    expect(inArrayCalls[0]).toEqual(['x@y.z'])
  })

  it('skips blank rows entirely (trailing newlines in a CSV)', async () => {
    const result = await resolvePrincipalsByEmail(['', '   ', '\t'])

    expect(result).toEqual({ matched: [], unmatched: [], invalid: [] })
    expect(inArrayCalls).toEqual([])
  })
})

describe('resolvePrincipalsByEmail — unmatched addresses', () => {
  it('reports valid-looking emails with no account instead of creating them', async () => {
    userRows = [{ principalId: ALICE, email: 'alice@example.com' }]

    const result = await resolvePrincipalsByEmail([
      'alice@example.com',
      'ghost@example.com',
      'nobody@example.com',
    ])

    expect(result.matched).toEqual([{ principalId: ALICE, email: 'alice@example.com' }])
    expect(result.unmatched).toEqual(['ghost@example.com', 'nobody@example.com'])
    expect(result.invalid).toEqual([])
  })

  it('splits a mixed file across all three buckets', async () => {
    userRows = [
      { principalId: ALICE, email: 'alice@example.com' },
      { principalId: BOB, email: 'bob@example.com' },
    ]

    const result = await resolvePrincipalsByEmail([
      'alice@example.com',
      'garbage',
      'bob@example.com',
      'ghost@example.com',
    ])

    expect(result.matched.map((m) => m.principalId)).toEqual([ALICE, BOB])
    expect(result.unmatched).toEqual(['ghost@example.com'])
    expect(result.invalid).toEqual(['garbage'])
  })
})

describe('resolvePrincipalsByEmail — batching', () => {
  it('chunks lookups at 500 values to stay under the bind-parameter limit', async () => {
    const emails = Array.from({ length: 1200 }, (_, i) => `user${i}@example.com`)

    await resolvePrincipalsByEmail(emails)

    expect(inArrayCalls.map((c) => c.length)).toEqual([500, 500, 200])
  })
})
