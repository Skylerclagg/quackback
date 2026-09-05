import { describe, expect, it } from 'vitest'
import { buildNamePatch } from '../name-writeback'
import { grantedScopes, hasProfileWriteScope } from '../name-writeback'

describe('grantedScopes', () => {
  it('parses the comma-joined form Better-Auth stores for Entra', () => {
    // Verbatim from a production account row.
    expect([...grantedScopes('email,openid,profile,Group.Read.All,User.Read')]).toEqual([
      'email',
      'openid',
      'profile',
      'Group.Read.All',
      'User.Read',
    ])
  })

  it('parses space-separated scopes and strips the Graph resource prefix', () => {
    expect([
      ...grantedScopes('openid https://graph.microsoft.com/User.ReadWrite offline_access'),
    ]).toEqual(['openid', 'User.ReadWrite', 'offline_access'])
  })

  it('is empty for a missing scope string', () => {
    expect(grantedScopes(null).size).toBe(0)
    expect(grantedScopes(undefined).size).toBe(0)
  })
})

describe('hasProfileWriteScope', () => {
  it('is false for today’s production consent (User.Read only)', () => {
    expect(hasProfileWriteScope('email,openid,profile,Group.Read.All,User.Read')).toBe(false)
  })

  it('is true once User.ReadWrite is granted, in either form', () => {
    expect(hasProfileWriteScope('openid User.ReadWrite')).toBe(true)
    expect(hasProfileWriteScope('openid,https://graph.microsoft.com/User.ReadWrite')).toBe(true)
  })

  it('accepts the broader delegated write scopes too', () => {
    expect(hasProfileWriteScope('User.ReadWrite.All')).toBe(true)
    expect(hasProfileWriteScope('Directory.AccessAsUser.All')).toBe(true)
  })
})

describe('buildNamePatch', () => {
  it('maps the parts to Graph fields and includes the display name', () => {
    expect(
      buildNamePatch({ givenName: ' Skyler ', familyName: 'Clagg', displayName: 'Skyler Clagg' })
    ).toEqual({ givenName: 'Skyler', surname: 'Clagg', displayName: 'Skyler Clagg' })
  })

  it('sends only what was provided, so a partial save cannot blank a field', () => {
    expect(buildNamePatch({ givenName: 'Skyler' })).toEqual({ givenName: 'Skyler' })
    expect(buildNamePatch({ displayName: '  ' })).toEqual({})
  })
})
