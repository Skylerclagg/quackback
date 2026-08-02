import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  jsonb,
  boolean,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { posts } from './posts'
import { roadmaps } from './boards'
import type { TiptapContent } from '../types'

// Named changelog collections. Entries with changelog_id = NULL belong to the
// built-in "General" changelog, so a fresh install works without any rows
// here. A collection can optionally be tied to a roadmap (informational link;
// deleting the roadmap keeps the changelog). Audience columns mirror
// roadmaps/changelog_entries and gate every entry inside the collection in
// ADDITION to the entry's own audience.
export const changelogs = pgTable(
  'changelogs',
  {
    id: typeIdWithDefault('clog')('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    roadmapId: typeIdColumnNullable('roadmap')('roadmap_id').references(() => roadmaps.id, {
      onDelete: 'set null',
    }),
    isPublic: boolean('is_public').default(true).notNull(),
    allowedSegmentIds: jsonb('allowed_segment_ids').$type<string[]>().default([]).notNull(),
    allowedTeamPrincipalIds: jsonb('allowed_team_principal_ids')
      .$type<string[]>()
      .default([])
      .notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('changelogs_roadmap_id_idx').on(table.roadmapId),
    index('changelogs_position_idx').on(table.position),
    index('changelogs_deleted_at_idx').on(table.deletedAt),
  ]
)

export const changelogEntries = pgTable(
  'changelog_entries',
  {
    id: typeIdWithDefault('changelog')('id').primaryKey(),
    // NULL = the built-in "General" changelog. ON DELETE SET NULL so entries
    // fall back to General when their collection is hard-deleted.
    changelogId: typeIdColumnNullable('clog')('changelog_id').references(() => changelogs.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    // Rich content stored as TipTap JSON (optional, for rich text support)
    contentJson: jsonb('content_json').$type<TiptapContent>(),
    // Author tracking (principal who created/last edited - only shown in admin views)
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    displayDate: timestamp('display_date', { withTimezone: true }),
    // Audience controls, mirroring roadmaps (boards.ts). Both lists are
    // ignored while isPublic. A private entry is visible to admins,
    // member-role principals in allowedTeamPrincipalIds, and portal
    // users in at least one allowedSegmentIds segment. Publication
    // state (publishedAt) gates independently of audience.
    isPublic: boolean('is_public').default(true).notNull(),
    allowedSegmentIds: jsonb('allowed_segment_ids').$type<string[]>().default([]).notNull(),
    allowedTeamPrincipalIds: jsonb('allowed_team_principal_ids')
      .$type<string[]>()
      .default([])
      .notNull(),
    // Timestamp the publish notification was sent; null until dispatched.
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // View count for analytics (incremented on public/widget page load)
    viewCount: integer('view_count').default(0).notNull(),
  },
  (table) => [
    index('changelog_published_at_idx').on(table.publishedAt),
    index('changelog_principal_id_idx').on(table.principalId),
    index('changelog_deleted_at_idx').on(table.deletedAt),
    index('changelog_entries_changelog_id_idx').on(table.changelogId),
  ]
)

// Junction table for linking changelog entries to shipped posts
export const changelogEntryPosts = pgTable(
  'changelog_entry_posts',
  {
    changelogEntryId: typeIdColumn('changelog')('changelog_entry_id')
      .notNull()
      .references(() => changelogEntries.id, { onDelete: 'cascade' }),
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('changelog_entry_posts_pk').on(table.changelogEntryId, table.postId),
    index('changelog_entry_posts_changelog_id_idx').on(table.changelogEntryId),
    index('changelog_entry_posts_post_id_idx').on(table.postId),
  ]
)

export const changelogsRelations = relations(changelogs, ({ one, many }) => ({
  roadmap: one(roadmaps, {
    fields: [changelogs.roadmapId],
    references: [roadmaps.id],
  }),
  entries: many(changelogEntries),
}))

export const changelogEntriesRelations = relations(changelogEntries, ({ one, many }) => ({
  changelog: one(changelogs, {
    fields: [changelogEntries.changelogId],
    references: [changelogs.id],
  }),
  author: one(principal, {
    fields: [changelogEntries.principalId],
    references: [principal.id],
    relationName: 'changelogAuthor',
  }),
  linkedPosts: many(changelogEntryPosts),
}))

export const changelogEntryPostsRelations = relations(changelogEntryPosts, ({ one }) => ({
  changelogEntry: one(changelogEntries, {
    fields: [changelogEntryPosts.changelogEntryId],
    references: [changelogEntries.id],
  }),
  post: one(posts, {
    fields: [changelogEntryPosts.postId],
    references: [posts.id],
  }),
}))
