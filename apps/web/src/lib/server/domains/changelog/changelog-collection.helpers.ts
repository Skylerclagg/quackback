/**
 * Collection lookups shared by the entry service and the collection
 * service.
 *
 * Deliberately a leaf module: it imports only the db and error layers,
 * never `@/lib/server/policy`. Keeping these two functions out of
 * changelog-collection.service.ts means changelog.service.ts (pure
 * CRUD) doesn't transitively pull the policy barrel into its import
 * graph just to resolve a collection name.
 */

import { db, changelogs, eq, and, isNull } from '@/lib/server/db'
import type { ChangelogCollectionId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import type { ChangelogCollectionRef } from './changelog.types'

/**
 * Validate a collection id points at a live collection. Returns void;
 * throws NotFoundError otherwise. Null (the built-in "General"
 * changelog) is always valid and never hits the database.
 */
export async function assertCollectionExists(
  changelogId: ChangelogCollectionId | null
): Promise<void> {
  if (changelogId === null) return
  const collection = await db.query.changelogs.findFirst({
    where: and(eq(changelogs.id, changelogId), isNull(changelogs.deletedAt)),
    columns: { id: true },
  })
  if (!collection) {
    throw new NotFoundError(
      'CHANGELOG_NOT_FOUND',
      `Changelog collection with ID ${changelogId} not found`
    )
  }
}

/**
 * Slim collection reference for embedding on an entry. Returns null for
 * General entries and for collections that have been soft-deleted (such
 * an entry renders as General until the delete's reassignment lands).
 */
export async function getCollectionRef(
  changelogId: ChangelogCollectionId | null | undefined
): Promise<ChangelogCollectionRef | null> {
  if (!changelogId) return null
  const collection = await db.query.changelogs.findFirst({
    where: and(eq(changelogs.id, changelogId), isNull(changelogs.deletedAt)),
    columns: { id: true, slug: true, name: true },
  })
  return collection ?? null
}
