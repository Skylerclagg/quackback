import { createFileRoute } from '@tanstack/react-router'
import { getRequestHeaders } from '@tanstack/react-start/server'
import Papa from 'papaparse'
import { isValidTypeId, type SegmentId } from '@quackback/ids'
import { DomainException } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import type { AuthContext } from '@/lib/server/functions/auth-helpers'

const log = logger.child({ component: 'segment-import' })

/**
 * Smaller than the board importer's 10MB: a segment CSV is one column of
 * addresses, so 5MB already covers ~100k rows — well past MAX_ROWS.
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_ROWS = 10000

/**
 * Cap on how many unmatched / invalid addresses we echo back. A garbage
 * 10k-row upload would otherwise return a multi-megabyte JSON payload that
 * the dialog then tries to render.
 */
const MAX_REPORTED = 100

/** Pull the email column out of a CSV, header row optional. */
function extractEmails(csvText: string): { emails: string[]; error?: string } {
  const headered = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  })

  // A headerless single-column list parses "successfully" with header:true —
  // the first address just becomes the field name. Detect that by looking
  // for a real `email` column and re-parse positionally when it's absent.
  if ((headered.meta.fields ?? []).includes('email')) {
    return { emails: headered.data.map((row) => row.email ?? '') }
  }

  const positional = Papa.parse<string[]>(csvText, { header: false, skipEmptyLines: true })
  if (positional.errors.length > 0 && positional.data.length === 0) {
    return { emails: [], error: `CSV parsing error: ${positional.errors[0].message}` }
  }
  return { emails: positional.data.map((row) => row?.[0] ?? '') }
}

export const Route = createFileRoute('/api/segments/import')({
  server: {
    handlers: {
      /**
       * POST /api/segments/import
       *
       * Bulk-add existing accounts to a manual segment from a CSV of email
       * addresses. Lookup-only — addresses with no account are reported
       * back, never provisioned.
       */
      POST: async ({ request }) => {
        const { validateApiWorkspaceAccess } = await import('@/lib/server/functions/workspace')
        const { canAccess } = await import('@/lib/server/auth')
        type Role = 'admin' | 'member' | 'user'
        const { resolvePrincipalsByEmail } =
          await import('@/lib/server/domains/segments/email-resolver')
        const { assignUsersToSegment } =
          await import('@/lib/server/domains/segments/segment.service')
        const { actorFromAuth } = await import('@/lib/server/audit/log')

        try {
          const formData = await request.formData()
          const file = formData.get('file') as File | null
          const segmentIdParam = formData.get('segmentId') as string | null

          log.info(
            { file_name: file?.name || 'none', file_size: file?.size || 0 },
            'segment email import started'
          )

          const validation = await validateApiWorkspaceAccess()
          if (!validation.success) {
            return Response.json({ error: validation.error }, { status: validation.status })
          }

          if (!canAccess(validation.principal.role as Role, ['admin'])) {
            log.warn({ role: validation.principal.role }, 'segment import access denied')
            return Response.json({ error: 'Only admins can import data' }, { status: 403 })
          }

          if (!file) {
            return Response.json({ error: 'No file provided' }, { status: 400 })
          }
          if (file.size > MAX_FILE_SIZE) {
            return Response.json({ error: 'File size exceeds 5MB limit' }, { status: 400 })
          }
          if (!file.type.includes('csv') && !file.name.endsWith('.csv')) {
            return Response.json({ error: 'File must be a CSV' }, { status: 400 })
          }

          if (!segmentIdParam) {
            return Response.json({ error: 'No segment specified' }, { status: 400 })
          }
          if (!isValidTypeId(segmentIdParam, 'segment')) {
            return Response.json({ error: 'Invalid segment ID format' }, { status: 400 })
          }
          const segmentId = segmentIdParam as SegmentId

          const { emails, error: parseError } = extractEmails(await file.text())
          if (parseError) {
            return Response.json({ error: parseError }, { status: 400 })
          }

          const rows = emails.map((value) => value.trim()).filter((value) => value.length > 0)
          if (rows.length === 0) {
            return Response.json(
              { error: 'No email addresses found. Expected an "email" column or one per line.' },
              { status: 400 }
            )
          }
          if (rows.length > MAX_ROWS) {
            return Response.json(
              { error: `File exceeds maximum of ${MAX_ROWS} rows` },
              { status: 400 }
            )
          }

          const resolved = await resolvePrincipalsByEmail(rows)

          // validateApiWorkspaceAccess returns the same {settings,user,principal}
          // triple as requireAuth but typed from the raw session/DB rows
          // (unbranded ids), so the shared mapper needs a structural cast.
          const actor = actorFromAuth(validation as unknown as AuthContext)

          const { assigned } = await assignUsersToSegment(
            segmentId,
            resolved.matched.map((m) => m.principalId),
            actor,
            getRequestHeaders()
          )

          log.info(
            {
              segment_id: segmentId,
              assigned,
              matched: resolved.matched.length,
              unmatched: resolved.unmatched.length,
              invalid: resolved.invalid.length,
            },
            'segment email import complete'
          )

          return Response.json({
            assigned,
            matched: resolved.matched.length,
            unmatched: resolved.unmatched.slice(0, MAX_REPORTED),
            unmatchedCount: resolved.unmatched.length,
            invalid: resolved.invalid.slice(0, MAX_REPORTED),
            invalidCount: resolved.invalid.length,
            unmatchedTruncated:
              resolved.unmatched.length > MAX_REPORTED || resolved.invalid.length > MAX_REPORTED,
            total: rows.length,
          })
        } catch (error) {
          // assignUsersToSegment throws ForbiddenError('SEGMENT_TYPE_ERROR')
          // for dynamic segments and NotFoundError('SEGMENT_NOT_FOUND') for
          // missing/deleted ones. Every DomainException already carries the
          // right HTTP status, so surface it rather than flattening to 500.
          if (error instanceof DomainException) {
            log.warn({ err: error }, 'segment email import rejected')
            return Response.json({ error: error.message }, { status: error.statusCode })
          }
          log.error({ err: error }, 'segment email import failed')
          const errorMessage = error instanceof Error ? error.message : 'Internal server error'
          return Response.json({ error: errorMessage }, { status: 500 })
        }
      },
    },
  },
})
