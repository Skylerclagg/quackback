/**
 * The one admission answer the sign-up gate and role provisioning share.
 * Claim first; for an Entra provider the directory second, through the same
 * cached group-member lookup the segment rules use.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'

const hoisted = vi.hoisted(() => ({
  members: vi.fn(),
  access: vi.fn(),
}))

vi.mock('@/lib/server/integrations/entra/graph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/integrations/entra/graph')>()),
  getEntraGroupMemberEmails: (...a: unknown[]) => hoisted.members(...a),
  resolveEntraDirectoryAccess: (...a: unknown[]) => hoisted.access(...a),
}))

const { resolveSsoAdmission } = await import('../sso-admission')

const GROUP = '11111111-2222-3333-4444-555555555555'
const OTHER = '99999999-8888-7777-6666-555555555555'

function provider(over: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    kind: 'entra',
    discoveryUrl: 'https://login.microsoftonline.com/t/v2.0/.well-known/openid-configuration',
    issuer: null,
    tokenUrl: null,
    registrationId: 'oidc_entra',
    claimMapping: { access: { claimPath: 'groups', anyOf: [GROUP, 'Staff'] } },
    ...over,
  } as IdentityProvider
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.access.mockResolvedValue({ clientId: 'c' })
  hoisted.members.mockResolvedValue([])
})

describe('resolveSsoAdmission', () => {
  it('is null for a provider without a rule, so callers keep the domain behaviour', async () => {
    expect(await resolveSsoAdmission(provider({ claimMapping: null }), 'a@x.io', {})).toBeNull()
    expect(hoisted.members).not.toHaveBeenCalled()
  })

  it('admits on the claim without asking the directory', async () => {
    const r = await resolveSsoAdmission(provider(), 'a@x.io', { groups: [GROUP] })
    expect(r).toEqual({ kind: 'allowed', via: 'claim', matched: GROUP })
    expect(hoisted.members).not.toHaveBeenCalled()
  })

  it('asks the directory when the token carried no usable claim, and admits a member', async () => {
    hoisted.members.mockImplementation(async (id: string) =>
      id === GROUP ? ['bob@acme.com', 'a@x.io'] : []
    )
    const r = await resolveSsoAdmission(provider(), 'A@X.io', { sub: 'no groups here' })
    expect(r).toEqual({ kind: 'allowed', via: 'directory', matched: GROUP })
    // Only GUID-shaped values can be group ids; "Staff" is a claim-only value.
    expect(hoisted.members).toHaveBeenCalledTimes(1)
    expect(hoisted.members).toHaveBeenCalledWith(GROUP)
  })

  it('covers the Entra overage case through the directory', async () => {
    hoisted.members.mockResolvedValue(['a@x.io'])
    const r = await resolveSsoAdmission(provider(), 'a@x.io', { _claim_names: { groups: 's' } })
    expect(r?.kind).toBe('allowed')
  })

  it('denies when the directory lists the address in none of the groups', async () => {
    hoisted.members.mockResolvedValue(['someone@else.io'])
    expect(await resolveSsoAdmission(provider(), 'a@x.io', null)).toEqual({ kind: 'denied' })
  })

  it('reports the directory as unavailable rather than denying when Graph fails', async () => {
    hoisted.members.mockRejectedValue(new Error('403 from graph'))
    expect(await resolveSsoAdmission(provider(), 'a@x.io', { groups: ['x'] })).toEqual({
      kind: 'unavailable',
    })
  })

  it('falls back to the claim verdict when no directory access is configured', async () => {
    hoisted.access.mockResolvedValue(null)
    expect(
      await resolveSsoAdmission(provider(), 'a@x.io', { _claim_names: { groups: 's' } })
    ).toEqual({ kind: 'overage' })
    expect(await resolveSsoAdmission(provider(), 'a@x.io', null)).toEqual({ kind: 'denied' })
  })

  it('never consults the directory for a non-Entra provider', async () => {
    const okta = provider({ kind: 'okta', discoveryUrl: 'https://acme.okta.com/.well-known' })
    expect(await resolveSsoAdmission(okta, 'a@x.io', { groups: [OTHER] })).toEqual({
      kind: 'denied',
    })
    expect(hoisted.access).not.toHaveBeenCalled()
  })
})
