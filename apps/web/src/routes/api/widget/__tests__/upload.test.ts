import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSession, mockImageFile } from '../../__tests__/upload-fixtures'

vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/server/storage/s3', async () => {
  const { createS3MockFactory } = await import('../../__tests__/s3-upload-mock')
  return createS3MockFactory()
})

const mockGetSettings = vi.fn()
vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}))

const mockIncrementBucket = vi.fn()
const mockBucketRetryAfter = vi.fn()
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: (...args: unknown[]) => mockIncrementBucket(...args),
  bucketRetryAfter: (...args: unknown[]) => mockBucketRetryAfter(...args),
}))

import { auth } from '@/lib/server/auth'
import { isS3Usable, uploadObject } from '@/lib/server/storage/s3'
import { handleWidgetUpload } from '../upload'

function makeRequest(
  file?: File,
  token?: string,
  extraHeaders: Record<string, string> = {}
): Request {
  const formData = new FormData()
  if (file) formData.append('file', file)
  const headers: Record<string, string> = { ...extraHeaders }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request('http://localhost/api/widget/upload', {
    method: 'POST',
    body: formData,
    headers,
  })
}

const validSession = mockSession()

/** Stub the better-auth session resolution as a valid widget visitor. */
function authAs() {
  vi.mocked(auth.api.getSession).mockResolvedValueOnce(validSession)
}

describe('POST /api/widget/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isS3Usable).mockReturnValue(true)
    mockGetSettings.mockResolvedValue({ id: 'settings_1' })
    mockIncrementBucket.mockResolvedValue({ count: 1 })
    mockBucketRetryAfter.mockResolvedValue(42)
  })

  it('returns 401 when there is no valid widget session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    const res = await handleWidgetUpload({ request: makeRequest() })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 503 when S3 is not configured', async () => {
    authAs()
    vi.mocked(isS3Usable).mockReturnValue(false)
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'valid-token') })
    expect(res.status).toBe(503)
  })

  it('returns 400 when no file provided', async () => {
    authAs()
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'valid-token') })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'No file provided' })
  })

  it('returns 400 for invalid file type', async () => {
    authAs()
    const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' })
    const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid file type' })
  })

  it('returns 400 when file exceeds max size', async () => {
    authAs()
    const oversized = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', {
      type: 'image/png',
    })
    const res = await handleWidgetUpload({ request: makeRequest(oversized, 'valid-token') })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('too large') })
  })

  it('uploads image and returns publicUrl for any valid widget session', async () => {
    // Identified or anonymous — the route only requires a valid session, so a
    // live-chat visitor without an account can attach images too.
    authAs()
    vi.mocked(uploadObject).mockResolvedValueOnce('https://cdn.example.com/widget-images/shot.webp')
    const file = mockImageFile('shot.webp', 'image/webp')
    const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('publicUrl')
    expect(uploadObject).toHaveBeenCalledWith(
      expect.stringContaining('widget-images'),
      expect.any(Buffer),
      'image/webp'
    )
  })

  it('returns 503 when the workspace is unavailable', async () => {
    authAs()
    mockGetSettings.mockResolvedValue(null)
    const res = await handleWidgetUpload({ request: makeRequest(undefined, 'valid-token') })
    expect(res.status).toBe(503)
    expect(mockIncrementBucket).not.toHaveBeenCalled()
  })

  it('keys the workspace bucket off the resolved workspace id, not the Host header', async () => {
    // A caller could vary the Host header per request to dodge a Host-keyed
    // bucket. Since Round 2, the workspace bucket is keyed on settings.id, so
    // the bucket key stays fixed regardless of what Host is sent.
    authAs()
    mockGetSettings.mockResolvedValue({ id: 'settings_fixed' })
    await handleWidgetUpload({
      request: makeRequest(undefined, 'valid-token', { Host: 'attacker-controlled.example' }),
    })
    const keys = mockIncrementBucket.mock.calls.map((call) => (call[0] as { key: string }).key)
    expect(keys).toContain('widget-upload:workspace:settings_fixed')
    expect(keys.some((k: string) => k.includes('attacker-controlled.example'))).toBe(false)
  })

  it('429s when the workspace bucket is over the limit, even from a fresh session/IP', async () => {
    authAs()
    mockIncrementBucket.mockImplementation(async (spec: { key: string }) => ({
      count: spec.key.includes(':workspace:') ? 21 : 1,
    }))
    const file = mockImageFile('shot.webp', 'image/webp')
    const res = await handleWidgetUpload({
      request: makeRequest(file, 'valid-token', { Host: 'yet-another-host.example' }),
    })
    expect(res.status).toBe(429)
    expect(uploadObject).not.toHaveBeenCalled()
  })

  describe('document attachments (CSV, logs, .db)', () => {
    const SQLITE = new Uint8Array([
      ...Buffer.from('SQLite format 3\0', 'latin1'),
      ...new Array<number>(100).fill(0),
    ])

    it('uploads a CSV as text/csv even when Windows labels it as Excel', async () => {
      authAs()
      const file = new File(['team,number\n1,2\n'], 'teams.csv', {
        type: 'application/vnd.ms-excel',
      })
      const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
      expect(res.status).toBe(200)
      expect(await res.json()).toHaveProperty('publicUrl')
      expect(uploadObject).toHaveBeenCalledWith(
        expect.stringContaining('widget-images'),
        expect.any(Buffer),
        'text/csv'
      )
    })

    it('uploads a Competition Control .log with no declared type as text/plain', async () => {
      authAs()
      const file = new File(
        ['2026-09-24 12:00:00 [INF] Event started\n'],
        'CompetitionControl-20260924.log'
      )
      const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
      expect(res.status).toBe(200)
      expect(uploadObject).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        'text/plain'
      )
    })

    it('uploads a SQLite .db (Tournament Manager export)', async () => {
      authAs()
      const file = new File([SQLITE], 'event.db')
      const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
      expect(res.status).toBe(200)
      expect(uploadObject).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        'application/vnd.sqlite3'
      )
    })

    it('rejects a .db whose bytes are not a SQLite database', async () => {
      authAs()
      const file = new File(['just some text'], 'event.db')
      const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'File content does not match its type' })
      expect(uploadObject).not.toHaveBeenCalled()
    })

    it('rejects a binary renamed to .csv', async () => {
      authAs()
      const file = new File([SQLITE], 'not-really.csv', { type: 'text/csv' })
      const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
      expect(res.status).toBe(400)
      expect(uploadObject).not.toHaveBeenCalled()
    })

    it('rejects extensions outside the allow-list whatever the label says', async () => {
      authAs()
      const file = new File(['<html></html>'], 'page.html', { type: 'text/csv' })
      const res = await handleWidgetUpload({ request: makeRequest(file, 'valid-token') })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'Invalid file type' })
    })
  })
})
