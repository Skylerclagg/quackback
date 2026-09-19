import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_ASSISTANT_NAME,
  assistantName,
  setAssistantName,
  formattedWithAssistantName,
} from '../assistant-name'

beforeEach(() => setAssistantName(null))

describe('the name store', () => {
  it('falls back to the default for unset, empty, and whitespace', () => {
    for (const value of [null, undefined, '', '   ']) {
      setAssistantName(value)
      expect(assistantName()).toBe(DEFAULT_ASSISTANT_NAME)
    }
  })

  it('trims a configured name', () => {
    setAssistantName('  Aiden  ')
    expect(assistantName()).toBe('Aiden')
  })
})

describe('formattedWithAssistantName', () => {
  // The rich case is the reason this exists alongside withAssistantName: a
  // message with a <Link> or <b> comes back from formatMessage as an array of
  // strings and React nodes, and a plain string replace cannot touch it.
  it('swaps the name in a plain string result', () => {
    expect(formattedWithAssistantName('Manage Quinn', 'Aiden')).toBe('Manage Aiden')
  })

  it('swaps only the string chunks of a rich result, leaving nodes untouched', () => {
    const node = { type: 'a', props: { children: 'link' } }
    const out = formattedWithAssistantName(['Ask Quinn via ', node, ' about Quinn'], 'Aiden')
    expect(out).toEqual(['Ask Aiden via ', node, ' about Aiden'])
    // The node must be the SAME reference, not a copy — React relies on it.
    expect((out as unknown[])[1]).toBe(node)
  })

  it('replaces every occurrence, not just the first', () => {
    expect(formattedWithAssistantName('Quinn and Quinn', 'Aiden')).toBe('Aiden and Aiden')
  })

  it('is a no-op when the workspace kept the default', () => {
    const rich = ['Ask Quinn']
    expect(formattedWithAssistantName('Manage Quinn', DEFAULT_ASSISTANT_NAME)).toBe('Manage Quinn')
    // Same reference back, so an unconfigured workspace pays nothing.
    expect(formattedWithAssistantName(rich, DEFAULT_ASSISTANT_NAME)).toBe(rich)
  })

  it('reads the store when no name is passed', () => {
    setAssistantName('Aiden')
    expect(formattedWithAssistantName('Manage Quinn')).toBe('Manage Aiden')
  })

  it('passes through anything that is neither a string nor an array', () => {
    const el = { type: 'span' }
    expect(formattedWithAssistantName(el, 'Aiden')).toBe(el)
    expect(formattedWithAssistantName(null, 'Aiden')).toBeNull()
  })
})
