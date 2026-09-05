import { describe, it, expect } from 'vitest'
import { planNameFill, readNameParts } from '../fill-name-parts'

describe('readNameParts', () => {
  it('reads trimmed given_name / family_name and ignores blanks', () => {
    expect(readNameParts({ given_name: ' Skyler ', family_name: 'Clagg' })).toEqual({
      given: 'Skyler',
      family: 'Clagg',
    })
    expect(readNameParts({ given_name: '', family_name: 7 })).toEqual({ given: null, family: null })
    expect(readNameParts(null)).toEqual({ given: null, family: null })
  })
})

describe('planNameFill', () => {
  const entra = { given: 'Skyler', family: 'Clagg' }

  it('fills both parts when both are empty and leaves a real display name alone', () => {
    expect(
      planNameFill({ name: 'Skyler Clagg', givenName: null, familyName: null }, entra)
    ).toEqual({
      givenName: 'Skyler',
      familyName: 'Clagg',
    })
  })

  it('never replaces a part someone typed', () => {
    expect(planNameFill({ name: 'Sky', givenName: 'Sky', familyName: null }, entra)).toEqual({
      familyName: 'Clagg',
    })
    expect(planNameFill({ name: 'Sky', givenName: 'Sky', familyName: 'C.' }, entra)).toBeNull()
  })

  it('rebuilds a placeholder display name from the parts', () => {
    expect(planNameFill({ name: 'unknown', givenName: null, familyName: null }, entra)).toEqual({
      givenName: 'Skyler',
      familyName: 'Clagg',
      name: 'Skyler Clagg',
    })
    // Stored parts count too, even when the IdP releases nothing.
    expect(
      planNameFill(
        { name: 'unknown', givenName: 'Skyler', familyName: 'Clagg' },
        { given: null, family: null }
      )
    ).toEqual({ name: 'Skyler Clagg' })
  })

  it('does nothing when the IdP releases nothing and the row is already fine', () => {
    expect(
      planNameFill(
        { name: 'Skyler Clagg', givenName: null, familyName: null },
        { given: null, family: null }
      )
    ).toBeNull()
  })
})
