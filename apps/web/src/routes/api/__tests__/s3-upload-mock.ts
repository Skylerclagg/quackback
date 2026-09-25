import { vi } from 'vitest'
import { attachmentBytesMatchType, sniffImageMime } from '@/lib/server/content/magic-bytes'
import { resolveAttachmentContentType } from '@/lib/shared/storage-config'

/**
 * Shared vi.mock factory for @/lib/server/storage/s3.
 *
 * Provides re-implementations of uploadImageFromFormData and
 * uploadAttachmentFromFormData that close over the named mock functions — so
 * tests can spy on uploadObject/generateStorageKey via vi.mocked(), and the
 * mock's internal validation logic stays in one place.
 *
 * Usage in a test file:
 *   vi.mock('@/lib/server/storage/s3', async () => {
 *     const { createS3MockFactory } = await import('../../__tests__/s3-upload-mock')
 *     return createS3MockFactory()
 *   })
 */
export function createS3MockFactory() {
  const MAX_FILE_SIZE = 5 * 1024 * 1024
  const mockIsAllowedImageType = vi.fn((type: string) =>
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)
  )
  const mockGenerateStorageKey = vi.fn(
    (prefix: string, filename: string) => `${prefix}/2024/01/abc-${filename}`
  )
  const mockUploadObject = vi.fn(
    async (key: string, _body?: unknown, _type?: string) => `https://cdn.example.com/${key}`
  )

  async function uploadImageFromFormData(formData: FormData, storagePrefix: string) {
    const file = formData.get('file')
    if (!(file instanceof File))
      return Response.json({ error: 'No file provided' }, { status: 400 })
    if (!mockIsAllowedImageType(file.type))
      return Response.json({ error: 'Invalid file type' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE)
      return Response.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      )
    try {
      const filename = file.name || `paste-${Date.now()}.${file.type.split('/')[1] || 'png'}`
      const key = mockGenerateStorageKey(storagePrefix, filename)
      const body = Buffer.from(await file.arrayBuffer())
      // Mirror the real implementation's magic-byte check (sniffImageMime is
      // pure, so the real one is used) — declared type must match the bytes.
      if (sniffImageMime(body) !== file.type) {
        return Response.json({ error: 'File content does not match its type' }, { status: 400 })
      }
      const publicUrl = await mockUploadObject(key, body, file.type)
      return Response.json({ publicUrl })
    } catch {
      return Response.json({ error: 'Upload failed' }, { status: 500 })
    }
  }

  // Mirrors the real uploadAttachmentFromFormData: images defer to the image
  // path, documents resolve by extension and are byte-checked (both helpers
  // are pure, so the real ones are used).
  async function uploadAttachmentFromFormData(formData: FormData, storagePrefix: string) {
    const file = formData.get('file')
    if (!(file instanceof File))
      return Response.json({ error: 'No file provided' }, { status: 400 })
    if (mockIsAllowedImageType(file.type)) return uploadImageFromFormData(formData, storagePrefix)
    const contentType = resolveAttachmentContentType(file)
    if (!contentType) return Response.json({ error: 'Invalid file type' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE)
      return Response.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      )
    try {
      const key = mockGenerateStorageKey(storagePrefix, file.name)
      const body = Buffer.from(await file.arrayBuffer())
      if (!attachmentBytesMatchType(body, contentType)) {
        return Response.json({ error: 'File content does not match its type' }, { status: 400 })
      }
      const publicUrl = await mockUploadObject(key, body, contentType)
      return Response.json({ publicUrl })
    } catch {
      return Response.json({ error: 'Upload failed' }, { status: 500 })
    }
  }

  return {
    isS3Usable: vi.fn(() => true),
    isS3Configured: vi.fn(() => true),
    isAllowedImageType: mockIsAllowedImageType,
    generateStorageKey: mockGenerateStorageKey,
    uploadObject: mockUploadObject,
    MAX_FILE_SIZE,
    uploadImageFromFormData,
    uploadAttachmentFromFormData,
  }
}
