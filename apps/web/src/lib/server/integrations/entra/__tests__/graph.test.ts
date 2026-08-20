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
  resolveMemberEmail,
  resolveMemberEmails,
  decodeExternalUpn,
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

  it("accepts a 'Custom OIDC' (kind=other) provider whose URLs are Microsoft authorities", () => {
    // An Entra tenant configured through the Custom OIDC editor is
    // saved as kind='other' — the editor choice must not veto the URL
    // evidence.
    expect(
      isEntraProvider({
        kind: 'other',
        discoveryUrl:
          'https://login.microsoftonline.com/tenant-guid/v2.0/.well-known/openid-configuration',
        issuer: null,
        tokenUrl: null,
      })
    ).toBe(true)
    // A custom OIDC pointing somewhere non-Microsoft stays rejected.
    expect(
      isEntraProvider({
        kind: 'other',
        discoveryUrl: 'https://id.example.com/.well-known/openid-configuration',
        issuer: null,
        tokenUrl: null,
      })
    ).toBe(false)
  })

  it('recognises the v1 sts.windows.net issuer on manual-endpoint installs', () => {
    expect(
      isEntraProvider({
        kind: null,
        discoveryUrl: null,
        issuer: 'https://sts.windows.net/tenant-guid/',
        tokenUrl: null,
      })
    ).toBe(true)
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

describe('resolveMemberEmail — workforce vs external tenants', () => {
  it('prefers mail when present', () => {
    expect(resolveMemberEmail({ mail: 'a@x.com', userPrincipalName: 'upn@x.com' })).toBe('a@x.com')
  })

  // The regression this pins: in a workforce tenant `mail` is populated
  // only for mailbox-holders, so a large share of real users arrive with
  // mail=null. Without the UPN fallback they resolved to null, dropped
  // out of the email list, and the segment matched nobody.
  it('falls back to userPrincipalName when the user has no mailbox', () => {
    expect(resolveMemberEmail({ mail: null, userPrincipalName: 'nomailbox@x.com' })).toBe(
      'nomailbox@x.com'
    )
  })

  it('prefers the emailAddress identity over the UPN', () => {
    expect(
      resolveMemberEmail({
        mail: null,
        userPrincipalName: 'upn@x.com',
        identities: [{ signInType: 'emailAddress', issuerAssignedId: 'real@x.com' }],
      })
    ).toBe('real@x.com')
  })

  it('uses otherMails for a guest before falling to their synthetic UPN', () => {
    expect(
      resolveMemberEmail({
        mail: null,
        otherMails: ['guest@contoso.com'],
        userPrincipalName: 'guest_contoso.com#EXT#@tenant.onmicrosoft.com',
      })
    ).toBe('guest@contoso.com')
  })

  it('decodes a guest UPN rather than discarding it', () => {
    // The raw #EXT# value is never usable, but it still encodes the
    // address the person was invited by — which is what the app is
    // likely to have stored.
    expect(
      resolveMemberEmail({
        mail: null,
        userPrincipalName: 'guest_contoso.com#EXT#@tenant.onmicrosoft.com',
      })
    ).toBe('guest@contoso.com')
  })

  it('returns null for a member object with no address at all', () => {
    expect(resolveMemberEmail({ displayName: 'Nested group' })).toBeNull()
  })

  it('ignores values that are not addresses', () => {
    expect(resolveMemberEmail({ mail: 'not-an-email', userPrincipalName: null })).toBeNull()
  })
})

describe('resolveMemberEmails — union matching', () => {
  it('returns every distinct address a member could have signed in under', () => {
    expect(
      resolveMemberEmails({
        mail: 'Primary@X.com',
        otherMails: ['alt@x.com'],
        userPrincipalName: 'upn@x.com',
      })
    ).toEqual(['primary@x.com', 'alt@x.com', 'upn@x.com'])
  })

  // Self-service signups get `<guid>@tenant.onmicrosoft.com` for a UPN.
  // It can never match a stored address, so it must not enter the list.
  it('drops a GUID UPN while keeping the real address', () => {
    expect(
      resolveMemberEmails({
        mail: null,
        userPrincipalName: 'dfc434ff-3409-4375-a148-c786d196eb32@tenant.onmicrosoft.com',
        identities: [{ signInType: 'emailAddress', issuerAssignedId: 'real@x.com' }],
      })
    ).toEqual(['real@x.com'])
  })

  it('includes both the raw mail and the decoded guest address', () => {
    expect(
      resolveMemberEmails({
        mail: 'invited@contoso.com',
        userPrincipalName: 'alice_contoso.com#EXT#@tenant.onmicrosoft.com',
      })
    ).toEqual(['invited@contoso.com', 'alice@contoso.com'])
  })

  it('never emits a raw #EXT# value', () => {
    const emails = resolveMemberEmails({
      userPrincipalName: 'alice_contoso.com#EXT#@tenant.onmicrosoft.com',
    })
    expect(emails.some((e) => e.includes('#ext#'))).toBe(false)
    expect(emails).toContain('alice@contoso.com')
  })

  it('is empty for a member with no usable address', () => {
    expect(resolveMemberEmails({ displayName: 'Device' })).toEqual([])
  })
})

describe('decodeExternalUpn', () => {
  it('splits on the last underscore so the local part keeps its own', () => {
    expect(decodeExternalUpn('first_last_example.org#EXT#@tenant.onmicrosoft.com')).toBe(
      'first_last@example.org'
    )
  })

  it('preserves dots in the local part', () => {
    expect(decodeExternalUpn('first.last_example.org#EXT#@tenant.onmicrosoft.com')).toBe(
      'first.last@example.org'
    )
  })

  it('returns null when the shape is not the guest encoding', () => {
    expect(decodeExternalUpn('nounderscore#EXT#@tenant.onmicrosoft.com')).toBeNull()
    expect(decodeExternalUpn('_leading#EXT#@tenant.onmicrosoft.com')).toBeNull()
    // No dot in the would-be domain -> not the encoding.
    expect(decodeExternalUpn('alice_localhost#EXT#@tenant.onmicrosoft.com')).toBeNull()
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
    expect(members[0].emails).toContain('real@x.com')
  })

  it('reports null email for non-user member objects (nested groups, devices)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ value: [{ id: 'g1', displayName: 'Nested group' }] })
    )
    const members = await listEntraGroupMembers('tok', GROUP_ID)
    expect(members[0].email).toBeNull()
    expect(members[0].emails).toEqual([])
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

describe('members returned without readable properties', () => {
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

  /**
   * The exact payload a missing user-read grant produces: HTTP 200, the
   * right member count, correct ids — and every other property nulled.
   * It reads as "these people have no email", which sends you auditing
   * directory attributes for a problem that is entirely on the app
   * registration.
   */
  const HIDDEN_MEMBERS = [
    {
      id: '12d67271-c617-4e27-b75b-deff9cd2f206',
      displayName: null,
      mail: null,
      userPrincipalName: null,
      otherMails: [],
      identities: [],
    },
    {
      id: 'e8f831e8-fb58-4ce0-a404-25fbb612918c',
      displayName: null,
      mail: null,
      userPrincipalName: null,
      otherMails: [],
      identities: [],
    },
  ]

  it('refuses rather than reporting an empty group', async () => {
    mockListProviders.mockResolvedValue([PROVIDER])
    mockGetCreds.mockResolvedValue({ clientId: 'client', clientSecret: 's', discoveryUrl: '' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }))
      .mockResolvedValueOnce(jsonResponse({ value: HIDDEN_MEMBERS }))

    // Compiling this as "no members" would evict everyone currently in
    // the segment on the next sweep, on the strength of a permission gap.
    await expect(getEntraGroupMemberEmails(GROUP_ID)).rejects.toThrow(/User\.Read\.All/)
  })

  it('still resolves normally when properties ARE readable', async () => {
    mockListProviders.mockResolvedValue([PROVIDER])
    mockGetCreds.mockResolvedValue({ clientId: 'client', clientSecret: 's', discoveryUrl: '' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }))
      .mockResolvedValueOnce(
        jsonResponse({ value: [{ id: 'u1', displayName: 'A', mail: 'a@x.com' }] })
      )

    await expect(getEntraGroupMemberEmails(GROUP_ID)).resolves.toEqual(['a@x.com'])
  })

  it('a genuinely empty group is not mistaken for hidden properties', async () => {
    mockListProviders.mockResolvedValue([PROVIDER])
    mockGetCreds.mockResolvedValue({ clientId: 'client', clientSecret: 's', discoveryUrl: '' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok' }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }))

    await expect(getEntraGroupMemberEmails(GROUP_ID)).resolves.toEqual([])
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
