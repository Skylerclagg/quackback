import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Resend as an outbound provider.
 *
 * Two things here are easy to get wrong and expensive when wrong, so both are
 * pinned: the SDK reports a rejected send in `error` rather than by throwing
 * (so a missing check logs a failure as `sent`), and Resend's response `id` is
 * its own identifier, NOT the RFC 5322 Message-ID — returning it as the
 * message id would have callers store an id no reply can ever quote.
 */

const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn() }))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendSpy }
  },
}))

// The email-log sink is module-level state; capture what the arm records.
const { logSpy } = vi.hoisted(() => ({ logSpy: vi.fn() }))

import { sendRawEmail, isEmailConfigured, setEmailLogSink } from '../index'
import { sendingAs } from './brands'

// Every key that participates in provider selection, so a developer's own
// environment cannot decide which transport these tests exercise.
const KEYS = [
  'EMAIL_SMTP_HOST',
  'EMAIL_SES_ACCESS_KEY_ID',
  'EMAIL_SES_SECRET_ACCESS_KEY',
  'EMAIL_SES_REGION',
  'EMAIL_RESEND_API_KEY',
  'RESEND_API_KEY',
  'EMAIL_FROM',
]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  process.env.EMAIL_RESEND_API_KEY = 're_test_key'
  process.env.EMAIL_FROM = 'noreply@example.com'
  sendSpy.mockReset()
  sendSpy.mockResolvedValue({ data: { id: 'resend-uuid-1' }, error: null })
  logSpy.mockReset()
  setEmailLogSink(logSpy)
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] !== undefined) process.env[key] = saved[key]
    else delete process.env[key]
  }
  setEmailLogSink(null)
})

const raw = () => ({
  from: sendingAs('noreply@example.com'),
  to: 'person@example.com',
  subject: 'Subject',
  html: '<p>Body</p>',
})

describe('provider selection', () => {
  it('selects Resend when only a Resend key is set', async () => {
    expect(isEmailConfigured()).toBe(true)
    await sendRawEmail(raw())
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it('accepts RESEND_API_KEY as well as EMAIL_RESEND_API_KEY', async () => {
    delete process.env.EMAIL_RESEND_API_KEY
    process.env.RESEND_API_KEY = 're_test_key'
    expect(isEmailConfigured()).toBe(true)
  })

  it('does not displace an install that already uses SMTP', async () => {
    // Restoring Resend must be purely additive: a deployment with both set
    // keeps the transport it has been sending on.
    process.env.EMAIL_SMTP_HOST = 'smtp.example.com'
    await sendRawEmail(raw()).catch(() => undefined)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('does not displace an install that already uses SES', async () => {
    process.env.EMAIL_SES_ACCESS_KEY_ID = 'AKIAEXAMPLE'
    process.env.EMAIL_SES_SECRET_ACCESS_KEY = 'secret'
    process.env.EMAIL_SES_REGION = 'us-east-1'
    await sendRawEmail(raw()).catch(() => undefined)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('still falls back to console when no provider at all is set', async () => {
    delete process.env.EMAIL_RESEND_API_KEY
    expect(isEmailConfigured()).toBe(false)
    const result = await sendRawEmail(raw())
    expect(result).toMatchObject({ sent: false, reason: 'no_provider' })
    expect(sendSpy).not.toHaveBeenCalled()
  })
})

describe('sending through Resend', () => {
  it('sends the message and reports success', async () => {
    const result = await sendRawEmail(raw())
    expect(result.sent).toBe(true)
    const params = sendSpy.mock.calls[0][0]
    expect(params).toMatchObject({
      from: 'noreply@example.com',
      to: 'person@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
    })
  })

  it('never reports Resend’s own id as the message id', async () => {
    // `data.id` is Resend's identifier, not the RFC Message-ID, and Resend
    // assigns the header itself. Null is the documented "transport generated
    // it and did not say which" state; anything else has callers store an id
    // that no reply can quote back.
    const result = await sendRawEmail(raw())
    expect(result.messageId).toBeNull()
    expect(result.messageId).not.toBe('resend-uuid-1')
  })

  it('records the send, keeping the provider id separate from the message id', async () => {
    await sendRawEmail(raw())
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'outbound',
        provider: 'resend',
        status: 'sent',
        messageId: null,
        providerMessageId: 'resend-uuid-1',
      })
    )
  })

  it('passes threading headers through so the client still threads the reply', async () => {
    await sendRawEmail({
      ...raw(),
      inReplyTo: '<parent@example.com>',
      references: ['<root@example.com>'],
    })
    const headers = sendSpy.mock.calls[0][0].headers ?? {}
    expect(headers['In-Reply-To']).toContain('parent@example.com')
    expect(headers['References']).toContain('root@example.com')
  })

  it('passes a Reply-To through — the plus-address is how a reply routes back', async () => {
    await sendRawEmail({ ...raw(), replyTo: 'conv+abc@example.com' })
    expect(sendSpy.mock.calls[0][0].replyTo).toBe('conv+abc@example.com')
  })
})

describe('a rejected send', () => {
  // The SDK resolves with `error` set rather than rejecting, so without an
  // explicit check a hard failure would be logged as a successful send.
  const rejection = {
    data: null,
    error: { name: 'validation_error', message: 'Domain is not verified' },
  }

  it('throws rather than reporting success', async () => {
    sendSpy.mockResolvedValue(rejection)
    await expect(sendRawEmail(raw())).rejects.toThrow(/Domain is not verified/)
  })

  it('records a failed row carrying the provider’s message', async () => {
    sendSpy.mockResolvedValue(rejection)
    await sendRawEmail(raw()).catch(() => undefined)
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'resend',
        status: 'failed',
        error: expect.stringContaining('Domain is not verified'),
      })
    )
  })

  it('surfaces a thrown transport error too', async () => {
    sendSpy.mockRejectedValue(new Error('network down'))
    await expect(sendRawEmail(raw())).rejects.toThrow(/network down/)
  })
})
