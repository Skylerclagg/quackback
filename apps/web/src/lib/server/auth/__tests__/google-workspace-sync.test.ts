/**
 * Google Workspace capture — `hd` claim extraction and sync behavior.
 *
 * The `hd` claim is Google's verified "this account belongs to
 * Workspace X" assertion. These tests pin:
 *  1. extractHostedDomain handles real, consumer (no hd), and
 *     malformed tokens without throwing.
 *  2. syncGoogleWorkspaceFromAccount ignores non-Google accounts,
 *     skips the write when the domain is unchanged, and merges (not
 *     clobbers) user.metadata when it changed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUserFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockWhere = vi.fn()
const mockSet = vi.fn(() => ({ where: mockWhere }))
const mockUpdate = vi.fn(() => ({ set: mockSet }))
const mockEvaluate = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      user: { findFirst: (...a: unknown[]) => mockUserFindFirst(...a) },
      principal: { findFirst: (...a: unknown[]) => mockPrincipalFindFirst(...a) },
    },
    update: () => mockUpdate(),
  },
  user: { id: 'user.id' },
  principal: { userId: 'principal.userId' },
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
}))

vi.mock('@/lib/server/domains/segments/segment.evaluation', () => ({
  evaluatePrincipalDynamicSegments: (...a: unknown[]) => mockEvaluate(...a),
}))

import { extractHostedDomain, syncGoogleWorkspaceFromAccount } from '../google-workspace-sync'

/** Build an unsigned JWT-shaped token with the given payload. */
function fakeIdToken(payload: Record<string, unknown>): string {
  const b64 = (o: Record<string, unknown>) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.signature`
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extractHostedDomain', () => {
  it('returns the hd claim lowercased', () => {
    expect(extractHostedDomain(fakeIdToken({ hd: 'Acme.COM', email: 'a@acme.com' }))).toBe(
      'acme.com'
    )
  })

  it('returns null for consumer accounts (no hd claim)', () => {
    expect(extractHostedDomain(fakeIdToken({ email: 'a@gmail.com' }))).toBeNull()
  })

  it('returns null for empty / missing / malformed input', () => {
    expect(extractHostedDomain(null)).toBeNull()
    expect(extractHostedDomain(undefined)).toBeNull()
    expect(extractHostedDomain('')).toBeNull()
    expect(extractHostedDomain('not-a-jwt')).toBeNull()
    expect(extractHostedDomain('a.%%%not-base64%%%.c')).toBeNull()
  })

  it('returns null when hd is not a non-empty string', () => {
    expect(extractHostedDomain(fakeIdToken({ hd: '' }))).toBeNull()
    expect(extractHostedDomain(fakeIdToken({ hd: 42 }))).toBeNull()
  })
})

describe('syncGoogleWorkspaceFromAccount', () => {
  const googleAccount = (hd?: string) => ({
    providerId: 'google',
    userId: 'user_1',
    idToken: fakeIdToken(hd ? { hd } : {}),
  })

  it('ignores non-Google accounts entirely', async () => {
    await syncGoogleWorkspaceFromAccount({
      providerId: 'github',
      userId: 'user_1',
      idToken: fakeIdToken({ hd: 'acme.com' }),
    })
    expect(mockUserFindFirst).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('skips the write and re-evaluation when the domain is unchanged', async () => {
    mockUserFindFirst.mockResolvedValue({
      metadata: JSON.stringify({ googleWorkspaceDomain: 'acme.com', plan: 'pro' }),
    })
    await syncGoogleWorkspaceFromAccount(googleAccount('acme.com'))
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockEvaluate).not.toHaveBeenCalled()
  })

  it('merges the domain into existing metadata and re-evaluates segments', async () => {
    mockUserFindFirst.mockResolvedValue({ metadata: JSON.stringify({ plan: 'pro' }) })
    mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_1' })

    await syncGoogleWorkspaceFromAccount(googleAccount('Acme.com'))

    expect(mockSet).toHaveBeenCalledWith({
      metadata: JSON.stringify({ plan: 'pro', googleWorkspaceDomain: 'acme.com' }),
    })
    expect(mockEvaluate).toHaveBeenCalledWith('principal_1')
  })

  it('clears a stale domain when the fresh token has no hd claim', async () => {
    mockUserFindFirst.mockResolvedValue({
      metadata: JSON.stringify({ googleWorkspaceDomain: 'acme.com', plan: 'pro' }),
    })
    mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_1' })

    await syncGoogleWorkspaceFromAccount(googleAccount())

    expect(mockSet).toHaveBeenCalledWith({ metadata: JSON.stringify({ plan: 'pro' }) })
    expect(mockEvaluate).toHaveBeenCalledWith('principal_1')
  })

  it('never throws when the db layer fails (sign-in must not break)', async () => {
    mockUserFindFirst.mockRejectedValue(new Error('db down'))
    await expect(syncGoogleWorkspaceFromAccount(googleAccount('acme.com'))).resolves.toBeUndefined()
  })
})
