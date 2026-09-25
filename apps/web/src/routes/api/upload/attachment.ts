import { createFileRoute } from '@tanstack/react-router'
import { isS3Usable, uploadAttachmentFromFormData } from '@/lib/server/storage/s3'
import { refuseUnlessTeamUpload } from './image'

/**
 * Team-side conversation and ticket attachments: images plus the document
 * types the visitor composers accept (CSV, logs, .db), so an agent can send a
 * corrected export back the same way a visitor sends one in. Same gate as the
 * image route; only the attachment composers call it, so the prefix is fixed.
 */
export async function handleAdminAttachmentUpload({
  request,
}: {
  request: Request
}): Promise<Response> {
  const refused = await refuseUnlessTeamUpload(request)
  if (refused) return refused
  if (!isS3Usable()) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 })
  }
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }
  return uploadAttachmentFromFormData(formData, 'chat-images')
}

export const Route = createFileRoute('/api/upload/attachment')({
  server: {
    handlers: {
      POST: handleAdminAttachmentUpload,
    },
  },
})
