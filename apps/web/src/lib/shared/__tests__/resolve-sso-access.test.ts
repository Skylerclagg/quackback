import { describe, it, expect } from 'vitest'
import { hasGroupsOverage, resolveSsoAccess } from '../resolve-sso-access'

const RULE = { claimPath: 'groups', anyOf: ['11111111-aaaa', '22222222-bbbb'] }

/**
 * The verdict that decides whether an identity provider's callback may create
 * an account. It reads the claim the way role rules do — so an admin who has
 * watched a group id grant a role can rely on the same id admitting a sign-up.
 */
describe('resolveSsoAccess', () => {
  it('admits a member of any listed group, naming the group that matched', () => {
    expect(resolveSsoAccess({ groups: ['99', '22222222-bbbb'] }, RULE)).toEqual({
      kind: 'allowed',
      matched: '22222222-bbbb',
    })
  })

  it('matches case-insensitively, since Entra emits GUIDs in lower case and admins paste them in either', () => {
    expect(resolveSsoAccess({ groups: ['11111111-AAAA'] }, RULE).kind).toBe('allowed')
  })

  it('refuses a member of no listed group', () => {
    expect(resolveSsoAccess({ groups: ['99'] }, RULE)).toEqual({ kind: 'denied' })
  })

  it('refuses when the claim is absent altogether', () => {
    expect(resolveSsoAccess({ sub: 'x' }, RULE)).toEqual({ kind: 'denied' })
  })

  it('accepts a scalar claim compared whole', () => {
    expect(resolveSsoAccess({ groups: '11111111-aaaa' }, RULE).kind).toBe('allowed')
    expect(resolveSsoAccess({ groups: '11111111-aaaa-extra' }, RULE).kind).toBe('denied')
  })

  it('follows a dotted path and a URL-shaped key like the role rules do', () => {
    expect(
      resolveSsoAccess(
        { realm_access: { roles: ['staff'] } },
        { claimPath: 'realm_access.roles', anyOf: ['staff'] }
      ).kind
    ).toBe('allowed')
    expect(
      resolveSsoAccess(
        { 'https://acme.com/groups': ['ops'] },
        { claimPath: 'https://acme.com/groups', anyOf: ['ops'] }
      ).kind
    ).toBe('allowed')
  })

  describe("Entra's groups overage", () => {
    it('reports "cannot tell" rather than "not a member" when the token carries the overage markers', () => {
      const claims = {
        _claim_names: { groups: 'src1' },
        _claim_sources: { src1: { endpoint: 'https://graph.microsoft.com/...' } },
      }
      expect(resolveSsoAccess(claims, RULE)).toEqual({ kind: 'overage' })
      expect(hasGroupsOverage(claims, 'groups')).toBe(true)
    })

    it('recognises the implicit-flow marker too', () => {
      expect(resolveSsoAccess({ hasgroups: true }, RULE)).toEqual({ kind: 'overage' })
    })

    it('does not mistake an overage of some other claim for this one', () => {
      expect(resolveSsoAccess({ _claim_names: { roles: 'src1' } }, RULE)).toEqual({
        kind: 'denied',
      })
    })

    it('still admits when the claim is present alongside a marker for another claim', () => {
      expect(
        resolveSsoAccess({ groups: ['11111111-aaaa'], _claim_names: { roles: 'src1' } }, RULE).kind
      ).toBe('allowed')
    })
  })
})
