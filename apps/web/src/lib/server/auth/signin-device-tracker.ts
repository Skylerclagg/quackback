/**
 * Per-user device-fingerprint tracker. The set `user:devices:{userId}` holds the
 * recent (UA + /24 IP) hashes seen for the user; new-device notifications fire
 * only on first-sight.
 *
 * Two-phase API so notification failures don't silently lose the
 * alert: `isDeviceUnseen` atomically claims the fingerprint in one
 * statement; the caller follows with `markDeviceSeen` on success or
 * `forgetDevice` on failure. Errors fail closed (treat as known
 * device) so a store outage suppresses notifications rather than
 * spamming users.
 */
import { createHash } from 'node:crypto'
import { kvSetMemberClaim, kvSetTouch, kvSetMemberRemove } from '@/lib/server/kv/pg-kv'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'signin-device-tracker' })

const DEVICE_SET_TTL_SECONDS = 90 * 24 * 60 * 60

/**
 * Reduce a User-Agent to the identity of the DEVICE, discarding the parts that
 * change on their own.
 *
 * The fingerprint used to hash the raw User-Agent, so every browser update
 * minted a new "device" and emailed the user a security alert. Real data from
 * one account: three alerts from the same Mac on the same network, differing
 * only by `Version/26.5.2` → `26.4` → `26.6`. Multiply by however many networks
 * that person uses and the alert fires often enough that people learn to ignore
 * it — which costs more security than the alert buys.
 *
 * Browser family + OS family is the stable part. The version is deliberately
 * excluded entirely, major included: Chrome ships a major roughly monthly, so
 * keeping it would still mean ~12 alerts per device per year, and no attacker
 * is ever identified by a browser version. Replaying this workspace's real
 * history, including the major took one account from 21 alerts to 4; excluding
 * it takes the same account to 3, one per device it actually uses.
 */
export function normaliseUserAgentForFingerprint(userAgent: string): string {
  const ua = userAgent.trim()
  if (!ua) return 'unknown|unknown'

  const os = /Windows NT/i.test(ua)
    ? 'windows'
    : /iPhone|iPad|iPod|iOS/i.test(ua)
      ? 'ios'
      : /Android/i.test(ua)
        ? 'android'
        : /Macintosh|Mac OS X/i.test(ua)
          ? 'macos'
          : /CrOS/i.test(ua)
            ? 'chromeos'
            : /Linux/i.test(ua)
              ? 'linux'
              : 'other'

  // Order matters: Edge and Opera both advertise Chrome, and every WebKit
  // browser advertises Safari. Most specific first.
  const browsers: Array<[string, RegExp]> = [
    ['edge', /Edg(?:e|A|iOS)?\/(\d+)/i],
    ['opera', /OPR\/(\d+)/i],
    ['firefox', /(?:Firefox|FxiOS)\/(\d+)/i],
    ['chrome', /(?:Chrome|CriOS)\/(\d+)/i],
    ['safari', /Version\/(\d+)[\d.]*\s+(?:Mobile\/\S+\s+)?Safari/i],
  ]
  for (const [name, pattern] of browsers) {
    const match = pattern.exec(ua)
    if (match) return `${name}|${os}`
  }
  return `other|${os}`
}

/**
 * SHA-256 of the normalised device identity, truncated to 128 bits / 32 hex.
 *
 * Deliberately NOT keyed on the client's address. Keying on (device, network)
 * meant one alert per network a person used: an account in this workspace
 * accumulated 12 alerts across 12 distinct IPs, which is a travel log, not a
 * security signal. This alert answers "is this a browser you have not signed in
 * from before" — location changes are not what it reports.
 */
export function computeDeviceFingerprint(userAgent: string): string {
  return createHash('sha256')
    .update(normaliseUserAgentForFingerprint(userAgent))
    .digest('hex')
    .slice(0, 32)
}

const key = (userId: string) => `user:devices:${userId}`

/**
 * Atomic claim: returns true iff this is the first sighting. One statement, so
 * the claim and the expiry cannot separate — even if the caller crashes before
 * `markDeviceSeen` runs, the member still expires after 90 days.
 */
export async function isDeviceUnseen(userId: string, fingerprint: string): Promise<boolean> {
  try {
    return await kvSetMemberClaim(key(userId), fingerprint, DEVICE_SET_TTL_SECONDS)
  } catch (error) {
    log.error({ err: error }, 'isDeviceUnseen failed; treating device as known')
    return false
  }
}

/** Slide the 90-day window forward after a successful notification. */
export async function markDeviceSeen(userId: string): Promise<void> {
  try {
    await kvSetTouch(key(userId), DEVICE_SET_TTL_SECONDS)
  } catch (error) {
    log.error({ err: error }, 'markDeviceSeen failed')
  }
}

/** Roll back a claim so the next sign-in re-fires the notification. */
export async function forgetDevice(userId: string, fingerprint: string): Promise<void> {
  try {
    await kvSetMemberRemove(key(userId), fingerprint)
  } catch (error) {
    log.error({ err: error }, 'forgetDevice failed')
  }
}
