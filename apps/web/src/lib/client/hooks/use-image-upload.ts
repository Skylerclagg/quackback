import { useCallback } from 'react'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import {
  DOCUMENT_ATTACHMENT_LABEL,
  MAX_FILE_SIZE,
  isAllowedImageType,
  resolveAttachmentContentType,
} from '@/lib/shared/storage-config'

interface UseImageUploadOptions {
  prefix?: string
  endpoint?: string
  extraHeaders?: () => HeadersInit
  onStart?: () => void
  onSuccess?: (url: string) => void
  onError?: (error: Error) => void
}

/**
 * What a file may be uploaded as. `contentType` is the type the file goes up
 * with (null = refuse); `describe` words the refusal for the user.
 */
interface UploadKind {
  contentType: (file: File) => string | null
  describe: (file: File) => string
}

const IMAGE_KIND: UploadKind = {
  contentType: (file) => (isAllowedImageType(file.type) ? file.type : null),
  describe: (file) => `Invalid file type: ${file.type}. Allowed types: JPEG, PNG, GIF, WebP.`,
}

const ATTACHMENT_KIND: UploadKind = {
  contentType: resolveAttachmentContentType,
  describe: (file) =>
    `Invalid file type: ${file.type || file.name}. Allowed types: images, ${DOCUMENT_ATTACHMENT_LABEL}.`,
}

function useUpload(kind: UploadKind, options: UseImageUploadOptions) {
  const {
    prefix = 'uploads',
    endpoint = '/api/upload/image',
    extraHeaders,
    onStart,
    onSuccess,
    onError,
  } = options

  const upload = useCallback(
    async (file: File): Promise<string> => {
      const contentType = kind.contentType(file)
      if (!contentType) {
        const error = new Error(kind.describe(file))
        onError?.(error)
        throw error
      }

      if (file.size > MAX_FILE_SIZE) {
        const error = new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`)
        onError?.(error)
        throw error
      }

      onStart?.()

      try {
        const ext = contentType.split('/')[1] || 'png'
        // Pasted images have no name; documents may carry a type the browser
        // guessed wrong (or none) — send the canonical one so the server, the
        // pending tray, and the stored attachment all agree.
        const namedFile =
          file.name && file.type === contentType
            ? file
            : new File([file], file.name || `paste-${Date.now()}.${ext}`, { type: contentType })

        const formData = new FormData()
        formData.append('file', namedFile)
        formData.append('prefix', prefix)

        const response = await fetch(endpoint, {
          method: 'POST',
          body: formData,
          headers: extraHeaders?.(),
        })

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(data.error || `Upload failed: ${response.statusText}`)
        }

        const { publicUrl } = (await response.json()) as { publicUrl: string }
        onSuccess?.(publicUrl)
        return publicUrl
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Upload failed')
        onError?.(error)
        throw error
      }
    },
    [kind, prefix, endpoint, extraHeaders, onStart, onSuccess, onError]
  )

  return { upload }
}

export function useImageUpload(options: UseImageUploadOptions = {}) {
  return useUpload(IMAGE_KIND, options)
}

export function useChangelogImageUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useImageUpload({ ...options, prefix: 'changelog-images' })
}

export function usePostImageUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useImageUpload({ ...options, prefix: 'post-images' })
}

export function usePortalImageUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useImageUpload({ ...options, endpoint: '/api/portal/upload' })
}

export function useWidgetImageUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useImageUpload({
    ...options,
    endpoint: '/api/widget/upload',
    extraHeaders: getWidgetAuthHeaders,
  })
}

/**
 * Conversation attachments: images plus the documents in
 * DOCUMENT_ATTACHMENT_TYPES. Agent composers hit the team attachment route;
 * the portal/widget variants below reuse each surface's own upload endpoint,
 * which accepts the same set.
 */
export function useAttachmentUpload(options: UseImageUploadOptions = {}) {
  return useUpload(ATTACHMENT_KIND, { endpoint: '/api/upload/attachment', ...options })
}

export function usePortalAttachmentUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useAttachmentUpload({ ...options, endpoint: '/api/portal/upload' })
}

export function useWidgetAttachmentUpload(
  options: Omit<UseImageUploadOptions, 'prefix' | 'endpoint' | 'extraHeaders'> = {}
) {
  return useAttachmentUpload({
    ...options,
    endpoint: '/api/widget/upload',
    extraHeaders: getWidgetAuthHeaders,
  })
}
