/**
 * Status sync from SysAid → Quackback.
 *
 * SysAid has no signed webhooks; an escalation rule (or automation) sends an
 * HTTP request to Quackback's inbound URL. Authenticity is a shared secret
 * carried in the `X-Webhook-Secret` header or the `secret` query parameter —
 * the same secret the settings page shows next to the URL. The payload is
 * whatever the rule was configured to send; the parser accepts the common
 * spellings of "record id" and "status" so the SysAid side stays simple.
 */
import { timingSafeEqual } from 'crypto'
import type {
  InboundWebhookHandler,
  InboundWebhookResult,
} from '@/lib/server/integrations/inbound-types'

const ID_KEYS = ['id', 'sr_id', 'srId', 'ticket_id', 'ServiceRecordID', 'service_record_id']
const STATUS_KEYS = ['status', 'status_caption', 'statusCaption', 'Status', 'new_status']

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Pull the record id and status out of a JSON body or a form body. Exported for tests. */
export function parseSysAidStatusPayload(body: string): { id: string; status: string } | null {
  let fields: Record<string, unknown> = {}
  const trimmed = body.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object') {
      fields = parsed as Record<string, unknown>
      // SysAid's own record shape: { id, info: [{ key, value }] }
      const info = (fields as { info?: Array<{ key?: string; value?: unknown }> }).info
      if (Array.isArray(info)) {
        for (const f of info) if (f?.key) fields[f.key] = f.value
      }
    }
  } catch {
    fields = Object.fromEntries(new URLSearchParams(trimmed).entries())
  }
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const v = fields[k]
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
    }
    return undefined
  }
  const id = pick(ID_KEYS)
  const status = pick(STATUS_KEYS)
  if (!id || !status) return null
  return { id, status }
}

export const sysaidInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, _body: string, secret: string): Promise<true | Response> {
    const url = new URL(request.url)
    const provided =
      request.headers.get('X-Webhook-Secret') ??
      request.headers.get('X-Quackback-Secret') ??
      url.searchParams.get('secret')
    if (!provided) return new Response('Missing webhook secret', { status: 401 })
    if (!constantTimeEqual(provided, secret))
      return new Response('Invalid webhook secret', { status: 401 })
    return true
  },

  async parseStatusChange(body: string): Promise<InboundWebhookResult | null> {
    const parsed = parseSysAidStatusPayload(body)
    if (!parsed) return null
    return { externalId: parsed.id, externalStatus: parsed.status, eventType: 'sr.status_changed' }
  },
}
