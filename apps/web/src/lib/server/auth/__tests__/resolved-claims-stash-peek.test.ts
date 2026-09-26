/**
 * The account-creation gate runs before any account row exists: it knows the
 * address Better-Auth is about to create, not the IdP subject the stash is
 * keyed by. So the resolver also indexes the entry by that address, and the
 * gate peeks — never takes — so role provisioning still finds the entry.
 */
import { describe, it, expect } from 'vitest'
import {
  peekResolvedClaimsByEmail,
  stashResolvedClaims,
  takeResolvedClaims,
} from '../resolved-claims-stash'
import { withWorkspace } from '@/lib/server/__tests__/workspace-scope'

const PROVIDER = 'oidc_entra'
const SUBJECT = 'abc-123'

describe('peekResolvedClaimsByEmail', () => {
  it('finds the entry by the address it was stashed with, however it is cased', () => {
    withWorkspace('ws', () =>
      stashResolvedClaims(PROVIDER, SUBJECT, { groups: ['g1'] }, 'Bob@Acme.com')
    )
    expect(withWorkspace('ws', () => peekResolvedClaimsByEmail(PROVIDER, 'bob@acme.com'))).toEqual({
      groups: ['g1'],
    })
  })

  it('leaves the entry for provisioning to take afterwards', () => {
    withWorkspace('ws', () => stashResolvedClaims(PROVIDER, SUBJECT, { groups: ['g1'] }, 'b@x.io'))
    withWorkspace('ws', () => peekResolvedClaimsByEmail(PROVIDER, 'b@x.io'))
    expect(withWorkspace('ws', () => takeResolvedClaims(PROVIDER, SUBJECT))).toEqual({
      groups: ['g1'],
    })
  })

  it('knows nothing about an address that was not stashed, or a stash without one', () => {
    withWorkspace('ws', () => stashResolvedClaims(PROVIDER, 'other', { groups: ['g1'] }))
    expect(withWorkspace('ws', () => peekResolvedClaimsByEmail(PROVIDER, 'nobody@x.io'))).toBeNull()
  })

  it('is workspace-scoped like the subject key', () => {
    withWorkspace('alpha', () =>
      stashResolvedClaims(PROVIDER, SUBJECT, { groups: ['alpha'] }, 'same@x.io')
    )
    expect(
      withWorkspace('bravo', () => peekResolvedClaimsByEmail(PROVIDER, 'same@x.io'))
    ).toBeNull()
  })
})
