/**
 * Minimal Microsoft Graph client for reading Entra ID group membership.
 *
 * Talks to Graph over plain HTTP rather than the Graph SDK — one resource
 * type, two operations. Credentials are the workspace's own Entra OIDC
 * provider registration (identity_provider row + its platform credential),
 * exchanged for an app-only Graph token via the client-credentials grant.
 * That means zero extra configuration for the admin beyond granting the
 * existing app registration the `GroupMember.Read.All` APPLICATION
 * permission (with admin consent) in Entra.
 *
 * The token endpoint is resolved from the provider's discovery document
 * (or its manual tokenUrl), so workforce tenants (login.microsoftonline.com)
 * and External ID / CIAM tenants (*.ciamlogin.com) both work without any
 * authority hardcoding — the portal-cloud reference implementation flagged
 * that CIAM tenants use a different authority host.
 */

import { ForbiddenError, InternalError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'entra-graph' })

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default'

/** Graph pages at up to 999 users; cap pages so a pathological group can't loop forever. */
const MAX_PAGES = 100
/** Retries for a throttled (429) or 5xx page fetch. */
const MAX_ATTEMPTS = 3

/** Entra group Object IDs are GUIDs. */
export const ENTRA_GROUP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface EntraDirectoryAccess {
  tokenEndpoint: string
  clientId: string
  clientSecret: string
  /** Provider label, for error messages. */
  label: string
}

export interface EntraGroupMember {
  id: string
  displayName: string | null
  /** Primary address for display/logging; null when none resolve. */
  email: string | null
  /**
   * Every address this member could have signed in under. Matching uses
   * the whole set — see {@link resolveMemberEmails} for why one
   * attribute isn't enough.
   */
  emails: string[]
}

interface GraphUserRow {
  id?: string
  displayName?: string | null
  mail?: string | null
  userPrincipalName?: string | null
  otherMails?: string[] | null
  identities?: Array<{
    signInType?: string | null
    issuerAssignedId?: string | null
  }> | null
}

/**
 * Recover a B2B guest's real address from their synthetic UPN.
 *
 * Entra rewrites an invited user's email into the host tenant's
 * namespace by replacing `@` with `_` and appending a marker:
 *
 *   alice@contoso.com → alice_contoso.com#EXT#@host.onmicrosoft.com
 *
 * The address is therefore still in there, just mangled. Splitting on
 * the LAST underscore is unambiguous because only the `@` is rewritten
 * — dots and any underscores in the original local part survive
 * untouched, and an email domain cannot contain an underscore.
 *
 * This matters wherever a tenant invites its users rather than hosting
 * them: every member arrives as a guest, and reading only `mail` /
 * `otherMails` (frequently null for guests) resolves the whole group to
 * nothing.
 */
export function decodeExternalUpn(upn: string): string | null {
  const mangled = upn.split('#EXT#')[0]
  const split = mangled.lastIndexOf('_')
  if (split <= 0) return null
  const local = mangled.slice(0, split)
  const domain = mangled.slice(split + 1)
  // A real domain has a dot; without one this isn't the encoding we think.
  if (!local || !domain.includes('.')) return null
  return `${local}@${domain}`
}

/**
 * Every address a member could plausibly have signed in to Quackback
 * with, lowercased and deduped.
 *
 * Returning all of them rather than picking one is deliberate. The
 * directory and the app can disagree about a person's address, and
 * which side is "right" varies by tenant shape:
 *
 *  - `mail` is the canonical attribute, but is populated only for users
 *    with an Exchange Online mailbox.
 *  - The `emailAddress` sign-in identity is how self-registered
 *    External ID accounts carry theirs.
 *  - `otherMails` is where an invited guest's real address often lives.
 *  - `userPrincipalName` is the actual sign-in name in a workforce
 *    tenant, and for an invited guest it is a synthetic value that
 *    still encodes the address they were invited by.
 *
 * Meanwhile the app stores whatever the `email` claim held at sign-in,
 * which for a guest may be the external address OR the tenant-namespaced
 * one. Matching on the union means the segment resolves correctly
 * whichever pair happens to line up, instead of depending on a guess
 * about which single attribute is authoritative.
 */
