/**
 * Tests for the Redis-backed device-fingerprint tracker. Two-phase
 * API (isDeviceUnseen → markDeviceSeen | forgetDevice) so notification
 * failures can roll back the claim and re-fire on the next sign-in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExec = vi.fn()
const mockExpire = vi.fn()
const mockSrem = vi.fn()
const mockMulti = vi.fn(() => ({
  sadd: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: mockExec,
}))

vi.mock('@/lib/server/redis', () => ({
  getRedis: () => ({
    multi: mockMulti,
    expire: mockExpire,
    srem: mockSrem,
  }),
}))

const { computeDeviceFingerprint, isDeviceUnseen, markDeviceSeen, forgetDevice } =
  await import('../signin-device-tracker')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('computeDeviceFingerprint', () => {
  it('truncates IPv4 to /24 before hashing', () => {
    const a = computeDeviceFingerprint('Mozilla/5.0', '203.0.113.42')
    const b = computeDeviceFingerprint('Mozilla/5.0', '203.0.113.99')
    expect(a).toBe(b)
  })

  it('differs on UA change', () => {
    const a = computeDeviceFingerprint('Mozilla/5.0', '203.0.113.42')
    const b = computeDeviceFingerprint('Different/5.0', '203.0.113.42')
    expect(a).not.toBe(b)
  })

  it('differs on /24 change', () => {
    expect(computeDeviceFingerprint('UA', '203.0.113.42')).not.toBe(
      computeDeviceFingerprint('UA', '203.0.114.42')
    )
  })

  it('returns 32-char hex', () => {
    expect(computeDeviceFingerprint('UA', '203.0.113.42')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('handles a missing IP without throwing', () => {
    expect(computeDeviceFingerprint('UA', 'unknown')).toMatch(/^[0-9a-f]{32}$/)
  })
})

/**
 * IPv6 used to be hashed whole. RFC 8981 privacy extensions rotate the
 * interface identifier (low 64 bits) on a timer — commonly daily, and
 * per-connection on some stacks — so the same person on the same
 * network minted a fresh fingerprint constantly and was emailed a
 * "new device" alert on nearly every sign-in. Truncating to the /64
 * network prefix is what makes the alert mean something.
 */
describe('computeDeviceFingerprint — IPv6 /64 truncation', () => {
  it('is stable when privacy extensions rotate the interface identifier', () => {
    expect(computeDeviceFingerprint('UA', '2001:db8:abcd:1234:1111:2222:3333:4444')).toBe(
      computeDeviceFingerprint('UA', '2001:db8:abcd:1234:9999:8888:7777:6666')
    )
  })

  it('still differs across /64 boundaries', () => {
    expect(computeDeviceFingerprint('UA', '2001:db8:abcd:1234::1')).not.toBe(
      computeDeviceFingerprint('UA', '2001:db8:abcd:5678::1')
    )
  })

  it('treats compressed and expanded forms of one prefix as equal', () => {
    expect(computeDeviceFingerprint('UA', '2001:db8::1')).toBe(
      computeDeviceFingerprint('UA', '2001:0db8:0000:0000:aaaa:bbbb:cccc:dddd')
    )
  })

  it('ignores a zone index', () => {
    expect(computeDeviceFingerprint('UA', 'fe80::1%eth0')).toBe(
      computeDeviceFingerprint('UA', 'fe80::1')
    )
  })

  it('does not collide with an unrelated prefix', () => {
    expect(computeDeviceFingerprint('UA', '2001:db8::1')).not.toBe(
      computeDeviceFingerprint('UA', '2001:db9::1')
    )
  })

  // Some proxies report client IPv4 as "::ffff:a.b.c.d". Truncating
  // those to a /64 would discard the embedded address and land every
  // such client on one shared fingerprint, silencing the alert for all
  // of them.
  it('maps IPv4-mapped addresses onto their plain IPv4 fingerprint', () => {
    expect(computeDeviceFingerprint('UA', '::ffff:203.0.113.7')).toBe(
      computeDeviceFingerprint('UA', '203.0.113.7')
    )
  })

  it('keeps IPv4-mapped addresses in different /24s distinct', () => {
    expect(computeDeviceFingerprint('UA', '::ffff:203.0.113.7')).not.toBe(
      computeDeviceFingerprint('UA', '::ffff:198.51.100.7')
    )
  })
})

describe('isDeviceUnseen', () => {
  it('returns true when SADD adds a new member (pipeline reply 1)', async () => {
    mockExec.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ])
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(true)
  })

  it('returns false when SADD reports the member was already present (reply 0)', async () => {
    mockExec.mockResolvedValueOnce([
      [null, 0],
      [null, 0],
    ])
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(false)
  })

  it('issues SADD + EXPIRE NX in a single pipeline (TTL set on first claim)', async () => {
    mockExec.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ])
    await isDeviceUnseen('user_abc', 'fp')
    const pipeline = mockMulti.mock.results[0]!.value as {
      sadd: ReturnType<typeof vi.fn>
      expire: ReturnType<typeof vi.fn>
    }
    expect(pipeline.sadd).toHaveBeenCalledWith('user:devices:user_abc', 'fp')
    // 90 days, NX so existing TTL is preserved
    expect(pipeline.expire).toHaveBeenCalledWith('user:devices:user_abc', 7_776_000, 'NX')
  })

  it('atomic across concurrent first-sights — only one caller gets true', async () => {
    mockExec
      .mockResolvedValueOnce([
        [null, 1],
        [null, 1],
      ])
      .mockResolvedValueOnce([
        [null, 0],
        [null, 0],
      ])
    const [a, b] = await Promise.all([
      isDeviceUnseen('user_abc', 'fp'),
      isDeviceUnseen('user_abc', 'fp'),
    ])
    expect([a, b].sort()).toEqual([false, true])
  })

  it('fails closed on Redis error (returns false, no notification spam)', async () => {
    mockExec.mockRejectedValueOnce(new Error('redis down'))
    expect(await isDeviceUnseen('user_abc', 'fp')).toBe(false)
  })
})

describe('markDeviceSeen', () => {
  it('slides the 90-day TTL forward', async () => {
    mockExpire.mockResolvedValueOnce(1)
    await markDeviceSeen('user_abc')
    expect(mockExpire).toHaveBeenCalledWith('user:devices:user_abc', 7_776_000)
  })

  it('swallows Redis errors', async () => {
    mockExpire.mockRejectedValueOnce(new Error('redis down'))
    await expect(markDeviceSeen('user_abc')).resolves.toBeUndefined()
  })
})

describe('forgetDevice', () => {
  it('SREMs the fingerprint from the user SET', async () => {
    mockSrem.mockResolvedValueOnce(1)
    await forgetDevice('user_abc', 'fp')
    expect(mockSrem).toHaveBeenCalledWith('user:devices:user_abc', 'fp')
  })

  it('swallows Redis errors', async () => {
    mockSrem.mockRejectedValueOnce(new Error('redis down'))
    await expect(forgetDevice('user_abc', 'fp')).resolves.toBeUndefined()
  })
})
