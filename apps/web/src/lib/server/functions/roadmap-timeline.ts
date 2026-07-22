/**
 * Server functions for the roadmap timeline view.
 *
 * Team surface: fetch/edit placements, milestones, and bucket order —
 * all gated by requireRoadmapAccess (same audience rules as every
 * other roadmap surface). Public surface: fetchPublicRoadmapTimeline,
 * gated by the portal-access resolver plus canViewRoadmap +
 * boardViewFilter inside the domain query.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { MilestoneId, PostId, RoadmapId } from '@quackback/ids'
import {
  getOptionalAuth,
  hasAuthCredentials,
  policyActorFromAuth,
  requireAuth,
  teamActorFromAuth,
} from './auth-helpers'
import { requireRoadmapAccess } from './roadmap-access'
import { timelineSpecificityFor } from '@/lib/server/policy'
import { clampTimelinePlacement } from '@/lib/shared/timeline'
import { resolvePortalAccessForRequest } from './portal-access'
import {
  createMilestone,
  deleteMilestone,
  getMilestone,
  getPublicRoadmapTimeline,
  getRoadmapTimeline,
  reorderTimelineBucket,
  setPostTimelinePlacement,
  updateMilestone,
  type RoadmapTimelineResult,
} from '@/lib/server/domains/roadmaps/roadmap.timeline'
import { TIMELINE_PRECISIONS } from '@/lib/shared/timeline'
import { NotFoundError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'roadmap-timeline' })

const precisionSchema = z.enum(TIMELINE_PRECISIONS)

const roadmapIdSchema = z.object({ roadmapId: z.string() })

const placementSchema = z.object({
  roadmapId: z.string(),
  postId: z.string(),
  // null date = remove from the timeline (back to Unscheduled).
  date: z.coerce.date().nullable(),
  precision: precisionSchema.nullable(),
})

const createMilestoneSchema = z.object({
  roadmapId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  date: z.coerce.date(),
  precision: precisionSchema,
})

const updateMilestoneSchema = z.object({
  milestoneId: z.string(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  date: z.coerce.date().optional(),
  precision: precisionSchema.optional(),
})

const reorderBucketSchema = z.object({
  roadmapId: z.string(),
  items: z.array(z.object({ kind: z.enum(['post', 'milestone']), id: z.string() })).max(200),
})

/** Serialize the timeline result for turbo-stream (Dates → ISO). */
function serializeTimeline(result: RoadmapTimelineResult) {
  return {
    posts: result.posts.map((p) => ({
      ...p,
      id: String(p.id),
      statusId: p.statusId ? String(p.statusId) : null,
      board: { id: String(p.board.id), name: p.board.name, slug: p.board.slug },
      timelineDate: p.timelineDate ? p.timelineDate.toISOString() : null,
    })),
    milestones: result.milestones.map((m) => ({
      ...m,
      id: String(m.id),
      timelineDate: m.timelineDate.toISOString(),
    })),
  }
}

// ============================================
// Team surface
// ============================================