export function resolveMemberEmails(row: GraphUserRow): string[] {
  const found: string[] = []
  const add = (v: unknown): void => {
    if (typeof v !== 'string') return
    const trimmed = v.trim().toLowerCase()
    // `#EXT#` values are namespace artefacts, not addresses; the decoded
    // form is added separately below.
    if (!trimmed.includes('@') || trimmed.includes('#ext#')) return
    if (!found.includes(trimmed)) found.push(trimmed)
  }

  add(row.mail)
  add(row.identities?.find((i) => i.signInType === 'emailAddress')?.issuerAssignedId)
  for (const other of row.otherMails ?? []) add(other)

  const upn = typeof row.userPrincipalName === 'string' ? row.userPrincipalName : null
  if (upn) {
    // A self-service signup gets a GUID for a UPN
    // (`<guid>@tenant.onmicrosoft.com`) — a directory handle with no
    // relationship to any address. Adding it would put a value in the
    // match list that can never match, so skip it and let `mail` or the
    // sign-in identity speak for these users.
    if (!isSyntheticUpn(upn)) add(upn)
    if (upn.includes('#EXT#')) add(decodeExternalUpn(upn))
  }

  return found
}

/** A UPN whose local part is a bare GUID identifies the directory object, not a person. */
function isSyntheticUpn(upn: string): boolean {
  return ENTRA_GROUP_ID_RE.test(upn.split('@')[0] ?? '')
}

/** Primary address for display — the first candidate, or null when none resolve. */
export function resolveMemberEmail(row: GraphUserRow): string | null {
  return resolveMemberEmails(row)[0] ?? null
}

interface GraphPage {
  value?: GraphUserRow[]
  '@odata.nextLink'?: string
}

/**
 * True when the provider row looks like an Entra tenant.
 *
 * `kind` records which EDITOR the admin used, not what the IdP actually
 * is — an Entra tenant configured through the "Custom OIDC" editor is
 * saved as kind='other' but is still Entra, and its Microsoft authority
 * URLs are the evidence that matters. So: kind='entra' is trusted,
 * kinds that name a DIFFERENT IdP family (okta/auth0/keycloak/google)
 * are rejected, and 'other'/legacy-null fall through to URL sniffing
 * across the known Microsoft authority hosts (workforce, External ID /
 * CIAM, and the v1 sts issuer).
 */
export function isEntraProvider(provider: {
  kind: string | null
  discoveryUrl: string | null
  issuer: string | null
  tokenUrl: string | null
}): boolean {
  if (provider.kind === 'entra') return true
  if (provider.kind && provider.kind !== 'other') return false
  const urls = [provider.discoveryUrl, provider.issuer, provider.tokenUrl]
  return urls.some(
    (u) =>
      !!u &&
      (u.includes('login.microsoftonline.com') ||
        u.includes('.ciamlogin.com') ||
        u.includes('sts.windows.net'))
  )
}

/**
 * Find the workspace's enabled Entra provider and assemble everything a
 * client-credentials token request needs. Returns null when no usable
 * Entra provider is registered — the UI hides the import affordance on
 * that signal rather than erroring.
 */
export async function resolveEntraDirectoryAccess(): Promise<EntraDirectoryAccess | null> {
  const { listIdentityProviders, getIdentityProviderCredentials } =
    await import('@/lib/server/domains/settings/identity-providers.service')
  const providers = await listIdentityProviders()
  const entra = providers.find((p) => p.enabled && p.configured && isEntraProvider(p))
  if (!entra) return null

  const creds = await getIdentityProviderCredentials(entra.registrationId)
  if (!creds?.clientSecret) return null

  const tokenEndpoint = await resolveTokenEndpoint(
    entra.tokenUrl,
    entra.discoveryUrl ?? creds.discoveryUrl ?? null
  )
  if (!tokenEndpoint) {
    log.warn(
      { provider: entra.registrationId },
      'entra provider has neither tokenUrl nor a resolvable discovery document'
    )
    return null
  }

  return {
    tokenEndpoint,
    clientId: entra.clientId || creds.clientId,
    clientSecret: creds.clientSecret,
    label: entra.label,
  }
}

async function resolveTokenEndpoint(
  tokenUrl: string | null,
  discoveryUrl: string | null
): Promise<string | null> {
  if (tokenUrl) return tokenUrl
  if (!discoveryUrl) return null
  try {
    const res = await fetch(discoveryUrl)
    if (!res.ok) return null
    const doc = (await res.json()) as { token_endpoint?: string }
    return doc.token_endpoint ?? null
  } catch (error) {
    log.warn({ err: error }, 'entra discovery document fetch failed')
    return null
  }
}

/**
 * App-only Graph token via the client-credentials grant.
 *
 * The most common failure by far is the app registration lacking Graph
 * application permissions, so that case gets a message telling the admin
 * exactly what to grant instead of an opaque AADSTS code.
 */
