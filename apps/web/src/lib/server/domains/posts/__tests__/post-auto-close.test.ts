import { describe, it, expect } from 'vitest'
import { isDueForAutoClose } from '../post-auto-close'

describe('isDueForAutoClose', () => {
  const now = new Date('2026-09-05T12:00:00Z')
  it('is due once the full number of days has passed', () => {
    expect(isDueForAutoClose(new Date('2026-08-06T12:00:00Z'), 30, now)).toBe(true)
    expect(isDueForAutoClose(new Date('2026-08-06T11:59:59Z'), 30, now)).toBe(true)
  })
  it('is not due a second early', () => {
    expect(isDueForAutoClose(new Date('2026-08-06T12:00:01Z'), 30, now)).toBe(false)
    expect(isDueForAutoClose(now, 1, now)).toBe(false)
  })
})
