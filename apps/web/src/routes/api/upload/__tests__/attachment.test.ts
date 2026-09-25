import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSession, mockPrincipal, mockImageFile } from '../../__tests__/upload-fixtures'

vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

const mockPrincipalFindFirst = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: {
    query: { principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) } },
  },
  principal: { userId: 'principal.user_id' },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/storage/s3', async () => {
  const { createS3MockFactory } = await import('../../__tests__/s3-upload-mock')
  return createS3MockFactory()
})

import { auth } from '@/lib/server/auth'
import { isS3Usable, uploadObject } from '@/lib/server/storage/s3'
import { handleAdminAttachmentUpload } from '../attachment'

function makeRequest(file?: File): Request {
  const formData = new FormData()
  if (file) formData.append('file', file)
  return new Request('http://localhost/api/upload/attachment', { method: 'POST', body: formData })
}

/** A dashboard session (no explicit scope reads as dashboard) or one carrying a scope. */
function sessionScoped(scope?: string) {
  const s = mockSession()
  return scope ? { ...s, session: { ...s.session, scope } } : s
}

const CSV = new File(['team,number\n1,2\n'], 'teams.csv', { type: 'text/csv' })

describe('POST /api/upload/attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isS3Usable).mockReturnValue(true)
    vi.mocked(auth.api.getSession).mockResolvedValue(sessionScoped() as never)
    mockPrincipalFindFirst.mockResolvedValue(mockPrincipal({ role: 'member' }))
  })

  it('401s without a session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never)
    const res = await handleAdminAttachmentUpload({ request: makeRequest(CSV) })
    expect(res.status).toBe(401)
  })

  it('403s a portal user', async () => {
    mockPrincipalFindFirst.mockResolvedValue(mockPrincipal({ role: 'user' }))
    const res = await handleAdminAttachmentUpload({ request: makeRequest(CSV) })
    expect(res.status).toBe(403)
  })

  it('403s a teammate on a widget-scoped session (identified through the widget)', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(sessionScoped('widget') as never)
    mockPrincipalFindFirst.mockResolvedValue(mockPrincipal({ role: 'admin' }))
    const res = await handleAdminAttachmentUpload({ request: makeRequest(CSV) })
    expect(res.status).toBe(403)
    expect(uploadObject).not.toHaveBeenCalled()
  })

  it('uploads a CSV for a teammate on a dashboard session, stored as text/csv', async () => {
    const res = await handleAdminAttachmentUpload({ request: makeRequest(CSV) })
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty('publicUrl')
    expect(uploadObject).toHaveBeenCalledWith(
      expect.stringContaining('chat-images'),
      expect.any(Buffer),
      'text/csv'
    )
  })

  it('still takes images through the image path', async () => {
    const res = await handleAdminAttachmentUpload({
      request: makeRequest(mockImageFile('shot.png', 'image/png')),
    })
    expect(res.status).toBe(200)
    expect(uploadObject).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), 'image/png')
  })

  it('rejects a PDF (not on the document allow-list)', async () => {
    const pdf = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' })
    const res = await handleAdminAttachmentUpload({ request: makeRequest(pdf) })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid file type' })
  })
})
