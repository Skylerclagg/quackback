import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import {
  getChangelogById,
  updateChangelog,
  deleteChangelog,
} from '@/lib/server/domains/changelog/changelog.service'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import type { TiptapContent } from '@/lib/server/db'
import type { PublishState } from '@/lib/shared/schemas/changelog'
import type { ChangelogCollectionId, ChangelogId } from '@quackback/ids'

// Input validation schema
const updateChangelogSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  displayDate: z.string().datetime().nullable().optional(),
  changelogId: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
  allowedSegmentIds: z.array(z.string()).max(100).optional(),
  allowedTeamPrincipalIds: z.array(z.string()).max(100).optional(),
})

function formatChangelogResponse(entry: {
  id: string
  title: string
  content: string
  contentJson: TiptapContent | null
  changelogId: ChangelogCollectionId | null
  publishedAt: Date | null
  displayDate: Date | null
  isPublic: boolean
  allowedSegmentIds: string[]
  allowedTeamPrincipalIds: string[]
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: entry.id,
    title: entry.title,
    content: contentJsonToMarkdown(entry.contentJson, entry.content),
    publishedAt: entry.publishedAt?.toISOString() || null,
    displayDate: entry.displayDate?.toISOString() || null,
    isPublic: entry.isPublic,
    allowedSegmentIds: entry.allowedSegmentIds,
    allowedTeamPrincipalIds: entry.allowedTeamPrincipalIds,
    changelogId: entry.changelogId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}

export const Route = createFileRoute('/api/v1/changelog/$entryId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/changelog/:entryId
       * Get a single changelog entry by ID
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const entryId = parseTypeId<ChangelogId>(
            params.entryId,
            'changelog',
            'changelog entry ID'
          )

          const entry = await getChangelogById(entryId)
          return successResponse(formatChangelogResponse(entry))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/changelog/:entryId
       * Update a changelog entry
       */
      PATCH: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const entryId = parseTypeId<ChangelogId>(
            params.entryId,
            'changelog',
            'changelog entry ID'
          )

          const body = await request.json()
          const parsed = updateChangelogSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Convert publishedAt to PublishState, preserving exact timestamps
          let publishState: PublishState | undefined
          if (parsed.data.publishedAt !== undefined) {
            if (parsed.data.publishedAt === null) {
              publishState = { type: 'draft' }
            } else {
              const publishDate = new Date(parsed.data.publishedAt)
              publishState =
                publishDate > new Date()
                  ? { type: 'scheduled', publishAt: publishDate }
                  : { type: 'published', publishAt: publishDate }
            }
          }

          const updated = await updateChangelog(entryId, {
            title: parsed.data.title,
            content: parsed.data.content,
            ...(parsed.data.changelogId !== undefined && {
              changelogId: parsed.data.changelogId as ChangelogCollectionId | null,
            }),
            ...(publishState && { publishState }),
            ...(parsed.data.displayDate !== undefined && {
              displayDate:
                parsed.data.displayDate === null ? null : new Date(parsed.data.displayDate),
            }),
            isPublic: parsed.data.isPublic,
            allowedSegmentIds: parsed.data.allowedSegmentIds,
            allowedTeamPrincipalIds: parsed.data.allowedTeamPrincipalIds,
          })

          return successResponse(formatChangelogResponse(updated))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/changelog/:entryId
       * Delete a changelog entry
       */
      DELETE: async ({ request, params }) => {
        try {
          // Soft delete (deleteChangelog sets deletedAt) — team OK.
          await withApiKeyAuth(request, { role: 'team' })

          const entryId = parseTypeId<ChangelogId>(
            params.entryId,
            'changelog',
            'changelog entry ID'
          )

          await deleteChangelog(entryId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
