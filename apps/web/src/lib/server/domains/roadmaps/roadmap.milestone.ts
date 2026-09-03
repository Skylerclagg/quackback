/**
 * Roadmap milestones — dated free-text entries on a roadmap timeline.
 *
 * Content, not periods: since migration 0199 everything else on a roadmap is a
 * post matched by `base_filter`, so this is the only home for an entry like
 * "GA launch" that is not a post. Bucket semantics live in lib/shared/timeline.ts;
 * this module only reads and writes rows, always normalising a date to the
 * start of its precision's period so equal buckets compare equal in SQL.
 */
import { db, eq, and, asc, isNull, sql, roadmaps, roadmapMilestones } from '@/lib/server/db'
import type { RoadmapMilestone } from '@/lib/server/db'
import type { MilestoneId, RoadmapId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { ANONYMOUS_ACTOR, canViewRoadmap, etaDisclosureFor, type Actor } from '@/lib/server/policy'
import {
  TIMELINE_PRECISIONS,
  clampTimelinePlacement,
  normalizeTimelineDate,
} from '@/lib/shared/timeline'
import type { TimelinePrecision } from '@/lib/shared/db-types'

function assertPrecision(precision: string): asserts precision is TimelinePrecision {
  if (!TIMELINE_PRECISIONS.includes(precision as TimelinePrecision)) {
    throw new ValidationError('VALIDATION_ERROR', `Invalid timeline precision "${precision}"`)
  }
}

/** Team-side list: every milestone, exact dates. Roadmap access is the caller's job. */
export async function listRoadmapMilestones(roadmapId: RoadmapId): Promise<RoadmapMilestone[]> {
  return db.query.roadmapMilestones.findMany({
    where: eq(roadmapMilestones.roadmapId, roadmapId),
    orderBy: [asc(roadmapMilestones.timelineDate), asc(roadmapMilestones.timelinePosition)],
  })
}

/**
 * Portal-side list. canViewRoadmap 404s a restricted roadmap; the viewer's
 * disclosure cap then coarsens every date HERE, server-side, so the precise
 * date never leaves the server. A 'hidden' cap returns nothing rather than
 * 404ing, because the roadmap itself may still be visible as columns.
 */
export async function listPublicRoadmapMilestones(
  roadmapId: RoadmapId,
  actor: Actor = ANONYMOUS_ACTOR
): Promise<RoadmapMilestone[]> {
  const roadmap = await db.query.roadmaps.findFirst({
    where: and(eq(roadmaps.id, roadmapId), isNull(roadmaps.deletedAt)),
  })
  if (!roadmap || !canViewRoadmap(actor, roadmap).allowed) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }
  const cap = etaDisclosureFor(actor, roadmap)
  if (cap === 'hidden') return []

  const milestones = await listRoadmapMilestones(roadmapId)
  if (cap === 'day') return milestones
  return milestones.map((m) => {
    const clamped = clampTimelinePlacement(m.timelineDate, m.timelinePrecision, cap)
    return { ...m, timelineDate: clamped.date, timelinePrecision: clamped.precision }
  })
}

/** Next position within a (roadmap, date, precision) bucket. */
async function nextBucketPosition(
  roadmapId: RoadmapId,
  date: Date,
  precision: TimelinePrecision
): Promise<number> {
  // eq() rather than a raw template so the Date goes through the timestamp
  // column's driver mapping — postgres.js rejects raw Date params.
  const [row] = await db
    .select({ max: sql<number>`COALESCE(MAX(${roadmapMilestones.timelinePosition}), -1)` })
    .from(roadmapMilestones)
    .where(
      and(
        eq(roadmapMilestones.roadmapId, roadmapId),
        eq(roadmapMilestones.timelineDate, date),
        eq(roadmapMilestones.timelinePrecision, precision)
      )
    )
  return Number(row?.max ?? -1) + 1
}

export async function createMilestone(
  roadmapId: RoadmapId,
  input: { title: string; description?: string | null; date: Date; precision: TimelinePrecision }
): Promise<RoadmapMilestone> {
  if (!input.title?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  if (input.title.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must be 200 characters or less')
  }
  assertPrecision(input.precision)
  const roadmap = await db.query.roadmaps.findFirst({
    where: and(eq(roadmaps.id, roadmapId), isNull(roadmaps.deletedAt)),
  })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }

  const normalized = normalizeTimelineDate(input.date, input.precision)
  const [milestone] = await db
    .insert(roadmapMilestones)
    .values({
      roadmapId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      timelineDate: normalized,
      timelinePrecision: input.precision,
      timelinePosition: await nextBucketPosition(roadmapId, normalized, input.precision),
    })
    .returning()
  return milestone!
}

export async function getMilestone(id: MilestoneId): Promise<RoadmapMilestone> {
  const milestone = await db.query.roadmapMilestones.findFirst({
    where: eq(roadmapMilestones.id, id),
  })
  if (!milestone) {
    throw new NotFoundError('MILESTONE_NOT_FOUND', `Milestone with ID ${id} not found`)
  }
  return milestone
}

export async function updateMilestone(
  id: MilestoneId,
  input: { title?: string; description?: string | null; date?: Date; precision?: TimelinePrecision }
): Promise<RoadmapMilestone> {
  const existing = await getMilestone(id)
  if (input.title !== undefined && !input.title.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Title cannot be empty')
  }
  if (input.title && input.title.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must be 200 characters or less')
  }

  const updateData: Partial<RoadmapMilestone> = { updatedAt: new Date() }
  if (input.title !== undefined) updateData.title = input.title.trim()
  if (input.description !== undefined) updateData.description = input.description?.trim() || null

  if (input.date !== undefined || input.precision !== undefined) {
    const precision = input.precision ?? existing.timelinePrecision
    assertPrecision(precision)
    const normalized = normalizeTimelineDate(input.date ?? existing.timelineDate, precision)
    updateData.timelineDate = normalized
    updateData.timelinePrecision = precision
    // Bucket moved → append to the destination bucket's end.
    const bucketChanged =
      normalized.getTime() !== existing.timelineDate.getTime() ||
      precision !== existing.timelinePrecision
    if (bucketChanged) {
      updateData.timelinePosition = await nextBucketPosition(
        existing.roadmapId as RoadmapId,
        normalized,
        precision
      )
    }
  }

  const [updated] = await db
    .update(roadmapMilestones)
    .set(updateData)
    .where(eq(roadmapMilestones.id, id))
    .returning()
  return updated!
}

export async function deleteMilestone(id: MilestoneId): Promise<void> {
  const result = await db
    .delete(roadmapMilestones)
    .where(eq(roadmapMilestones.id, id))
    .returning({ id: roadmapMilestones.id })
  if (result.length === 0) {
    throw new NotFoundError('MILESTONE_NOT_FOUND', `Milestone with ID ${id} not found`)
  }
}
