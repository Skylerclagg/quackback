/**
 * Tests for the device-fingerprint tracker. Two-phase API (isDeviceUnseen →
 * markDeviceSeen | forgetDevice) so notification failures can roll back the
 * claim and re-fire on the next sign-in.
 *
 * The tracker's subject is that two-phase protocol, so the set primitives it
 * delegates to (`kv/pg-kv.ts`) are stubbed here. Their own guarantees — one
 * statement per claim, and the workspace discriminator on every row — are proved
 * against a real database in `kv/__tests__/pg-kv-semantics.db.test.ts` and
 * `kv/__tests__/workspace-separation.db.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockClaim = vi.fn()
const mockTouch = vi.fn()
const mockRemove = vi.fn()

vi.mock('@/lib/server/kv/pg-kv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/kv/pg-kv')>()),
  kvSetMemberClaim: mockClaim,
  kvSetTouch: mockTouch,
  kvSetMemberRemove: mockRemove,
}))

const {
  computeDeviceFingerprint,
  normaliseUserAgentForFingerprint,
  isDeviceUnseen,
  markDeviceSeen,
  forgetDevice,
} = await import('../signin-device-tracker')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('computeDeviceFingerprint', () => {
  const SAFARI_26_6 =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15'
  const SAFARI_26_5_2 =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Safari/605.1.15'
  const CHROME_WIN =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

  it('returns 32-char hex', () => {
    expect(computeDeviceFingerprint(SAFARI_26_6)).toMatch(/^[0-9a-f]{32}$/)
  })

  // The defect this function exists to avoid. These three real User-Agents were
  // recorded for one account, on one Mac, on one network, and produced three
  // separate "new device" security emails.
  it('is stable across a browser PATCH update', () => {
    expect(computeDeviceFingerprint(SAFARI_26_6)).toBe(computeDeviceFingerprint(SAFARI_26_5_2))
  })

  it('is stable across a MAJOR version bump too', () => {
    // Chrome ships a major every few weeks; alerting on that is pure noise.
    expect(computeDeviceFingerprint(SAFARI_26_6)).toBe(
      computeDeviceFingerprint(SAFARI_26_6.replace('Version/26.6', 'Version/27.0'))
    )
  })

  it('distinguishes different browsers and different operating systems', () => {
    expect(computeDeviceFingerprint(SAFARI_26_6)).not.toBe(computeDeviceFingerprint(CHROME_WIN))
    expect(computeDeviceFingerprint(CHROME_WIN)).not.toBe(
      computeDeviceFingerprint(
        CHROME_WIN.replace('Windows NT 10.0; Win64; x64', 'X11; Linux x86_64')
      )
    )
  })

  it('handles an absent User-Agent without throwing', () => {
    expect(computeDeviceFingerprint('')).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('normaliseUserAgentForFingerprint', () => {
  it('identifies the common browser families by major version', () => {
    expect(
      normaliseUserAgentForFingerprint(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
      )
    ).toBe('chrome|windows')
    expect(
      normaliseUserAgentForFingerprint(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15'
      )
    ).toBe('safari|macos')
    expect(
      normaliseUserAgentForFingerprint(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1'
      )
    ).toBe('safari|ios')
  })

  // Edge and Opera both advertise Chrome, and every WebKit browser advertises
  // Safari, so the match order is load-bearing rather than stylistic.
  it('does not mistake Edge or Opera for Chrome', () => {
    expect(
      normaliseUserAgentForFingerprint(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'
      )
    ).toBe('edge|windows')
    expect(
      normaliseUserAgentForFingerprint(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/120.0.0.0'
      )
    ).toBe('opera|windows')
  })

  it('falls back rather than throwing on junk', () => {
    expect(normaliseUserAgentForFingerprint('')).toBe('unknown|unknown')
    expect(normaliseUserAgentForFingerprint('curl/8.4.0')).toBe('other|other')
  })
})
describe('isDeviceUnseen', () => {
  it('returns true when the claim takes the member', async () => {
    mockClaim.mockResolvedValueOnce(true)
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(true)
  })

  it('returns false when the member was already present', async () => {
    mockClaim.mockResolvedValueOnce(false)
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(false)
  })

  it('claims the fingerprint under the user set key with the 90-day TTL', async () => {
    mockClaim.mockResolvedValueOnce(true)
    await isDeviceUnseen('user_abc', 'fp')
    // One call, so the claim and the expiry cannot separate: a caller that
    // crashes before markDeviceSeen still leaves an expiring member.
    expect(mockClaim).toHaveBeenCalledTimes(1)
    expect(mockClaim).toHaveBeenCalledWith('user:devices:user_abc', 'fp', 7_776_000)
  })

  it('atomic across concurrent first-sights — only one caller gets true', async () => {
    mockClaim.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const [a, b] = await Promise.all([
      isDeviceUnseen('user_abc', 'fp'),
      isDeviceUnseen('user_abc', 'fp'),
    ])
    expect([a, b].sort()).toEqual([false, true])
  })

  it('fails closed on a store error (returns false, no notification spam)', async () => {
    mockClaim.mockRejectedValueOnce(new Error('store down'))
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(false)
  })
})

describe('markDeviceSeen', () => {
  it('slides the 90-day TTL forward', async () => {
    mockTouch.mockResolvedValueOnce(undefined)
    await markDeviceSeen('user_abc')
    expect(mockTouch).toHaveBeenCalledWith('user:devices:user_abc', 7_776_000)
  })

  it('swallows store errors', async () => {
    mockTouch.mockRejectedValueOnce(new Error('store down'))
    await expect(markDeviceSeen('user_abc')).resolves.toBeUndefined()
  })
})

describe('forgetDevice', () => {
  it('removes the fingerprint from the user set', async () => {
    mockRemove.mockResolvedValueOnce(undefined)
    await forgetDevice('user_abc', 'fp')
    expect(mockRemove).toHaveBeenCalledWith('user:devices:user_abc', 'fp')
  })

  it('swallows store errors', async () => {
    mockRemove.mockRejectedValueOnce(new Error('store down'))
    await expect(forgetDevice('user_abc', 'fp')).resolves.toBeUndefined()
  })
})