export async function getGraphToken(access: EntraDirectoryAccess): Promise<string> {
  const res = await fetch(access.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: access.clientId,
      client_secret: access.clientSecret,
      scope: GRAPH_SCOPE,
    }),
  })

  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error?: string
    error_description?: string
  }

  if (!res.ok || !body.access_token) {
    const description = body.error_description ?? body.error ?? `HTTP ${res.status}`
    log.warn({ error: body.error, status: res.status }, 'entra graph token request failed')
    if (body.error === 'invalid_client') {
      throw new ForbiddenError(
        'ENTRA_GRAPH_AUTH_FAILED',
        `Entra rejected the "${access.label}" app credentials. The client secret may have expired — update it in the SSO provider settings.`
      )
    }
    throw new InternalError(
      'ENTRA_GRAPH_AUTH_FAILED',
      `Could not get a Graph token: ${description}`
    )
  }

  return body.access_token
}

/**
 * All direct members of a group, followed to the last page — a page size
 * is not a member count, and a truncated list would silently misreport
 * who got imported. Non-user member objects (nested groups, devices)
 * come back without mail/identities and surface as `email: null`; the
 * caller reports them rather than this layer guessing.
 */
export async function listEntraGroupMembers(
  token: string,
  groupId: string
): Promise<EntraGroupMember[]> {
  if (!ENTRA_GROUP_ID_RE.test(groupId)) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Group ID must be the group’s Object ID (a GUID) from Entra.'
    )
  }

  const members: EntraGroupMember[] = []
  let url: string | null =
    `${GRAPH_BASE}/groups/${encodeURIComponent(groupId)}/members/microsoft.graph.user` +
    `?$select=id,displayName,mail,userPrincipalName,otherMails,identities&$top=999`
  // The `/microsoft.graph.user` cast restricts a polymorphic
  // directoryObject collection to user objects, so nested groups,
  // devices and service principals are dropped server-side instead of
  // arriving as members with no address, and the $select applies to a
  // single known type.

  for (let page = 0; url !== null; page++) {
    if (page >= MAX_PAGES) {
      log.warn({ group_id: groupId, pages: page }, 'entra group paging cap hit; truncating')
      break
    }
    const data = await fetchGraphPage(token, url, groupId)
    for (const row of data.value ?? []) {
      if (!row.id) continue
      members.push({
        id: row.id,
        displayName: row.displayName ?? null,
        email: resolveMemberEmail(row),
        emails: resolveMemberEmails(row),
      })
    }
    url = data['@odata.nextLink'] ?? null
  }

  return members
}

// ============================================================================
// Cached group-email lookup — the segment evaluator's entry point
// ============================================================================

/**
 * Short TTL: long enough that a burst of per-principal evaluations (a
 * team signing in at 9am) hits Graph once per group, short enough that
 * the hourly scheduled sweep always sees fresh membership.
 */
const GROUP_CACHE_TTL_MS = 5 * 60 * 1000

interface CachedEmails {
  emails: string[]
  expiresAt: number
}

const groupEmailCache = new Map<string, CachedEmails>()
let tokenCache: { token: string; expiresAt: number } | null = null

/** Test hook — clears both caches. */
export function __clearEntraCaches(): void {
  groupEmailCache.clear()
  tokenCache = null
}

async function getCachedGraphToken(access: EntraDirectoryAccess): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token
  const token = await getGraphToken(access)
  // Client-credentials tokens live ~1h; refresh well before expiry. The
  // token response's expires_in isn't threaded through getGraphToken to
  // keep its error mapping simple — 30 min is safely inside any tenant
  // policy's floor.
  tokenCache = { token, expiresAt: Date.now() + 30 * 60 * 1000 }
  return token
}

/**
 * Lower-cased emails of a group's members, cached briefly.
 *
 * THROWS on any failure — no Entra provider, expired secret, missing
 * Graph permission, unknown group, Graph outage. Callers evaluating
 * segment membership must let that propagate: swallowing it into an
 * empty list would read as "the group has no members" and remove
 * everyone from the segment on the next sweep. Failures are never
 * cached, so the next evaluation retries.
 */
