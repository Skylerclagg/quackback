/**
 * SysAid as an issue tracker: create a service record for a post, and parse a
 * pasted reference (an SREdit URL or a bare id) into a link.
 *
 * The `auth` bag is the merged integration config + decrypted secrets:
 *   accountUrl     — https://<account>.sysaidit.com
 *   accessToken    — "username:password" of the API user
 *   channelId      — routing destination: the category (problem_type) id
 *   srType         — optional SysAid record type for the ?type= query
 *   fieldDefaults  — [{ key, value }] set on every record (urgency, group, …)
 */
import type { IssueTrackerCapability, ParsedIssueRef } from '@/lib/server/integrations/types'
import {
  createServiceRecord,
  login,
  normaliseAccountUrl,
  serviceRecordUrl,
  SysAidApiError,
  type SysAidInfoField,
} from './api'

export interface SysAidFieldDefault {
  key: string
  value: string
}

interface SysAidAuth {
  accountUrl?: string
  accessToken?: string
  channelId?: string
  srType?: string
  fieldDefaults?: SysAidFieldDefault[]
}

/** The `info` array for a new record: mapped fields, then the operator's defaults. */
export function buildRecordInfo(
  auth: SysAidAuth,
  title: string,
  description: string
): SysAidInfoField[] {
  const info: SysAidInfoField[] = [
    { key: 'title', value: title },
    { key: 'description', value: description },
  ]
  if (auth.channelId && auth.channelId !== 'default') {
    info.push({ key: 'problem_type', value: auth.channelId })
  }
  for (const f of auth.fieldDefaults ?? []) {
    const key = f.key.trim()
    if (!key || key === 'title' || key === 'description') continue
    if (info.some((i) => i.key === key)) continue
    info.push({ key, value: f.value })
  }
  return info
}

export const sysaidIssues: IssueTrackerCapability = {
  parseRef(input: string): ParsedIssueRef | null {
    const trimmed = input.trim()
    const fromUrl = /[?&]id=(\d+)/.exec(trimmed)
    const id = fromUrl?.[1] ?? /^#?(\d+)$/.exec(trimmed)?.[1] ?? null
    if (!id) return null
    return { externalId: id, externalDisplayId: `SR #${id}`, externalUrl: null }
  },

  async create({ auth, title, bodyMarkdown }) {
    const a = auth as SysAidAuth
    if (!a.accountUrl || !a.accessToken) {
      throw Object.assign(new Error('SysAid is not connected'), { retryable: false })
    }
    const baseUrl = normaliseAccountUrl(a.accountUrl)
    try {
      const session = await login(baseUrl, a.accessToken)
      const record = await createServiceRecord(
        session,
        buildRecordInfo(a, title, bodyMarkdown),
        a.srType
      )
      return {
        externalId: record.id,
        externalDisplayId: `SR #${record.id}`,
        externalUrl: serviceRecordUrl(baseUrl, record.id),
      }
    } catch (error) {
      if (error instanceof SysAidApiError) {
        throw Object.assign(new Error(error.message), { retryable: error.retryable })
      }
      throw Object.assign(
        new Error(error instanceof Error ? error.message : 'SysAid request failed'),
        {
          retryable: true,
        }
      )
    }
  },
}
