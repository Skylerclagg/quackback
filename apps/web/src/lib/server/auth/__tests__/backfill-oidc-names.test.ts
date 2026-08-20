/**
 * Retroactive given/family-name backfill from stored ID tokens.
 *
 * The load-bearing property is that it is ADDITIVE: it may only fill
 * rows that have no name yet, and must never overwrite a value a more
 * recent sign-in already synced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}))

const mockLimit = vi.fn()
const mockUpdateWhere = vi.fn()
const mockUpdateSet = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: (...a: unknown[]) => mockLimit(...a) }),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        return { where: (...a: unknown[]) => mockUpdateWhere(...a) }
      },
    }),
  },
  and: (...a: unknown[]) => ({ kind: 'and', a }),
  eq: (...a: unknown[]) => ({ kind: 'eq', a }),
  isNull: (c: unknown) => ({ kind: 'isNull', c }),
  sql: Object.assign((s: TemplateStringsArray) => ({ kind: 'sql', s: Array.from(s) }), {
    raw: vi.fn(),
  }),
  account: { userId: 'account.user_id', idToken: 'account.id_token' },
  user: { id: 'user.id', givenName: 'user.given_name', familyName: 'user.family_name' },
}))

const { backfillOidcNames, readNameClaims } = await import('../backfill-oidc-names')

/** Build an unsigned JWT whose payload carries the given claims. */
function tokenWith(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `header.${payload}.signature`
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateWhere.mockResolvedValue(undefined)
})

describe('readNameClaims', () => {
  it('extracts given_name and family_name', () => {
    expect(readNameClaims(tokenWith({ given_name: 'Ada', family_name: 'Lovelace' }))).toEqual({
      givenName: 'Ada',
      familyName: 'Lovelace',
    })
  })

  it('tolerates a token carrying only one of the two', () => {
    expect(readNameClaims(tokenWith({ given_name: 'Ada' }))).toEqual({
      givenName: 'Ada',
      familyName: null,
    })
  })

  it('returns nulls for null, malformed, and non-JSON tokens rather than throwing', () => {
    expect(readNameClaims(null)).toEqual({ givenName: null, familyName: null })
    expect(readNameClaims('not-a-jwt')).toEqual({ givenName: null, familyName: null })
    expect(readNameClaims('a.!!!not-base64!!!.c')).toEqual({ givenName: null, familyName: null })
  })

  it('ignores empty-string claims', () => {
    expect(readNameClaims(tokenWith({ given_name: '', family_name: '' }))).toEqual({
      givenName: null,
      familyName: null,
    })
  })
})

describe('backfillOidcNames', () => {
  it('writes names decoded from stored tokens', async () => {
    mockLimit.mockResolvedValueOnce([
      { userId: 'user_1', idToken: tokenWith({ given_name: 'Ada', family_name: 'Lovelace' }) },
    ])
    const { updated } = await backfillOidcNames()
    expect(updated).toBe(1)
    expect(mockUpdateSet).toHaveBeenCalledWith({ givenName: 'Ada', familyName: 'Lovelace' })
  })

  it('skips users whose tokens carry no name claims', async () => {
    mockLimit.mockResolvedValueOnce([
      { userId: 'user_1', idToken: tokenWith({ sub: 'abc', email: 'a@x.com' }) },
    ])
    const { updated } = await backfillOidcNames()
    expect(updated).toBe(0)
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('prefers the first account that yields a name when a user has several', async () => {
    mockLimit.mockResolvedValueOnce([
      { userId: 'user_1', idToken: tokenWith({ sub: 'no-name' }) },
      { userId: 'user_1', idToken: tokenWith({ given_name: 'Ada' }) },
    ])
    const { updated } = await backfillOidcNames()
    expect(updated).toBe(1)
    expect(mockUpdateSet).toHaveBeenCalledWith({ givenName: 'Ada' })
  })

  it('re-asserts the NULL guard on the UPDATE so a concurrent sign-in wins', async () => {
    mockLimit.mockResolvedValueOnce([
      { userId: 'user_1', idToken: tokenWith({ given_name: 'Ada' }) },
    ])
    await backfillOidcNames()
    const where = mockUpdateWhere.mock.calls[0][0] as { kind: string; a: unknown[] }
    expect(JSON.stringify(where)).toContain('isNull')
  })

  it('no-ops cleanly when nothing needs backfilling', async () => {
    mockLimit.mockResolvedValueOnce([])
    const { updated } = await backfillOidcNames()
    expect(updated).toBe(0)
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })
})
