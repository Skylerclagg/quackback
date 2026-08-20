/**
 * Scope resolution for OIDC providers.
 *
 * A provider whose stored scope string omits `openid` or `profile`
 * produces an IdP response the app cannot build a user from — `user.name`
 * is NOT NULL, and `given_name` / `family_name` ride the same `profile`
 * scope. Legacy custom-oidc rows can carry such a string (the field was
 * free text and the current editor doesn't surface it), so the required
 * minimum is unioned in rather than trusted to be present.
 */
import { describe, it, expect } from 'vitest'
import { resolveScopes, DEFAULT_OIDC_SCOPES } from '../build-oauth-configs'

describe('resolveScopes', () => {
  it('uses the defaults when nothing is configured', () => {
    expect(resolveScopes(null)).toEqual([...DEFAULT_OIDC_SCOPES])
    expect(resolveScopes(undefined)).toEqual([...DEFAULT_OIDC_SCOPES])
    expect(resolveScopes('')).toEqual([...DEFAULT_OIDC_SCOPES])
  })

  it('adds profile back when a stored string omits it', () => {
    // The regression this guards: names silently never arrive.
    expect(resolveScopes('openid email')).toEqual(['openid', 'email', 'profile'])
  })

  it('adds openid back when a stored string omits it', () => {
    expect(resolveScopes('email profile')).toEqual(['email', 'profile', 'openid'])
  })

  it('preserves custom scopes alongside the required ones', () => {
    expect(resolveScopes('openid profile custom:read')).toEqual([
      'openid',
      'profile',
      'custom:read',
    ])
    expect(resolveScopes('custom:read')).toEqual(['custom:read', 'openid', 'profile'])
  })

  it('does not duplicate scopes already present', () => {
    const resolved = resolveScopes('openid profile email')
    expect(resolved).toEqual(['openid', 'profile', 'email'])
    expect(new Set(resolved).size).toBe(resolved.length)
  })

  it('tolerates irregular whitespace', () => {
    expect(resolveScopes('  openid   email  ')).toEqual(['openid', 'email', 'profile'])
  })
})
