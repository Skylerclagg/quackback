import { describe, it, expect } from 'vitest'
import { mapProfileClaims } from '../map-profile-claims'

describe('mapProfileClaims — locale', () => {
  it('takes a non-empty string locale', () => {
    expect(mapProfileClaims({ locale: 'pt-BR' }).locale).toBe('pt-BR')
  })

  it('nulls an absent, empty, or non-string locale', () => {
    expect(mapProfileClaims({}).locale).toBeNull()
    expect(mapProfileClaims({ locale: '' }).locale).toBeNull()
    expect(mapProfileClaims({ locale: 42 }).locale).toBeNull()
    expect(mapProfileClaims(null).locale).toBeNull()
    expect(mapProfileClaims(undefined).locale).toBeNull()
  })
})

describe('mapProfileClaims — emailVerified', () => {
  it('honours a literal boolean true', () => {
    expect(mapProfileClaims({ email_verified: true }).emailVerified).toBe(true)
  })

  it('accepts the string "true" for bridges that stringify booleans', () => {
    expect(mapProfileClaims({ email_verified: 'true' }).emailVerified).toBe(true)
    expect(mapProfileClaims({ email_verified: 'TRUE' }).emailVerified).toBe(true)
  })

  it('does NOT treat the string "false" as verified', () => {
    // The defect: the claim was consumed by truthiness, so a SAML-to-OIDC
    // bridge emitting the string "false" marked the local account verified.
    // That renders a verified badge, ships as a boolean on the public API, and
    // satisfies the linking guard.
    expect(mapProfileClaims({ email_verified: 'false' }).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: 'False' }).emailVerified).toBe(false)
  })

  it('rejects every other truthy-but-not-affirmative shape', () => {
    expect(mapProfileClaims({ email_verified: 1 }).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: 'yes' }).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: {} }).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: [] }).emailVerified).toBe(false)
  })

  it('defaults to false when the claim is absent or explicitly false', () => {
    expect(mapProfileClaims({}).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: false }).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: null }).emailVerified).toBe(false)
  })
})

describe('mapProfileClaims — given/family name', () => {
  it('takes non-empty given_name and family_name claims', () => {
    const mapped = mapProfileClaims({ given_name: 'Ada', family_name: 'Lovelace' })
    expect(mapped.givenName).toBe('Ada')
    expect(mapped.familyName).toBe('Lovelace')
  })

  it('trims surrounding whitespace', () => {
    const mapped = mapProfileClaims({ given_name: '  Ada  ', family_name: '\tLovelace\n' })
    expect(mapped.givenName).toBe('Ada')
    expect(mapped.familyName).toBe('Lovelace')
  })

  // The return is spread OVER the resolved user info, so a key present with an
  // empty value overwrites the stored column. Omitting the key is what lets a
  // hand-entered name survive a later sign-in where the IdP released nothing.
  it('OMITS the keys entirely when the claims are absent', () => {
    const mapped = mapProfileClaims({})
    expect('givenName' in mapped).toBe(false)
    expect('familyName' in mapped).toBe(false)
  })

  it('omits the keys for blank or non-string claims', () => {
    for (const value of ['', '   ', 42, null, true, {}, []]) {
      const mapped = mapProfileClaims({ given_name: value, family_name: value })
      expect('givenName' in mapped).toBe(false)
      expect('familyName' in mapped).toBe(false)
    }
  })

  it('carries one name through when only the other is released', () => {
    const onlyGiven = mapProfileClaims({ given_name: 'Ada' })
    expect(onlyGiven.givenName).toBe('Ada')
    expect('familyName' in onlyGiven).toBe(false)

    const onlyFamily = mapProfileClaims({ family_name: 'Lovelace' })
    expect(onlyFamily.familyName).toBe('Lovelace')
    expect('givenName' in onlyFamily).toBe(false)
  })

  it('survives a null or undefined profile', () => {
    expect('givenName' in mapProfileClaims(null)).toBe(false)
    expect('givenName' in mapProfileClaims(undefined)).toBe(false)
  })
})
