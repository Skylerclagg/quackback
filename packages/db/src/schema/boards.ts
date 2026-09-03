import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  check,
  boolean,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import {
  type BoardSettings,
  type BoardAccess,
  type RoadmapBaseFilter,
  ROADMAP_TYPES,
  ROADMAP_DATE_SOURCES,
  ROADMAP_FREQUENCIES,
  ROADMAP_VISIBILITIES,
  DEFAULT_BOARD_ACCESS,
  TIMELINE_PRECISIONS,
  DEFAULT_ETA_DISCLOSURE,
  type EtaDisclosure,
} from '../types'
import { postStatuses } from './statuses'

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
    type: text('type', { enum: ROADMAP_TYPES }).default('column').notNull(),
    baseFilter: jsonb('base_filter').$type<RoadmapBaseFilter>().default({}).notNull(),
    dateSource: text('date_source', { enum: ROADMAP_DATE_SOURCES }),
    frequency: text('frequency', { enum: ROADMAP_FREQUENCIES }),
    visibility: text('visibility', { enum: ROADMAP_VISIBILITIES }).default('public').notNull(),
    visibleSegmentIds: jsonb('visible_segment_ids').$type<string[] | null>(),
    /**
     * Narrows the 'team' and 'segment' tiers to specific teammates. Tri-state,
     * and null is the meaningful default: null = every team actor (what every
     * pre-existing roadmap means), [] = admins only, [ids] = admins plus those
     * member-role principals. Read with `?? null`, never `?? []`.
     * Same shape as changelog_entries.allowed_team_principal_ids — both bind to
     * policy/audience.ts.
     */
    allowedTeamPrincipalIds: jsonb('allowed_team_principal_ids').$type<string[] | null>(),
    /**
     * Per-audience cap on how specific ETAs render. Team admins always see full
     * dates; portal viewers take the finest cap among `default` and any segment
     * override they match. See policy/roadmaps.ts etaDisclosureFor.
     */
    etaDisclosure: jsonb('eta_disclosure')
      .$type<EtaDisclosure>()
      .default(DEFAULT_ETA_DISCLOSURE)
      .notNull(),
    /**
     * Offer a date-bucketed timeline tab alongside a COLUMN roadmap. Upstream
     * made `type` exclusive (column OR date); this is the additive way to give
     * one roadmap both presentations without touching that check constraint.
     * Meaningless on a 'date' roadmap, which is already the timeline.
     */
    timelineEnabled: boolean('timeline_enabled').default(false).notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Note: roadmaps_slug_unique constraint already provides uniqueness; no separate index needed
    index('roadmaps_position_idx').on(table.position),
    index('roadmaps_visibility_idx').on(table.visibility),
    index('roadmaps_deleted_at_idx').on(table.deletedAt),
    check('roadmaps_type_check', sql`${table.type} IN ('column', 'date')`),
    check(
      'roadmaps_date_source_check',
      sql`${table.dateSource} IS NULL OR ${table.dateSource} = 'eta'`
    ),
    check(
      'roadmaps_frequency_check',
      sql`${table.frequency} IS NULL OR ${table.frequency} IN ('monthly', 'quarterly', 'semiannual')`
    ),
    check('roadmaps_visibility_check', sql`${table.visibility} IN ('public', 'team', 'segment')`),
    check('roadmaps_base_filter_object_check', sql`jsonb_typeof(${table.baseFilter}) = 'object'`),
    check(
      'roadmaps_visible_segment_ids_array_check',
      sql`${table.visibleSegmentIds} IS NULL OR jsonb_typeof(${table.visibleSegmentIds}) = 'array'`
    ),
    check(
      'roadmaps_type_config_check',
      sql`(
        (${table.type} = 'column' AND ${table.dateSource} IS NULL AND ${table.frequency} IS NULL)
        OR
        (${table.type} = 'date' AND ${table.dateSource} = 'eta' AND ${table.frequency} IS NOT NULL)
      )`
    ),
  ]
)

export const roadmapColumns = pgTable(
  'roadmap_columns',
  {
    id: typeIdWithDefault('roadmap_col')('id').primaryKey(),
    roadmapId: typeIdColumn('roadmap')('roadmap_id')
      .notNull()
      .references(() => roadmaps.id, { onDelete: 'cascade' }),
    statusId: typeIdColumn('post_status')('status_id')
      .notNull()
      .references(() => postStatuses.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    icon: text('icon'),
    color: text('color').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('roadmap_columns_roadmap_status_unique').on(table.roadmapId, table.statusId),
    index('roadmap_columns_roadmap_position_idx').on(table.roadmapId, table.position),
    index('roadmap_columns_status_id_idx').on(table.statusId),
  ]
)

export const postTags = pgTable(
  'post_tags',
  {
    id: typeIdWithDefault('post_tag')('id').primaryKey(),
    name: text('name').notNull().unique(),
    color: text('color').default('#6b7280').notNull(),
    description: text('description'),
    // Matching rule for AI auto-tagging: new posts are evaluated against every
    // tag whose prompt is set, and matching tags are assigned automatically.
    aiPrompt: text('ai_prompt'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('post_tags_deleted_at_idx').on(table.deletedAt)]
)

/**
 * Dated free-text entries on a roadmap timeline ("GA launch", "Beta closes").
 * Content, not periods: since migration 0199 everything else on a roadmap is a
 * post matched by base_filter, so this is the only home for an entry that is
 * not a post. Dates are normalised to the start of their precision's period on
 * write so equal buckets compare equal in SQL.
 */
export const roadmapMilestones = pgTable(
  'roadmap_milestones',
  {
    id: typeIdWithDefault('milestone')('id').primaryKey(),
    roadmapId: typeIdColumn('roadmap')('roadmap_id')
      .notNull()
      .references(() => roadmaps.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    timelineDate: timestamp('timeline_date', { withTimezone: true }).notNull(),
    timelinePrecision: text('timeline_precision', { enum: TIMELINE_PRECISIONS })
      .default('month')
      .notNull(),
    /** Manual order within a bucket. */
    timelinePosition: integer('timeline_position').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('roadmap_milestones_roadmap_id_idx').on(table.roadmapId),
    index('roadmap_milestones_timeline_date_idx').on(table.timelineDate),
  ]
)

export type RoadmapMilestone = typeof roadmapMilestones.$inferSelect
export type NewRoadmapMilestone = typeof roadmapMilestones.$inferInsert

// Relations - defined after posts import to avoid circular dependency
import { posts } from './posts'
import { changelogEntries } from './changelog'

export const boardsRelations = relations(boards, ({ many }) => ({
  posts: many(posts),
  changelogEntries: many(changelogEntries),
}))

export const roadmapsRelations = relations(roadmaps, ({ many }) => ({
  columns: many(roadmapColumns),
  milestones: many(roadmapMilestones),
}))

export const roadmapMilestonesRelations = relations(roadmapMilestones, ({ one }) => ({
  roadmap: one(roadmaps, {
    fields: [roadmapMilestones.roadmapId],
    references: [roadmaps.id],
  }),
}))

export const roadmapColumnsRelations = relations(roadmapColumns, ({ one }) => ({
  roadmap: one(roadmaps, {
    fields: [roadmapColumns.roadmapId],
    references: [roadmaps.id],
  }),
  status: one(postStatuses, {
    fields: [roadmapColumns.statusId],
    references: [postStatuses.id],
  }),
}))

export const postTagsRelations = relations(postTags, ({ many }) => ({
  postTagAssignments: many(postTagAssignments),
}))

import { postTagAssignments } from './posts'
