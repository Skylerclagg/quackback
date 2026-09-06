import { describe, expect, it } from 'vitest'
import { resolvePublicTagSelection } from '../post-tag-selection'

const publicTags = [{ id: 'tag_bug' }, { id: 'tag_feature' }]

describe('resolvePublicTagSelection', () => {
  it('accepts public tags and dedupes them', () => {
    expect(
      resolvePublicTagSelection(publicTags, ['tag_bug', 'tag_bug', 'tag_feature'], {
        requireTag: false,
      })
    ).toEqual(['tag_bug', 'tag_feature'])
  })
  it('rejects a tag that is not public (an internal roadmap tag, or an unknown id)', () => {
    expect(() =>
      resolvePublicTagSelection(publicTags, ['tag_roadmap_x'], { requireTag: false })
    ).toThrow(/not available/)
  })
  it('enforces the per-board requirement only when asked', () => {
    expect(resolvePublicTagSelection(publicTags, [], { requireTag: false })).toEqual([])
    expect(resolvePublicTagSelection(publicTags, undefined, { requireTag: false })).toEqual([])
    expect(() => resolvePublicTagSelection(publicTags, [], { requireTag: true })).toThrow(
      /at least one tag/
    )
  })
  it('does not require a tag while there is none to choose', () => {
    expect(resolvePublicTagSelection([], [], { requireTag: true })).toEqual([])
    expect(resolvePublicTagSelection([], undefined, { requireTag: true })).toEqual([])
  })
})
