import { pgTable, text, timestamp, boolean, jsonb, integer, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import {
  type BoardSettings,
  type BoardAccess,
  type TimelinePrecision,
  type TimelineAccess,
  DEFAULT_BOARD_ACCESS,
  DEFAULT_TIMELINE_ACCESS,
} from '../types'

export const boards = pgTable(
  'boards',
  {
    id: typeIdWithDefault('board')('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    // v1 access controls — per-action tier matrix. Replaces the legacy
    // `audience` jsonb column (dropped in migration 0080) and the older
    // `is_public` boolean before that.
    access: jsonb('access').$type<BoardAccess>().default(DEFAULT_BOARD_ACCESS).notNull(),
    settings: jsonb('settings').$type<BoardSettings>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Note: boards_slug_unique constraint already provides uniqueness; no separate index needed
    index('boards_deleted_at_idx').on(table.deletedAt),
  ]
)

export const roadmaps = pgTable(
  'roadmaps',
  {
    id: typeIdWithDefault('roadmap')('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').default(true).notNull(),
    // Access lists for private roadmaps (both ignored while isPublic).
    // Segments grant portal users access; the team list grants
    // non-admin team members access (admins always see every roadmap).
    // Empty lists = admins only. Stored as plain strings like
    // BoardAccess.segments.
    allowedSegmentIds: jsonb('allowed_segment_ids').$type<string[]>().default([]).notNull(),
    allowedTeamPrincipalIds: jsonb('allowed_team_principal_ids')
      .$type<string[]>()
      .default([])
      .notNull(),
    // Per-audience cap on how specifically the timeline dates render
    // on the portal (hidden … exact day) — independent of roadmap
    // visibility. Team always sees full specificity. See
    // TimelineAccess in ../types.
    timelineAccess: jsonb('timeline_access')
      .$type<TimelineAccess>()
      .default(DEFAULT_TIMELINE_ACCESS)
      .notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Note: roadmaps_slug_unique constraint already provides uniqueness; no separate index needed
    index('roadmaps_position_idx').on(table.position),
    index('roadmaps_is_public_idx').on(table.isPublic),
    index('roadmaps_deleted_at_idx').on(table.deletedAt),
  ]
)

// Custom timeline entries on a roadmap — free-text items ("Mobile app
// beta") not tied to any feedback post. They share bucket semantics
// and timelinePosition ordering with post_roadmaps timeline fields.
export const roadmapMilestones = pgTable(
  'roadmap_milestones',
  {
    id: typeIdWithDefault('milestone')('id').primaryKey(),
    roadmapId: typeIdColumn('roadmap')('roadmap_id')
      .notNull()
      .references(() => roadmaps.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    // Normalized to the bucket start for its precision (see
    // lib/shared/timeline.ts).
    timelineDate: timestamp('timeline_date', { withTimezone: true }).notNull(),
    timelinePrecision: text('timeline_precision')
      .$type<TimelinePrecision>()
      .notNull()
      .default('month'),
    timelinePosition: integer('timeline_position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('roadmap_milestones_roadmap_id_idx').on(table.roadmapId),
    index('roadmap_milestones_timeline_date_idx').on(table.timelineDate),
  ]
)

export const tags = pgTable(
  'tags',
  {
    id: typeIdWithDefault('tag')('id').primaryKey(),
    name: text('name').notNull().unique(),
    color: text('color').default('#6b7280').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('tags_deleted_at_idx').on(table.deletedAt)]
)

// Relations - defined after posts import to avoid circular dependency
import { posts, postRoadmaps } from './posts'
import { changelogEntries } from './changelog'

export const boardsRelations = relations(boards, ({ many }) => ({
  posts: many(posts),
  changelogEntries: many(changelogEntries),
}))

export const roadmapsRelations = relations(roadmaps, ({ many }) => ({
  postRoadmaps: many(postRoadmaps),
  milestones: many(roadmapMilestones),
}))

export const roadmapMilestonesRelations = relations(roadmapMilestones, ({ one }) => ({
  roadmap: one(roadmaps, {
    fields: [roadmapMilestones.roadmapId],
    references: [roadmaps.id],
  }),
}))

export const tagsRelations = relations(tags, ({ many }) => ({
  postTags: many(postTags),
}))

import { postTags } from './posts'
