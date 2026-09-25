import { createFileRoute } from '@tanstack/react-router'
import type { UserId } from '@quackback/ids'
import { auth } from '@/lib/server/auth'
import { toSessionScope } from '@/lib/shared/roles'
import { db, eq, principal } from '@/lib/server/db'
import { isS3Usable, uploadImageFromFormData } from '@/lib/server/storage/s3'

const ALLOWED_PREFIXES = new Set([
  'uploads',
  'changelog-images',
  'changelog',
  'post-images',
  'help-center',
  'chat-images',
])

/**
 * Team-only, dashboard-session-only gate shared by the admin upload routes.
 * Resolves to the refusal to send, or null when the caller may upload.
 */
export async function refuseUnlessTeamUpload(request: Request): Promise<Response | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (toSessionScope(session.session.scope) !== 'dashboard') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const principalRecord = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id as UserId),
    columns: { role: true },
  })
  if (!principalRecord || (principalRecord.role !== 'admin' && principalRecord.role !== 'member')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

export async function handleAdminUpload({ request }: { request: Request }): Promise<Response> {
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
  const rawPrefix = formData.get('prefix')
  const prefix =
    typeof rawPrefix === 'string' && ALLOWED_PREFIXES.has(rawPrefix) ? rawPrefix : 'uploads'
  return uploadImageFromFormData(formData, prefix)
}

export const Route = createFileRoute('/api/upload/image')({
  server: {
    handlers: {
      POST: handleAdminUpload,
    },
  },
})
