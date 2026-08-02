/**
 * Matrix for canViewRoadmap.
 *
 * Public roadmaps are visible to every viewer. Private roadmaps admit:
 * admins always; any human principal — portal user or team account —
 * whose segments intersect the segment allowlist; and, additionally,
 * member-role team accounts listed in the roadmap's team allowlist.
 * Empty lists make a private roadmap admin-only. Anonymous and service
 * principals must fail closed on the segment branch, matching the
 * `segments` tier semantics in tierAllows(). The team allowlist stays
 * team-only — a portal user is never admitted by it.
 */
import { describe, it, expect } from 'vitest'
import {
  canViewRoadmap,
  canViewRoadmapTimeline,
  timelineSpecificityFor,
  type RoadmapVisibility,
} from '../roadmaps'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import type { TimelineAccess, TimelineSpecificity } from '@/lib/server/db'

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

/** Member placed in a segment — gains access through it, like any human principal. */
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

const portalUserInAlphaBeta: Actor = {
  principalId: 'principal_alphabeta' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(['segment_alpha', 'segment_beta'] as SegmentId[]),
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

  it('the team allowlist admits exactly the members on it', () => {
    expect(allowed(listedMemberActor, privateWithTeamList)).toBe(true)
    expect(allowed(memberActor, privateWithTeamList)).toBe(false)
  })

  it('members also gain access through segment membership', () => {
    expect(allowed(memberInAlphaSegment, privateSharedWithAlpha)).toBe(true)
    // ...and still not through a segment they are not in.
    expect(allowed(memberActor, privateSharedWithAlpha)).toBe(false)
  })

  it('the two doors are independent: either one admits a member', () => {
    const privateMixed: RoadmapVisibility = {
      isPublic: false,
      allowedSegmentIds: ['segment_alpha'],
      allowedTeamPrincipalIds: ['principal_listed'],
      deletedAt: null,
    }
    expect(allowed(memberInAlphaSegment, privateMixed)).toBe(true)
    expect(allowed(listedMemberActor, privateMixed)).toBe(true)
    expect(allowed(memberActor, privateMixed)).toBe(false)
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

// ----------------------------------------------------------------------
// Timeline date specificity (timelineAccess)
// ----------------------------------------------------------------------

const withAccess = (
  dflt: TimelineSpecificity,
  segments: TimelineAccess['segments'] = []
): { timelineAccess: TimelineAccess } => ({ timelineAccess: { default: dflt, segments } })

describe('timelineSpecificityFor', () => {
  it('team actors always get full specificity, even on a hidden timeline', () => {
    expect(timelineSpecificityFor(adminActor, withAccess('hidden'))).toBe('day')
    expect(timelineSpecificityFor(memberActor, withAccess('hidden'))).toBe('day')
  })

  it('the default cap applies to viewers without a matching override', () => {
    const roadmap = withAccess('quarter', [{ segmentId: 'segment_beta', specificity: 'day' }])
    expect(timelineSpecificityFor(ANONYMOUS_ACTOR, roadmap)).toBe('quarter')
    expect(timelineSpecificityFor(portalUserNoSegments, roadmap)).toBe('quarter')
  })

  it('hidden default with a segment override: public sees nothing, the segment sees dates', () => {
    const roadmap = withAccess('hidden', [{ segmentId: 'segment_alpha', specificity: 'month' }])
    expect(timelineSpecificityFor(ANONYMOUS_ACTOR, roadmap)).toBe('hidden')
    expect(timelineSpecificityFor(portalUserInAlpha, roadmap)).toBe('month')
  })

  it('a viewer in several overridden segments takes the finest cap', () => {
    const roadmap = withAccess('hidden', [
      { segmentId: 'segment_alpha', specificity: 'year' },
      { segmentId: 'segment_beta', specificity: 'month' },
    ])
    expect(timelineSpecificityFor(portalUserInAlphaBeta, roadmap)).toBe('month')
  })

  it('an override can never make things vaguer than the default', () => {
    const roadmap = withAccess('day', [{ segmentId: 'segment_alpha', specificity: 'year' }])
    expect(timelineSpecificityFor(portalUserInAlpha, roadmap)).toBe('day')
  })

  it('service principals never match segment overrides', () => {
    const roadmap = withAccess('hidden', [{ segmentId: 'segment_alpha', specificity: 'day' }])
    expect(timelineSpecificityFor(serviceInAlpha, roadmap)).toBe('hidden')
  })

  it('missing timelineAccess defaults to fully public dates', () => {
    expect(timelineSpecificityFor(ANONYMOUS_ACTOR, {})).toBe('day')
  })

  it('member-role teammates see everything unless individually capped', () => {
    const roadmap = {
      timelineAccess: {
        default: 'day' as const,
        segments: [],
        teamMembers: [{ principalId: 'principal_member', specificity: 'quarter' as const }],
      },
    }
    expect(timelineSpecificityFor(memberActor, roadmap)).toBe('quarter')
    expect(timelineSpecificityFor(listedMemberActor, roadmap)).toBe('day')
  })

  it('a member in an overridden segment never drops below full specificity', () => {
    // Segment overrides can only RAISE a member; without an explicit
    // per-member cap they keep the 'day' they have always had.
    const roadmap = withAccess('hidden', [{ segmentId: 'segment_alpha', specificity: 'month' }])
    expect(timelineSpecificityFor(memberInAlphaSegment, roadmap)).toBe('day')
  })

  it('a member capped to hidden loses the timeline view; admins never do', () => {
    const roadmap = {
      timelineAccess: {
        default: 'day' as const,
        segments: [],
        teamMembers: [{ principalId: 'principal_member', specificity: 'hidden' as const }],
      },
    }
    expect(canViewRoadmapTimeline(memberActor, roadmap).allowed).toBe(false)
    expect(timelineSpecificityFor(adminActor, roadmap)).toBe('day')
  })
})

describe('canViewRoadmapTimeline', () => {
  it('denies exactly when the effective specificity is hidden', () => {
    const roadmap = withAccess('hidden', [{ segmentId: 'segment_alpha', specificity: 'quarter' }])
    expect(canViewRoadmapTimeline(ANONYMOUS_ACTOR, roadmap).allowed).toBe(false)
    expect(canViewRoadmapTimeline(portalUserInAlpha, roadmap).allowed).toBe(true)
    expect(canViewRoadmapTimeline(adminActor, roadmap).allowed).toBe(true)
  })
})
