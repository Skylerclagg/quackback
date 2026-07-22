import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { TIMELINE_SPECIFICITIES } from '@/lib/shared/timeline'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { RoadmapId } from '@quackback/ids'

// Input validation schema
const timelineAccessSchema = z.object({
  default: z.enum(TIMELINE_SPECIFICITIES),
  segments: z
    .array(z.object({ segmentId: z.string(), specificity: z.enum(TIMELINE_SPECIFICITIES) }))
    .max(100),
  teamMembers: z
    .array(z.object({ principalId: z.string(), specificity: z.enum(TIMELINE_SPECIFICITIES) }))
    .max(100)
    .optional(),
})

const updateRoadmapSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
  allowedSegmentIds: z.array(z.string()).max(100).optional(),
  allowedTeamPrincipalIds: z.array(z.string()).max(100).optional(),
  timelineAccess: timelineAccessSchema.optional(),
})

export const Route = createFileRoute('/api/v1/roadmaps/$roadmapId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/roadmaps/:roadmapId
       * Get a single roadmap by ID
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')

          const { getRoadmap } = await import('@/lib/server/domains/roadmaps/roadmap.service')

          const roadmap = await getRoadmap(roadmapId)

          return successResponse({
            id: roadmap.id,
            name: roadmap.name,
            slug: roadmap.slug,
            description: roadmap.description,
            isPublic: roadmap.isPublic,
            allowedSegmentIds: roadmap.allowedSegmentIds,
            allowedTeamPrincipalIds: roadmap.allowedTeamPrincipalIds,
            timelineAccess: roadmap.timelineAccess,
            position: roadmap.position,
            createdAt: roadmap.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/roadmaps/:roadmapId
       * Update a roadmap
       */
      PATCH: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')

          const body = await request.json()
          const parsed = updateRoadmapSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { updateRoadmap } = await import('@/lib/server/domains/roadmaps/roadmap.service')

          const roadmap = await updateRoadmap(roadmapId, {
            name: parsed.data.name,
            description: parsed.data.description,
            isPublic: parsed.data.isPublic,
            allowedSegmentIds: parsed.data.allowedSegmentIds,
            allowedTeamPrincipalIds: parsed.data.allowedTeamPrincipalIds,
            timelineAccess: parsed.data.timelineAccess,
          })

          return successResponse({
            id: roadmap.id,
            name: roadmap.name,
            slug: roadmap.slug,
            description: roadmap.description,
            isPublic: roadmap.isPublic,
            allowedSegmentIds: roadmap.allowedSegmentIds,
            allowedTeamPrincipalIds: roadmap.allowedTeamPrincipalIds,
            timelineAccess: roadmap.timelineAccess,
            position: roadmap.position,
            createdAt: roadmap.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/roadmaps/:roadmapId
       * Delete a roadmap
       */
      DELETE: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')

          const { deleteRoadmap } = await import('@/lib/server/domains/roadmaps/roadmap.service')

          await deleteRoadmap(roadmapId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
