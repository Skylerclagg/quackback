/**
 * Minimal SysAid REST API v1 client.
 *
 * SysAid authenticates with a session: POST /api/v1/login with an API user's
 * credentials returns a JSESSIONID cookie that every later call must carry.
 * Quackback stores the credentials encrypted as the integration's
 * `accessToken` in the form `username:password` (the same slot OAuth tokens
 * use) and logs in per operation — a service record is created rarely enough
 * that keeping a session alive buys nothing and complicates expiry.
 *
 * Every field on a service record travels as an `info` entry: `{ key, value }`.
 * Lists (statuses, urgencies, categories, …) come from /api/v1/list/<name>.
 */

export interface SysAidSession {
  baseUrl: string
  cookie: string
}

export interface SysAidListValue {
  id: string
  caption: string
}

export interface SysAidInfoField {
  key: string
  value: string | number
}

export interface SysAidServiceRecord {
  id: string
  info: SysAidInfoField[]
}

export class SysAidApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'SysAidApiError'
  }
}

/** `https://recf.sysaidit.com/` → `https://recf.sysaidit.com` (https enforced). */
export function normaliseAccountUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withScheme)
  if (url.protocol !== 'https:') url.protocol = 'https:'
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

/** The stored access token is `username:password`; passwords may contain colons. */
export function splitCredentials(accessToken: string): { username: string; password: string } {
  const idx = accessToken.indexOf(':')
  if (idx <= 0) throw new SysAidApiError('SysAid credentials are not configured', 401, false)
  return { username: accessToken.slice(0, idx), password: accessToken.slice(idx + 1) }
}

/** Where a person opens a service record in SysAid's UI. */
export function serviceRecordUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/SREdit.jsp?id=${encodeURIComponent(id)}`
}

function classify(status: number): boolean {
  return status === 429 || status >= 500
}

export async function login(baseUrl: string, accessToken: string): Promise<SysAidSession> {
  const { username, password } = splitCredentials(accessToken)
  const res = await fetch(`${baseUrl}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ user_name: username, password }),
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new SysAidApiError(
        'SysAid rejected the API user credentials. Check the username and password in the integration settings.',
        res.status,
        false
      )
    }
    throw new SysAidApiError(
      `SysAid login failed: HTTP ${res.status}`,
      res.status,
      classify(res.status)
    )
  }
  // Session cookies arrive on the login response; keep every cookie SysAid set.
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? ''].filter(Boolean)
  const cookie = setCookies
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ')
  if (!cookie) throw new SysAidApiError('SysAid login returned no session cookie', 502, true)
  return { baseUrl, cookie }
}

async function request<T>(
  session: SysAidSession,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${session.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new SysAidApiError(
      `SysAid ${init.method ?? 'GET'} ${path} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      res.status,
      classify(res.status)
    )
  }
  return (await res.json()) as T
}

/** Values of a SysAid list, e.g. `status`, `urgency`, `priority`, `problem_type`, `sr_type`. */
export async function listValues(
  session: SysAidSession,
  listName: string
): Promise<SysAidListValue[]> {
  const data = await request<{
    values?: Array<{ id: string | number; caption?: string; value?: string }>
  }>(session, `/api/v1/list/${encodeURIComponent(listName)}`)
  return (data.values ?? []).map((v) => ({
    id: String(v.id),
    caption: v.caption ?? v.value ?? String(v.id),
  }))
}

export async function createServiceRecord(
  session: SysAidSession,
  info: SysAidInfoField[],
  srType?: string
): Promise<SysAidServiceRecord> {
  const query = srType ? `?type=${encodeURIComponent(srType)}` : ''
  const data = await request<{ id: string | number; info?: SysAidInfoField[] }>(
    session,
    `/api/v1/sr${query}`,
    {
      method: 'POST',
      body: JSON.stringify({ info }),
    }
  )
  return { id: String(data.id), info: data.info ?? info }
}

export async function getServiceRecord(
  session: SysAidSession,
  id: string
): Promise<SysAidServiceRecord> {
  const data = await request<{ id: string | number; info?: SysAidInfoField[] }>(
    session,
    `/api/v1/sr/${encodeURIComponent(id)}`
  )
  return { id: String(data.id), info: data.info ?? [] }
}

/** Read one field off a record's `info` array. */
export function infoValue(record: SysAidServiceRecord, key: string): string | undefined {
  const field = record.info.find((f) => f.key === key)
  return field === undefined ? undefined : String(field.value)
}
