import { describe, expect, it } from 'vitest'
import {
  buildIntegrationTargets,
  mappingMatches,
  needsPostFacts,
  type CachedMapping,
} from '../integration.resolver'

const mapping = (over: Partial<CachedMapping>): CachedMapping => ({
  eventType: 'post.created',
  integrationType: 'slack',
  integrationId: 'integration_1',
  secrets: null,
  integrationConfig: { channelId: 'C1' },
  actionConfig: {},
  filters: null,
  ...over,
})
const decrypt = () => ({ accessToken: 't' })
const isTracker = (type: string) => type === 'github'

describe('mappingMatches — routing conditions', () => {
  it('accepts everything when there are no filters', () => {
    expect(mappingMatches(null, 'post.created', ['b1'], {}, 'slack')).toBe(true)
  })

  it('keeps the board filter semantics', () => {
    expect(mappingMatches({ boardIds: ['b1'] }, 'post.created', ['b2'], {}, 'slack')).toBe(false)
    expect(mappingMatches({ boardIds: ['b1'] }, 'post.created', ['b1'], {}, 'slack')).toBe(true)
    // Board-less events pass a board filter, as before.
    expect(mappingMatches({ boardIds: ['b1'] }, 'post.created', [], {}, 'slack')).toBe(true)
  })

  it('requires at least one of the listed tags, and fails closed when tags are unknown', () => {
    const f = { tagIds: ['bug', 'feature'] }
    expect(mappingMatches(f, 'post.created', [], { tagIds: ['feature'] }, 'slack')).toBe(true)
    expect(mappingMatches(f, 'post.created', [], { tagIds: ['docs'] }, 'slack')).toBe(false)
    expect(mappingMatches(f, 'post.created', [], {}, 'slack')).toBe(false)
  })

  it('applies the status filter to status changes only', () => {
    const f = { statusIds: ['planned'] }
    expect(mappingMatches(f, 'post.status_changed', [], { statusId: 'planned' }, 'slack')).toBe(
      true
    )
    expect(mappingMatches(f, 'post.status_changed', [], { statusId: 'open' }, 'slack')).toBe(false)
    expect(mappingMatches(f, 'post.created', [], { statusId: 'open' }, 'slack')).toBe(true)
  })

  it('fires a notification exactly when the vote threshold is reached', () => {
    const f = { minVotes: 10 }
    expect(mappingMatches(f, 'post.voted', [], { voteCount: 9, isTracker }, 'slack')).toBe(false)
    expect(mappingMatches(f, 'post.voted', [], { voteCount: 10, isTracker }, 'slack')).toBe(true)
    expect(mappingMatches(f, 'post.voted', [], { voteCount: 11, isTracker }, 'slack')).toBe(false)
  })

  it('lets a tracker fire at or above the threshold (it dedupes on the link)', () => {
    const f = { minVotes: 10 }
    expect(mappingMatches(f, 'post.voted', [], { voteCount: 10, isTracker }, 'github')).toBe(true)
    expect(mappingMatches(f, 'post.voted', [], { voteCount: 25, isTracker }, 'github')).toBe(true)
    expect(mappingMatches(f, 'post.voted', [], { voteCount: 3, isTracker }, 'github')).toBe(false)
  })

  it('ignores a vote threshold on other events and an unknown vote count fails closed', () => {
    expect(mappingMatches({ minVotes: 5 }, 'post.created', [], {}, 'slack')).toBe(true)
    expect(mappingMatches({ minVotes: 5 }, 'post.voted', [], {}, 'slack')).toBe(false)
  })
})

describe('buildIntegrationTargets with conditions', () => {
  it('drops rows whose conditions the event does not meet and keeps the rest', () => {
    const mappings = [
      mapping({
        eventType: 'post.voted',
        actionConfig: { channelId: 'C-hot' },
        filters: { minVotes: 10 },
      }),
      mapping({ eventType: 'post.voted', actionConfig: { channelId: 'C-all' } }),
    ]
    const targets = buildIntegrationTargets(mappings, 'post.voted', ['b1'], 'https://x', decrypt, {
      voteCount: 3,
      isTracker,
    })
    expect(targets.map((t) => (t.target as { channelId: string }).channelId)).toEqual(['C-all'])
  })

  it('is unchanged for rows without conditions when no facts are supplied', () => {
    const targets = buildIntegrationTargets(
      [mapping({})],
      'post.created',
      ['b1'],
      'https://x',
      decrypt
    )
    expect(targets).toHaveLength(1)
  })
})

describe('needsPostFacts', () => {
  it('is true only when a row filters on tags or statuses', () => {
    expect(needsPostFacts([mapping({ filters: { boardIds: ['b'] } })])).toBe(false)
    expect(needsPostFacts([mapping({ filters: { minVotes: 3 } })])).toBe(false)
    expect(needsPostFacts([mapping({ filters: { tagIds: ['t'] } })])).toBe(true)
    expect(needsPostFacts([mapping({ filters: { statusIds: ['s'] } })])).toBe(true)
  })
})
