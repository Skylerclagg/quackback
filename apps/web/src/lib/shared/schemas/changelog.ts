/**
 * Zod Schemas for Changelog Operations
 *
 * Shared validation schemas used by both client and server.
 */

import { z } from 'zod'
import { tiptapContentSchema } from './posts'

/**
 * Publish state schema
 */
export const publishStateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('draft') }),
  z.object({ type: z.literal('scheduled'), publishAt: z.coerce.date() }),
  z.object({ type: z.literal('published'), publishAt: z.coerce.date().optional() }),
])

/**
 * Create changelog input schema
 */
export const createChangelogSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string(),
  contentJson: tiptapContentSchema.nullable().optional(),
  /** Collection the entry belongs to; null/omitted = the built-in "General" changelog. */
  changelogId: z.string().nullable().optional(),
  linkedPostIds: z.array(z.string()).optional(),
  publishState: publishStateSchema,
  displayDate: z.coerce.date().nullable().optional(),
  isPublic: z.boolean().optional(),
  allowedSegmentIds: z.array(z.string()).max(100).optional(),
  allowedTeamPrincipalIds: z.array(z.string()).max(100).optional(),
})

/**
 * Update changelog input schema
 */
export const updateChangelogSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  contentJson: tiptapContentSchema.nullable().optional(),
  /** Collection to move the entry to; null = the built-in "General" changelog. */
  changelogId: z.string().nullable().optional(),
  linkedPostIds: z.array(z.string()).optional(),
  publishState: publishStateSchema.optional(),
  displayDate: z.coerce.date().nullable().optional(),
  isPublic: z.boolean().optional(),
  allowedSegmentIds: z.array(z.string()).max(100).optional(),
  allowedTeamPrincipalIds: z.array(z.string()).max(100).optional(),
})

/**
 * List changelogs params schema
 */
export const listChangelogsSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'published', 'all']).optional(),
  /** Collection filter: a collection id, 'general', or omitted for all. */
  changelogId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
})

/**
 * Changelog collection schemas
 */
export const createChangelogCollectionSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  description: z.string().max(500).nullable().optional(),
  roadmapId: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
  allowedSegmentIds: z.array(z.string()).max(100).optional(),
  allowedTeamPrincipalIds: z.array(z.string()).max(100).optional(),
})

export const updateChangelogCollectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  roadmapId: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
  allowedSegmentIds: z.array(z.string()).max(100).optional(),
  allowedTeamPrincipalIds: z.array(z.string()).max(100).optional(),
})

export const deleteChangelogCollectionSchema = z.object({
  id: z.string().min(1),
})

/**
 * Get changelog by ID schema
 */
export const getChangelogSchema = z.object({
  id: z.string().min(1),
})

/**
 * Delete changelog schema
 */
export const deleteChangelogSchema = z.object({
  id: z.string().min(1),
})

/**
 * List public changelogs params schema
 */
export const listPublicChangelogsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
  /** Collection filter: a collection slug, 'general', or omitted for all. */
  changelog: z.string().optional(),
})

// Export types inferred from schemas
export type CreateChangelogInput = z.infer<typeof createChangelogSchema>
export type UpdateChangelogInput = z.infer<typeof updateChangelogSchema>
export type ListChangelogsParams = z.infer<typeof listChangelogsSchema>
export type PublishState = z.infer<typeof publishStateSchema>

/**
 * Convert a server-side status + publishedAt into a PublishState discriminated union.
 * The publishedAt value is carried through for published entries so that later
 * updates don't silently reset the publish date to `now()` — the update path in
 * changelog.service.ts does `state.publishAt ?? new Date()` and would otherwise
 * clobber the original timestamp every time anything on the entry was edited.
 */
export function toPublishState(
  status: 'draft' | 'scheduled' | 'published',
  publishedAt: string | Date | null
): PublishState {
  switch (status) {
    case 'draft':
      return { type: 'draft' }
    case 'scheduled':
      return { type: 'scheduled', publishAt: publishedAt ? new Date(publishedAt) : new Date() }
    case 'published':
      return {
        type: 'published',
        publishAt: publishedAt ? new Date(publishedAt) : undefined,
      }
  }
}

/**
 * Derive a PublishState from an optional publishedAt ISO datetime string.
 *
 * - No value / undefined -> draft
 * - Future date -> scheduled (carries the target date)
 * - Past or current date -> published (carries the date so backdating works;
 *   without this, the service layer falls back to `new Date()` and the entry
 *   gets stamped with the current moment instead of the requested past date)
 */
export function publishedAtToPublishState(publishedAt?: string): PublishState {
  if (!publishedAt) {
    return { type: 'draft' }
  }
  const publishDate = new Date(publishedAt)
  if (publishDate > new Date()) {
    return { type: 'scheduled', publishAt: publishDate }
  }
  return { type: 'published', publishAt: publishDate }
}
