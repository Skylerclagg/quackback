/**
 * Matrix for canViewRoadmap.
 *
 * Public roadmaps are visible to every viewer. Private roadmaps admit:
 * admins always; member-role team accounts only when listed in the
 * roadmap's team allowlist; portal users only via the segment
 * allowlist. Empty lists make a private roadmap admin-only. Anonymous
 * and service principals must fail closed on the segment branch,
 * matching the `segments` tier semantics in tierAllows().
 */
import { describe, it, expect } from 'vitest'
import { canViewRoadmap, type RoadmapVisibility } from '../roadmaps'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import type { SegmentId, PrincipalId } from '@quackback/ids'

// ----------------------------------------------------------------------
// Actor fixtures — one per meaningful shape
// ----------------------------------------------------------------------

const adminActor: Actor = {
  principalId: 'principal_admin' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

const memberActor: Actor = {
  principalId: 'principal_member' as PrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
}

const listedMemberActor: Actor = {
  principalId: 'principal_listed' as PrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
}

/** Member who was manually placed in a segment — must NOT gain access via it. */
const memberInAlphaSegment: Actor = {
  principalId: 'principal_member_seg' as PrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(['segment_alpha' as SegmentId]),
}

const portalUserNoSegments: Actor = {
  principalId: 'principal_user' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

const portalUserInAlpha: Actor = {
  principalId: 'principal_alpha' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(['segment_alpha' as SegmentId]),
}

const serviceInAlpha: Actor = {
  principalId: 'principal_svc_seg' as PrincipalId,
  role: 'user',
  principalType: 'service',
  segmentIds: new Set(['segment_alpha' as SegmentId]),
}

// ----------------------------------------------------------------------
// Roadmap fixtures
// ----------------------------------------------------------------------

const publicRoadmap: RoadmapVisibility = {
  isPublic: true,
  allowedSegmentIds: [],
  allowedTeamPrincipalIds: [],
  deletedAt: null,
}

const privateAdminsOnly: RoadmapVisibility = {
  isPublic: false,
  allowedSegmentIds: [],
  allowedTeamPrincipalIds: [],
  deletedAt: null,
}

const privateSharedWithAlpha: RoadmapVisibility = {
  isPublic: false,
  allowedSegmentIds: ['segment_alpha'],
  allowedTeamPrincipalIds: [],
  deletedAt: null,
}

const privateWithTeamList: RoadmapVisibility = {
  isPublic: false,
  allowedSegmentIds: [],
  allowedTeamPrincipalIds: ['principal_listed'],
  deletedAt: null,
}

const deletedPublic: RoadmapVisibility = {
  isPublic: true,
  allowedSegmentIds: [],
  allowedTeamPrincipalIds: [],
  deletedAt: new Date('2026-01-01T00:00:00Z'),
}

const allowed = (actor: Actor, roadmap: RoadmapVisibility) => canViewRoadmap(actor, roadmap).allowed

describe('canViewRoadmap — public roadmaps', () => {
  it('allows every actor shape, including anonymous', () => {
    for (const actor of [
      ANONYMOUS_ACTOR,
      adminActor,
      memberActor,
      portalUserNoSegments,
      portalUserInAlpha,
      serviceInAlpha,
    ]) {
      expect(allowed(actor, publicRoadmap)).toBe(true)
    }
  })

  it('ignores leftover allowlists while the roadmap is public', () => {
    const publicWithStaleLists: RoadmapVisibility = {
      isPublic: true,
      allowedSegmentIds: ['segment_alpha'],
      allowedTeamPrincipalIds: ['principal_listed'],
      deletedAt: null,
    }
    expect(allowed(ANONYMOUS_ACTOR, publicWithStaleLists)).toBe(true)
    expect(allowed(memberActor, publicWithStaleLists)).toBe(true)
  })
})

describe('canViewRoadmap — private roadmaps, team side', () => {
  it('empty lists make a private roadmap admin-only', () => {
    expect(allowed(adminActor, privateAdminsOnly)).toBe(true)
    expect(allowed(memberActor, privateAdminsOnly)).toBe(false)
    expect(allowed(listedMemberActor, privateAdminsOnly)).toBe(false)
    expect(allowed(ANONYMOUS_ACTOR, privateAdminsOnly)).toBe(false)
    expect(allowed(portalUserInAlpha, privateAdminsOnly)).toBe(false)
  })

  it('members gain access only through the team allowlist', () => {
    expect(allowed(listedMemberActor, privateWithTeamList)).toBe(true)
    expect(allowed(memberActor, privateWithTeamList)).toBe(false)
  })

  it('members never gain access through segment membership', () => {
    expect(allowed(memberInAlphaSegment, privateSharedWithAlpha)).toBe(false)
  })

  it('admins bypass both lists', () => {
    expect(allowed(adminActor, privateWithTeamList)).toBe(true)
    expect(allowed(adminActor, privateSharedWithAlpha)).toBe(true)
  })
})

describe('canViewRoadmap — private roadmaps, portal side', () => {
  it('allowlisted segment members can view', () => {
    expect(allowed(portalUserInAlpha, privateSharedWithAlpha)).toBe(true)
  })

  it('users outside the allowlist are denied', () => {
    expect(allowed(portalUserNoSegments, privateSharedWithAlpha)).toBe(false)
  })

  it('portal users never gain access through the team allowlist', () => {
    const userIdMatchesTeamList: Actor = {
      principalId: 'principal_listed' as PrincipalId,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(),
    }
    expect(allowed(userIdMatchesTeamList, privateWithTeamList)).toBe(false)
  })

  it('anonymous and service principals fail closed', () => {
    expect(allowed(ANONYMOUS_ACTOR, privateSharedWithAlpha)).toBe(false)
    expect(allowed(serviceInAlpha, privateSharedWithAlpha)).toBe(false)
  })

  it('tolerates null/undefined allowlists from pre-backfill rows', () => {
    const nullLists: RoadmapVisibility = {
      isPublic: false,
      allowedSegmentIds: null,
      allowedTeamPrincipalIds: null,
    }
    expect(allowed(adminActor, nullLists)).toBe(true)
    expect(allowed(memberActor, nullLists)).toBe(false)
    expect(allowed(portalUserInAlpha, nullLists)).toBe(false)
  })
})

describe('canViewRoadmap — soft-deleted roadmaps', () => {
  it('denies every actor shape, admins included', () => {
    for (const actor of [ANONYMOUS_ACTOR, adminActor, memberActor, portalUserInAlpha]) {
      expect(allowed(actor, deletedPublic)).toBe(false)
    }
  })
})