export async function getEntraGroupMemberEmails(groupId: string): Promise<string[]> {
  const cached = groupEmailCache.get(groupId)
  if (cached && cached.expiresAt > Date.now()) return cached.emails

  const access = await resolveEntraDirectoryAccess()
  if (!access) {
    throw new ValidationError(
      'ENTRA_NOT_CONFIGURED',
      'This segment has an Entra group rule, but no enabled Entra identity provider is configured.'
    )
  }

  const token = await getCachedGraphToken(access)
  const members = await listEntraGroupMembers(token, groupId)
  // Union of every candidate address, not one per member: the app may
  // have stored any of the forms the directory exposes.
  const emails = [...new Set(members.flatMap((m) => m.emails))]

  // A group with members but no resolvable addresses matches nobody, and
  // does so silently — the segment just stays empty with no error. That
  // is the hardest shape of this feature to debug from the outside, so
  // say it plainly in the logs.
  const withAddress = members.filter((m) => m.emails.length > 0).length
  if (members.length > 0 && emails.length === 0) {
    log.warn(
      { group_id: groupId, member_count: members.length },
      'entra group has members but none expose a usable email — segment will match nobody'
    )
  } else if (withAddress < members.length) {
    log.info(
      { group_id: groupId, resolved: withAddress, total: members.length },
      'some entra group members have no usable email (nested groups, devices, or no mail/UPN)'
    )
  }

  groupEmailCache.set(groupId, { emails, expiresAt: Date.now() + GROUP_CACHE_TTL_MS })
  return emails
}

export interface EntraGroupSummary {
  id: string
  displayName: string
}

/**
 * Name-prefix search over the tenant's groups, for the rule-builder
 * dropdown. Uses `startswith` rather than `$search` so no
 * ConsistencyLevel header / advanced-query support is needed, and needs
 * no permission beyond the GroupMember.Read.All the membership fetch
 * already requires ("List groups" accepts it as least-privileged).
 * An empty query returns the first page so the picker isn't blank
 * before the admin types.
 */
export async function searchEntraGroups(query: string): Promise<EntraGroupSummary[]> {
  const access = await resolveEntraDirectoryAccess()
  if (!access) {
    throw new ValidationError(
      'ENTRA_NOT_CONFIGURED',
      'No enabled Entra identity provider is configured.'
    )
  }
  const token = await getCachedGraphToken(access)

  const trimmed = query.trim()
  // OData string literal: double any single quote so it can't end the literal.
  const filter = trimmed
    ? `&$filter=${encodeURIComponent(`startswith(displayName,'${trimmed.replace(/'/g, "''")}')`)}`
    : ''
  const url = `${GRAPH_BASE}/groups?$select=id,displayName&$top=20${filter}`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 403 || res.status === 401) {
    throw new ForbiddenError(
      'ENTRA_GRAPH_FORBIDDEN',
      'Graph refused to list groups. Grant the app registration the "GroupMember.Read.All" application permission (with admin consent) in Entra.'
    )
  }
  if (!res.ok) {
    log.warn({ status: res.status }, 'entra group search failed')
    throw new InternalError(
      'ENTRA_GRAPH_ERROR',
      `Graph returned ${res.status} while listing groups.`
    )
  }

  const page = (await res.json()) as { value?: Array<{ id?: string; displayName?: string | null }> }
  return (page.value ?? [])
    .filter((g): g is { id: string; displayName: string | null } => !!g.id)
    .map((g) => ({ id: g.id, displayName: g.displayName ?? g.id }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

async function fetchGraphPage(token: string, url: string, groupId: string): Promise<GraphPage> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

    if (res.ok) {
      return (await res.json()) as GraphPage
    }

    if (res.status === 404) {
      throw new NotFoundError(
        'ENTRA_GROUP_NOT_FOUND',
        'No Entra group with that Object ID was found in the tenant.'
      )
    }
    if (res.status === 403 || res.status === 401) {
      // Graph names this Authorization_RequestDenied; the fix is always
      // the same grant, so say that instead of echoing the code.
      throw new ForbiddenError(
        'ENTRA_GRAPH_FORBIDDEN',
        'Graph refused to list the group. Grant the app registration the "GroupMember.Read.All" application permission (with admin consent) in Entra.'
      )
    }

    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      log.warn({ status: res.status, group_id: groupId }, 'entra graph member page failed')
      throw new InternalError(
        'ENTRA_GRAPH_ERROR',
        `Graph returned ${res.status} while listing group members.`
      )
    }

    // Back off before retrying — an immediate repeat of a throttled
    // request is what caused the throttling. Honor Retry-After when sent.
    const retryAfter = Number(res.headers.get('retry-after'))
    const delayMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** (attempt - 1) * 1000
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}
