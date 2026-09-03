import { describe, expect, it } from 'vitest'
import { displayNameFromParts, isPlaceholderDisplayName } from '../display-name'

describe('isPlaceholderDisplayName', () => {
  it('treats blank and Entra’s "unknown" as placeholders', () => {
    expect(isPlaceholderDisplayName('')).toBe(true)
    expect(isPlaceholderDisplayName('   ')).toBe(true)
    expect(isPlaceholderDisplayName(null)).toBe(true)
    expect(isPlaceholderDisplayName('unknown')).toBe(true)
    expect(isPlaceholderDisplayName(' Unknown ')).toBe(true)
  })
  it('keeps real names', () => {
    expect(isPlaceholderDisplayName('Skyler Clagg')).toBe(false)
    expect(isPlaceholderDisplayName('Unknown Pleasures')).toBe(false)
  })
})

describe('displayNameFromParts', () => {
  it('joins whatever parts exist', () => {
    expect(displayNameFromParts('Skyler', 'Clagg')).toBe('Skyler Clagg')
    expect(displayNameFromParts('Skyler', null)).toBe('Skyler')
    expect(displayNameFromParts(null, ' Clagg ')).toBe('Clagg')
    expect(displayNameFromParts(null, undefined)).toBeNull()
  })
})
