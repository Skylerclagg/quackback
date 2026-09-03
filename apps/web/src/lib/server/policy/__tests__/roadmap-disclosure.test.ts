import { describe, expect, it } from 'vitest'
import { createId, type PrincipalId, type SegmentId } from '@quackback/ids'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import { canViewRoadmapTimeline, etaDisclosureFor } from '../roadmaps'
import type { EtaDisclosure } from '@/lib/shared/db-types'

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

const roadmap = (etaDisclosure: EtaDisclosure) => ({ etaDisclosure })

describe('etaDisclosureFor — who sees how precise a date', () => {
  it('defaults to fully public dates when nothing is configured', () => {
    expect(etaDisclosureFor(ANONYMOUS_ACTOR, {})).toBe('day')
    expect(etaDisclosureFor(ANONYMOUS_ACTOR, { etaDisclosure: null })).toBe('day')
  })

  it('applies the default cap to anonymous viewers', () => {
    expect(etaDisclosureFor(ANONYMOUS_ACTOR, roadmap({ default: 'quarter', segments: [] }))).toBe(
      'quarter'
    )
  })

  it('admins always see exact dates, whatever the cap says', () => {
    expect(
      etaDisclosureFor(actor({ role: 'admin' }), roadmap({ default: 'hidden', segments: [] }))
    ).toBe('day')
  })

  // A segment entry exists to show a trusted audience MORE. It can never take
  // away what the default already grants.
  it('a matching segment override raises a portal user above the default', () => {
    const r = roadmap({
      default: 'year',
      segments: [{ segmentId: String(segmentA), specificity: 'month' }],
    })
    expect(etaDisclosureFor(actor({ segmentIds: new Set([segmentA]) }), r)).toBe('month')
    expect(etaDisclosureFor(actor({ segmentIds: new Set([segmentB]) }), r)).toBe('year')
  })

  it('a segment override cannot lower a viewer below the default', () => {
    const r = roadmap({
      default: 'month',
      segments: [{ segmentId: String(segmentA), specificity: 'year' }],
    })
    expect(etaDisclosureFor(actor({ segmentIds: new Set([segmentA]) }), r)).toBe('month')
  })

  it('takes the finest of several matching overrides', () => {
    const r = roadmap({
      default: 'hidden',
      segments: [
        { segmentId: String(segmentA), specificity: 'quarter' },
        { segmentId: String(segmentB), specificity: 'day' },
      ],
    })
    expect(etaDisclosureFor(actor({ segmentIds: new Set([segmentA, segmentB]) }), r)).toBe('day')
  })

  it('service principals never match a segment override', () => {
    const r = roadmap({
      default: 'hidden',
      segments: [{ segmentId: String(segmentA), specificity: 'day' }],
    })
    expect(
      etaDisclosureFor(actor({ principalType: 'service', segmentIds: new Set([segmentA]) }), r)
    ).toBe('hidden')
  })

  it('members keep exact dates unless individually capped', () => {
    const member = actor({ role: 'member' })
    expect(etaDisclosureFor(member, roadmap({ default: 'hidden', segments: [] }))).toBe('day')

    const capped = roadmap({
      default: 'day',
      segments: [],
      teamMembers: [{ principalId: String(member.principalId), specificity: 'quarter' }],
    })
    expect(etaDisclosureFor(member, capped)).toBe('quarter')
    expect(etaDisclosureFor(actor({ role: 'member' }), capped)).toBe('day')
  })
})

describe('canViewRoadmapTimeline', () => {
  it('denies only when the resolved cap is hidden', () => {
    expect(
      canViewRoadmapTimeline(ANONYMOUS_ACTOR, roadmap({ default: 'hidden', segments: [] })).allowed
    ).toBe(false)
    expect(
      canViewRoadmapTimeline(ANONYMOUS_ACTOR, roadmap({ default: 'year', segments: [] })).allowed
    ).toBe(true)
    expect(
      canViewRoadmapTimeline(actor({ role: 'admin' }), roadmap({ default: 'hidden', segments: [] }))
        .allowed
    ).toBe(true)
  })
})
