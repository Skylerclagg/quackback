import { describe, expect, it } from 'vitest'
import { createId, type PrincipalId, type SegmentId } from '@quackback/ids'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import { audienceAllows, teamAllowlistAllows, type AudienceResource } from '../audience'

const segmentA = createId('segment') as SegmentId
const segmentB = createId('segment') as SegmentId

function actor(overrides: Partial<Actor>): Actor {
  return {
    principalId: createId('principal') as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set(),
    ...overrides,
  }
}

function resource(overrides: Partial<AudienceResource> = {}): AudienceResource {
  return { visibility: 'team', ...overrides }
}

/** `Decision` is a discriminated union; `reason` exists only on the deny arm. */
function denialReason(decision: ReturnType<typeof audienceAllows>): string | null {
  return decision.allowed ? null : decision.reason
}

describe('audienceAllows — visibility tiers', () => {
  it('admits everyone to a public resource, including anonymous viewers', () => {
    expect(audienceAllows(ANONYMOUS_ACTOR, resource({ visibility: 'public' })).allowed).toBe(true)
  })

  it('denies anonymous viewers on team and segment tiers', () => {
    expect(audienceAllows(ANONYMOUS_ACTOR, resource({ visibility: 'team' })).allowed).toBe(false)
    expect(
      audienceAllows(ANONYMOUS_ACTOR, resource({ visibility: 'segment', visibleSegmentIds: [] }))
        .allowed
    ).toBe(false)
  })

  it('denies a soft-deleted resource to everyone, admins included', () => {
    const deleted = resource({ visibility: 'public', deletedAt: new Date() })
    expect(audienceAllows(ANONYMOUS_ACTOR, deleted).allowed).toBe(false)
    expect(audienceAllows(actor({ role: 'admin' }), deleted).allowed).toBe(false)
  })

  it('admits admins to every non-deleted tier', () => {
    const admin = actor({ role: 'admin' })
    expect(audienceAllows(admin, resource({ visibility: 'team' })).allowed).toBe(true)
    expect(
      audienceAllows(admin, resource({ visibility: 'segment', visibleSegmentIds: [segmentA] }))
        .allowed
    ).toBe(true)
  })
})

describe('audienceAllows — the segment door', () => {
  const gated = resource({ visibility: 'segment', visibleSegmentIds: [segmentA] })

  it('admits a portal user holding a listed segment', () => {
    expect(audienceAllows(actor({ segmentIds: new Set([segmentA]) }), gated).allowed).toBe(true)
  })

  it('denies a portal user holding only an unlisted segment', () => {
    expect(audienceAllows(actor({ segmentIds: new Set([segmentB]) }), gated).allowed).toBe(false)
  })

  // The fork's comment calls this out explicitly: team members can be segment
  // members, so the segment branch is NOT portal-only. Gating it on
  // principalType alone would deny a teammate the very segment they were added to.
  it('admits a TEAM member holding a listed segment, via the segment door', () => {
    const member = actor({ role: 'member', segmentIds: new Set([segmentA]) })
    expect(audienceAllows(member, { ...gated, allowedTeamPrincipalIds: [] }).allowed).toBe(true)
  })

  it('fails closed for service and anonymous principals holding the segment', () => {
    expect(
      audienceAllows(actor({ principalType: 'service', segmentIds: new Set([segmentA]) }), gated)
        .allowed
    ).toBe(false)
  })
})

describe('audienceAllows — the team allowlist tri-state', () => {
  // Preserves upstream behaviour: canViewRoadmap admits every team actor today,
  // so a column defaulting to [] would silently close every existing row.
  it('null admits every team member — the default for pre-existing rows', () => {
    const member = actor({ role: 'member' })
    expect(audienceAllows(member, resource({ allowedTeamPrincipalIds: null })).allowed).toBe(true)
    expect(audienceAllows(member, resource()).allowed).toBe(true)
  })

  it('empty list means admins only — a row closed to the rest of the team', () => {
    expect(
      audienceAllows(actor({ role: 'member' }), resource({ allowedTeamPrincipalIds: [] })).allowed
    ).toBe(false)
    expect(
      audienceAllows(actor({ role: 'admin' }), resource({ allowedTeamPrincipalIds: [] })).allowed
    ).toBe(true)
  })

  it('admits a listed member and denies an unlisted one', () => {
    const listed = createId('principal') as PrincipalId
    const gated = resource({ allowedTeamPrincipalIds: [String(listed)] })
    expect(audienceAllows(actor({ role: 'member', principalId: listed }), gated).allowed).toBe(true)
    expect(audienceAllows(actor({ role: 'member' }), gated).allowed).toBe(false)
  })

  it('never admits a PORTAL user whose principal id appears on the team allowlist', () => {
    const id = createId('principal') as PrincipalId
    const gated = resource({ allowedTeamPrincipalIds: [String(id)] })
    expect(audienceAllows(actor({ role: 'user', principalId: id }), gated).allowed).toBe(false)
  })
})

describe('audienceAllows — door ordering', () => {
  // The inversion the ordering exists to prevent: consulting the team allowlist
  // before visibility would make this row public to the internet and invisible
  // to every unlisted teammate at the same time.
  it('keeps a public resource public even with an empty team allowlist', () => {
    const r = resource({ visibility: 'public', allowedTeamPrincipalIds: [] })
    expect(audienceAllows(ANONYMOUS_ACTOR, r).allowed).toBe(true)
    expect(audienceAllows(actor({ role: 'member' }), r).allowed).toBe(true)
  })

  it('reports internal and restricted denials distinguishably', () => {
    const member = actor({ role: 'member', principalId: null })
    expect(
      denialReason(
        audienceAllows(member, resource({ visibility: 'team', allowedTeamPrincipalIds: [] }))
      )
    ).toContain('internal')
    expect(
      denialReason(
        audienceAllows(
          ANONYMOUS_ACTOR,
          resource({ visibility: 'segment', visibleSegmentIds: [segmentA] })
        )
      )
    ).toContain('restricted')
  })
})

describe('teamAllowlistAllows', () => {
  it('admits admins regardless of the list', () => {
    expect(teamAllowlistAllows(actor({ role: 'admin' }), [])).toBe(true)
    expect(teamAllowlistAllows(actor({ role: 'admin' }), ['someone-else'])).toBe(true)
  })

  it('treats null and undefined alike as "every team actor"', () => {
    expect(teamAllowlistAllows(actor({ role: 'member' }), null)).toBe(true)
    expect(teamAllowlistAllows(actor({ role: 'member' }), undefined)).toBe(true)
  })

  it('denies a member with no principal id against a non-empty list', () => {
    expect(teamAllowlistAllows(actor({ role: 'member', principalId: null }), ['x'])).toBe(false)
  })
})
