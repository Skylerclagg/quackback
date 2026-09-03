/**
 * External changelog sources — sites Quackback imports releases from, one
 * changelog entry per release (e.g. a product's VitePress changelog page).
 */
import { pgTable, text, boolean, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { changelogCategories } from './changelog-categories'

export const CHANGELOG_SOURCE_KINDS = ['vitepress', 'json'] as const
export type ChangelogSourceKind = (typeof CHANGELOG_SOURCE_KINDS)[number]

export const changelogSources = pgTable(
  'changelog_sources',
  {
    id: typeIdWithDefault('changelog_source')('id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    /** How the page is read: a VitePress changelog page, or a JSON release feed. */
    kind: text('kind', { enum: CHANGELOG_SOURCE_KINDS }).default('vitepress').notNull(),
    /** Collection (slugged category) imported entries are filed under. */
    categoryId: typeIdColumnNullable('changelog_category')('category_id').references(
      () => changelogCategories.id,
      { onDelete: 'set null' }
    ),
    /** Read audience given to imported entries. */
    visibility: text('visibility').default('public').notNull(),
    /** 'published' or 'draft': how new entries land. */
    publishAs: text('publish_as').default('published').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    /** Author of imported entries (the admin who added the source). */
    createdByPrincipalId: typeIdColumnNullable('principal')('created_by_principal_id'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('changelog_sources_enabled_idx').on(table.enabled)]
)

export const changelogSourcesRelations = relations(changelogSources, ({ one }) => ({
  category: one(changelogCategories, {
    fields: [changelogSources.categoryId],
    references: [changelogCategories.id],
  }),
}))

export type ChangelogSource = typeof changelogSources.$inferSelect
export type NewChangelogSource = typeof changelogSources.$inferInsert
