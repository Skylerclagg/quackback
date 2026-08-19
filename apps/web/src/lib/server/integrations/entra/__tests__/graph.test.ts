/**
 * Entra Graph client: paging, email fallback, throttling retry, and the
 * error mapping admins actually see (missing Graph permission → the
 * grant to make; bad secret → where to fix it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }) },
}))

const mockListProviders = vi.fn()
const mockGetCreds = vi.fn()
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: (...a: unknown[]) => mockListProviders(...a),
  getIdentityProviderCredentials: (...a: unknown[]) => mockGetCreds(...a),
}))

const {
  getGraphToken,
  listEntraGroupMembers,
  isEntraProvider,
  getEntraGroupMemberEmails,
  searchEntraGroups,
  __clearEntraCaches,
} = await import('../graph')

const GROUP_ID = '11111111-2222-3333-4444-555555555555'
const ACCESS = {
  tokenEndpoint: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
  clientId: 'client',
  clientSecret: 'secret',
  label: 'Test Entra',
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  __clearEntraCaches()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('isEntraProvider', () => {
  it('trusts kind=entra', () => {
    expect(
      isEntraProvider({ kind: 'entra', discoveryUrl: null, issuer: null, tokenUrl: null })
    ).toBe(true)
  })

  it('rejects a different explicit kind even with a microsoft URL', () => {
    expect(
      isEntraProvider({
        kind: 'okta',
        discoveryUrl: 'https://login.microsoftonline.com/x/v2.0/.well-known/openid-configuration',
        issuer: null,
        tokenUrl: null,
      })
    ).toBe(false)
  })

  it('sniffs pre-kind rows by URL, including CIAM authorities', () => {
    expect(
      isEntraProvider({
        kind: null,
        discoveryUrl: 'https://contoso.ciamlogin.com/x/v2.0/.well-known/openid-configuration',
        issuer: null,
        tokenUrl: null,
      })
    ).toBe(true)
    expect(
      isEntraProvider({
        kind: null,
        discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
        issuer: null,
        tokenUrl: null,
      })
    ).toBe(false)
  })
})

describe('getGraphToken', () => {
  it('exchanges client credentials for a token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }))
    expect(await getGraphToken(ACCESS)).toBe('tok')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ACCESS.tokenEndpoint)
    const body = String(init.body)
    expect(body).toContain('grant_type=client_credentials')
    expect(body).toContain(encodeURIComponent('https://graph.microsoft.com/.default'))
  })

  it('maps invalid_client to an expired-secret message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid_client', error_description: 'AADSTS7000222' }, 401)
    )
    await expect(getGraphToken(ACCESS)).rejects.toThrow(/client secret may have expired/)
  })
})

describe('listEntraGroupMembers', () => {
  it('rejects a non-GUID group id before calling Graph', async () => {
    await expect(listEntraGroupMembers('tok', 'my-group-name')).rejects.toThrow(/Object ID/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('follows @odata.nextLink to the end', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          value: [{ id: 'u1', displayName: 'A', mail: 'a@x.com' }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ value: [{ id: 'u2', displayName: 'B', mail: 'b@x.com' }] })
      )

    const members = await listEntraGroupMembers('tok', GROUP_ID)
    expect(members.map((m) => m.email)).toEqual(['a@x.com', 'b@x.com'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to the emailAddress sign-in identity when mail is absent', async () => {
    // Self-registered External ID accounts hold the address only as a
    // sign-in identity — the portal-cloud reference's exact fallback.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        value: [
          {
            id: 'u1',
            displayName: 'Self-registered',
            mail: null,
            identities: [
              { signInType: 'userPrincipalName', issuerAssignedId: 'ignored@tenant' },
              { signInType: 'emailAddress', issuerAssignedId: 'real@x.com' },
            ],
          },
        ],
      })
    )
    const members = await listEntraGroupMembers('tok', GROUP_ID)
    expect(members[0].email).toBe('real@x.com')
  })

  it('reports null email for non-user member objects (nested groups, devices)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ value: [{ id: 'g1', displayName: 'Nested group' }] })
    )
    const members = await listEntraGroupMembers('tok', GROUP_ID)
    expect(members[0].email).toBeNull()
  })

  it('retries a throttled page honoring Retry-After, then succeeds', async () => {
    vi.useFakeTimers()
    try {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '1' }))
        .mockResolvedValueOnce(jsonResponse({ value: [{ id: 'u1', mail: 'a@x.com' }] }))

      const pending = listEntraGroupMembers('tok', GROUP_ID)
      await vi.advanceTimersByTimeAsync(1000)
      const members = await pending
      expect(members).toHaveLength(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps 403 to the permission grant the admin must make', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 403))
    await expect(listEntraGroupMembers('tok', GROUP_ID)).rejects.toThrow(/GroupMember\.Read\.All/)
  })

  it('maps 404 to group-not-found', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404))
    await expect(listEntraGroupMembers('tok', GROUP_ID)).rejects.toThrow(/No Entra group/)
  })
})

describe('getEntraGroupMemberEmails (cached accessor)', () => {
  const PROVIDER = {
    registrationId: 'sso',
    label: 'Entra',
    kind: 'entra',
    enabled: true,
    configured: true,
    clientId: 'client',
    discoveryUrl: 'https://login.microsoftonline.com/t/v2.0/.well-known/openid-configuration',
    issuer: null,
    tokenUrl: 'https://login.microsoftonline.com/t/oauth2/v2.0/token',
  }

  function primeHappyPath() {
    mockListProviders.mockResolvedValue([PROVIDER])
    mockGetCreds.mockResolvedValue({ clientId: 'client', clientSecret: 's', discoveryUrl: '' })
    fetchMock
      // token
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }))
      // members page
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            { id: 'u1', mail: 'MiXeD@X.com' },
            {
              id: 'u2',
              mail: null,
              identities: [{ signInType: 'emailAddress', issuerAssignedId: 'b@x.com' }],
            },
            { id: 'g1' }, // nested group — no email, dropped
          ],
        })
      )
  }

  it('lowercases emails and drops memberless objects', async () => {
    primeHappyPath()
    expect(await getEntraGroupMemberEmails(GROUP_ID)).toEqual(['mixed@x.com', 'b@x.com'])
  })

  it('serves repeat lookups from cache without another Graph call', async () => {
    primeHappyPath()
    await getEntraGroupMemberEmails(GROUP_ID)
    const callsAfterFirst = fetchMock.mock.calls.length
    await getEntraGroupMemberEmails(GROUP_ID)
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('throws (and does not cache) when no Entra provider is registered', async () => {
    mockListProviders.mockResolvedValue([])
    await expect(getEntraGroupMemberEmails(GROUP_ID)).rejects.toThrow(/no enabled Entra/i)
    // A later call with a provider present must not see a cached failure.
    primeHappyPath()
    expect(await getEntraGroupMemberEmails(GROUP_ID)).toHaveLength(2)
  })

  it('searchEntraGroups filters by name prefix, escaping quotes, and sorts', async () => {
    mockListProviders.mockResolvedValue([PROVIDER])
    mockGetCreds.mockResolvedValue({ clientId: 'client', clientSecret: 's', discoveryUrl: '' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'tok' })).mockResolvedValueOnce(
      jsonResponse({
        value: [
          { id: 'g2', displayName: "Zeta O'Team" },
          { id: 'g1', displayName: 'Beta Testers' },
        ],
      })
    )

    const groups = await searchEntraGroups("O'Team")
    expect(groups.map((g) => g.displayName)).toEqual(['Beta Testers', "Zeta O'Team"])

    const groupsUrl = String(fetchMock.mock.calls[1][0])
    expect(groupsUrl).toContain('/groups?$select=id,displayName')
    // Single quote doubled per OData literal rules, then URL-encoded.
    expect(decodeURIComponent(groupsUrl)).toContain("startswith(displayName,'O''Team')")
  })

  it('searchEntraGroups maps 403 to the permission grant message', async () => {
    mockListProviders.mockResolvedValue([PROVIDER])
    mockGetCreds.mockResolvedValue({ clientId: 'client', clientSecret: 's', discoveryUrl: '' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }))
      .mockResolvedValueOnce(jsonResponse({}, 403))
    await expect(searchEntraGroups('x')).rejects.toThrow(/GroupMember\.Read\.All/)
  })

  it('propagates Graph failures instead of returning an empty list', async () => {
    // Empty-on-failure would read as "group has no members" and evict
    // the whole segment — the one outcome this accessor must prevent.
    mockListProviders.mockResolvedValue([PROVIDER])
    mockGetCreds.mockResolvedValue({ clientId: 'client', clientSecret: 's', discoveryUrl: '' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }))
      .mockResolvedValueOnce(jsonResponse({}, 403))
    await expect(getEntraGroupMemberEmails(GROUP_ID)).rejects.toThrow(/GroupMember\.Read\.All/)
  })
})