export const getRoadmapTimelineFn = createServerFn({ method: 'GET' })
  .validator(roadmapIdSchema)
  .handler(async ({ data }) => {
    log.debug({ roadmap_id: data.roadmapId }, 'get roadmap timeline')
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })
      const roadmap = await requireRoadmapAccess(auth, data.roadmapId as RoadmapId)

      // Members can be individually capped (or hidden) via
      // timelineAccess.teamMembers — the same coarsening the portal
      // applies, so a capped member never sees finer dates through the
      // admin surface either. Admins always get full specificity.
      const cap = timelineSpecificityFor(teamActorFromAuth(auth), roadmap)
      if (cap === 'hidden') {
        throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${data.roadmapId} not found`)
      }
      const result = await getRoadmapTimeline(data.roadmapId as RoadmapId)
      if (cap !== 'day') {
        result.posts = result.posts.map((p) => {
          if (!p.timelineDate || !p.timelinePrecision) return p
          const clamped = clampTimelinePlacement(p.timelineDate, p.timelinePrecision, cap)
          return { ...p, timelineDate: clamped.date, timelinePrecision: clamped.precision }
        })
        result.milestones = result.milestones.map((m) => {
          const clamped = clampTimelinePlacement(m.timelineDate, m.timelinePrecision, cap)
          return { ...m, timelineDate: clamped.date, timelinePrecision: clamped.precision }
        })
      }
      return serializeTimeline(result)
    } catch (error) {
      log.error({ err: error }, 'get roadmap timeline failed')
      throw error
    }
  })

export const setPostTimelinePlacementFn = createServerFn({ method: 'POST' })
  .validator(placementSchema)
  .handler(async ({ data }) => {
    log.debug({ roadmap_id: data.roadmapId, post_id: data.postId }, 'set timeline placement')
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })
      await requireRoadmapAccess(auth, data.roadmapId as RoadmapId)

      await setPostTimelinePlacement(
        data.roadmapId as RoadmapId,
        data.postId as PostId,
        data.date && data.precision ? { date: data.date, precision: data.precision } : null
      )
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'set timeline placement failed')
      throw error
    }
  })

export const createMilestoneFn = createServerFn({ method: 'POST' })
  .validator(createMilestoneSchema)
  .handler(async ({ data }) => {
    log.debug({ roadmap_id: data.roadmapId }, 'create milestone')
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })
      await requireRoadmapAccess(auth, data.roadmapId as RoadmapId)

      const milestone = await createMilestone(data.roadmapId as RoadmapId, {
        title: data.title,
        description: data.description,
        date: data.date,
        precision: data.precision,
      })
      return { id: String(milestone.id) }
    } catch (error) {
      log.error({ err: error }, 'create milestone failed')
      throw error
    }
  })

export const updateMilestoneFn = createServerFn({ method: 'POST' })
  .validator(updateMilestoneSchema)
  .handler(async ({ data }) => {
    log.debug({ milestone_id: data.milestoneId }, 'update milestone')
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })
      const milestone = await getMilestone(data.milestoneId as MilestoneId)
      await requireRoadmapAccess(auth, milestone.roadmapId as RoadmapId)

      await updateMilestone(data.milestoneId as MilestoneId, {
        title: data.title,
        description: data.description,
        date: data.date,
        precision: data.precision,
      })
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'update milestone failed')
      throw error
    }
  })

export const deleteMilestoneFn = createServerFn({ method: 'POST' })
  .validator(z.object({ milestoneId: z.string() }))
  .handler(async ({ data }) => {
    log.debug({ milestone_id: data.milestoneId }, 'delete milestone')
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })
      const milestone = await getMilestone(data.milestoneId as MilestoneId)
      await requireRoadmapAccess(auth, milestone.roadmapId as RoadmapId)

      await deleteMilestone(data.milestoneId as MilestoneId)
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'delete milestone failed')
      throw error
    }
  })

export const reorderTimelineBucketFn = createServerFn({ method: 'POST' })
  .validator(reorderBucketSchema)
  .handler(async ({ data }) => {
    log.debug({ roadmap_id: data.roadmapId, count: data.items.length }, 'reorder timeline bucket')
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })
      await requireRoadmapAccess(auth, data.roadmapId as RoadmapId)

      await reorderTimelineBucket(data.roadmapId as RoadmapId, data.items)
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'reorder timeline bucket failed')
      throw error
    }
  })

// ============================================
// Public surface
// ============================================

export const fetchPublicRoadmapTimeline = createServerFn({ method: 'GET' })
  .validator(roadmapIdSchema)
  .handler(async ({ data }) => {
    log.debug({ roadmap_id: data.roadmapId }, 'fetch public roadmap timeline')
    try {
      // Outer gate: private portal + unauthorized caller → not found,
      // indistinguishable from a missing roadmap.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${data.roadmapId} not found`)
      }

      const auth = hasAuthCredentials() ? await getOptionalAuth() : null
      const actor = await policyActorFromAuth(auth)

      return serializeTimeline(await getPublicRoadmapTimeline(data.roadmapId as RoadmapId, actor))
    } catch (error) {
      log.error({ err: error }, 'fetch public roadmap timeline failed')
      throw error
    }
  })
