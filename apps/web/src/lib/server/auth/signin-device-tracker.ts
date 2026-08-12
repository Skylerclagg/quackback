/**
 * Per-user device-fingerprint tracker. Redis SET
 * `user:devices:{userId}` holds the recent (UA + /24 IP) hashes seen
 * for the user; new-device notifications fire only on first-sight.
 *
 * Two-phase API so notification failures don't silently lose the
 * alert: `isDeviceUnseen` atomically claims the fingerprint via SADD;
 * the caller follows with `markDeviceSeen` on success or
 * `forgetDevice` on failure. Errors fail closed (treat as known
 * device) so a Redis outage suppresses notifications rather than
 * spamming users.
 */
import { createHash } from 'node:crypto'
import { getRedis } from '@/lib/server/redis'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'signin-device-tracker' })

const DEVICE_SET_TTL_SECONDS = 90 * 24 * 60 * 60

/**
 * Normalise an address to the part that identifies a *network* rather
 * than a single connection, so a user on one network keeps one
 * fingerprint:
 *
 *  - IPv4 → /24. Covers dynamic-IP reassignment within an ISP block.
 *  - IPv6 → /64 (first four hextets). The interface identifier (the
 *    low 64 bits) is deliberately unstable: RFC 8981 privacy
 *    extensions rotate it on a timer, often daily, and some stacks
 *    rotate per connection. Hashing the full address therefore
 *    produced a brand-new fingerprint for the same user on the same
 *    network, which fired a "new sign-in" alert on virtually every
 *    sign-in for anyone on IPv6 — the exact alert fatigue these
 *    notifications are meant to avoid.
 *
 * Compressed forms ("2001:db8::1") are expanded before truncating so
 * "2001:db8::1" and "2001:0db8:0000:0000::5" land in the same /64.
 */
function normaliseIpForFingerprint(ip: string): string {
  if (!ip.includes(':')) {
    return ip.split('.').slice(0, 3).join('.')
  }

  // Strip a zone index ("fe80::1%eth0").
  const bare = ip.split('%')[0]

  // IPv4-mapped ("::ffff:203.0.113.7") — some proxies report client
  // IPv4 this way. Treat as IPv4 or the /64 truncation would discard
  // the embedded address entirely and collapse every such client onto
  // one shared fingerprint, silencing the alert for all of them.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare)
  if (mapped) {
    return mapped[1].split('.').slice(0, 3).join('.')
  }

  const [head, tail = ''] = bare.split('::')
  const headParts = head ? head.split(':').filter(Boolean) : []
  const tailParts = tail ? tail.split(':').filter(Boolean) : []

  let hextets: string[]
  if (bare.includes('::')) {
    const missing = Math.max(0, 8 - headParts.length - tailParts.length)
    hextets = [...headParts, ...Array<string>(missing).fill('0'), ...tailParts]
  } else {
    hextets = headParts
  }

  // Pad short input rather than over-truncating an already-short address.
  while (hextets.length < 4) hextets.push('0')
  return hextets
    .slice(0, 4)
    .map((h) => h.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')
}

/**
 * SHA-256 of (UA + network-scoped IP) truncated to 128 bits / 32 hex
 * chars. See {@link normaliseIpForFingerprint} for why the address is
 * reduced to its network prefix first.
 */
export function computeDeviceFingerprint(userAgent: string, ip: string): string {
  const normalisedIp = normaliseIpForFingerprint(ip)
  return createHash('sha256').update(`${userAgent}|${normalisedIp}`).digest('hex').slice(0, 32)
}

const key = (userId: string) => `user:devices:${userId}`

/**
 * Atomic claim: returns true iff this is the first sighting (SADD
 * reply = 1). SADD + EXPIRE NX run in one pipeline so the TTL is
 * always set on first claim — even if the caller crashes before
 * `markDeviceSeen` runs, the SET still expires after 90 days.
 */
export async function isDeviceUnseen(userId: string, fingerprint: string): Promise<boolean> {
  try {
    const pipeline = getRedis().multi()
    pipeline.sadd(key(userId), fingerprint)
    pipeline.expire(key(userId), DEVICE_SET_TTL_SECONDS, 'NX')
    const results = await pipeline.exec()
    return Number(results?.[0]?.[1] ?? 0) === 1
  } catch (error) {
    log.error({ err: error }, 'isDeviceUnseen failed; treating device as known')
    return false
  }
}

/** Slide the 90-day window forward after a successful notification. */
export async function markDeviceSeen(userId: string): Promise<void> {
  try {
    await getRedis().expire(key(userId), DEVICE_SET_TTL_SECONDS)
  } catch (error) {
    log.error({ err: error }, 'markDeviceSeen failed')
  }
}

/** Roll back a claim so the next sign-in re-fires the notification. */
export async function forgetDevice(userId: string, fingerprint: string): Promise<void> {
  try {
    await getRedis().srem(key(userId), fingerprint)
  } catch (error) {
    log.error({ err: error }, 'forgetDevice failed')
  }
}
