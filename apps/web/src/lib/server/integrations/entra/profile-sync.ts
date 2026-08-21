/**
 * Fill in missing account names from the directory.
 *
 * Names normally arrive as OIDC ID-token claims — `name` for the public
 * display name, `given_name` / `family_name` for the team-only full
 * name. Those are OPTIONAL claims, and a tenant that never configured
 * them signs people in perfectly well while leaving every account here
 * nameless. That failure is also self-perpetuating: the stored ID tokens
 * don't carry the claims either, so re-reading them backfills nothing
 * and no number of fresh sign-ins helps.
 *
 * The directory does hold the data. Group sync already fetches these
 * exact user objects, so names are taken from the same response that
 * resolves group membership — no extra Graph calls, no extra permission
 * beyond the User.Read.All the member read already needs.
 *
 * Only ever fills blanks. A name set here, or one that arrived from a
 * claim that does work, always beats the directory's copy — this is a
 * fallback for missing data, not an authority that overwrites.
 */

import { db, sql, type Database } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'
import type { EntraGroupMember } from './graph'

const log = logger.child({ component: 'entra' })

export interface DirectoryProfile {
  /** Lowercased — matched against LOWER(user.email), as the evaluator does. */
  email: string
  displayName: string | null
  givenName: string | null
  familyName: string | null
}

/**
 * Flatten members to one row per candidate address.
 *
 * A member can be matchable under several addresses (see
 * resolveMemberEmails) and the account here may have been created under
 * any of them, so every candidate gets a row rather than just the
 * primary.
 *
 * Duplicate addresses are collapsed deterministically — first writer
 * wins, except that a row carrying an actual name displaces a nameless
 * one, so a collision can never cost us the name we came for.
 */
export function collectDirectoryProfiles(members: EntraGroupMember[]): DirectoryProfile[] {
  const byEmail = new Map<string, DirectoryProfile>()

  for (const member of members) {
    const displayName = member.displayName?.trim() || null
    const givenName = member.givenName?.trim() || null
    const familyName = member.familyName?.trim() || null
    if (!displayName && !givenName && !familyName) continue

    for (const raw of member.emails) {
      const email = raw.trim().toLowerCase()
      if (!email) continue

      const existing = byEmail.get(email)
      if (existing) {
        // Prefer whichever row is actually carrying data.
        existing.displayName ??= displayName
        existing.givenName ??= givenName
        existing.familyName ??= familyName
        continue
      }
      byEmail.set(email, { email, displayName, givenName, familyName })
    }
  }

  return [...byEmail.values()]
}

export interface ProfileSyncResult {
  /** Accounts that gained at least one name field. */
  users: number
  /** Principals whose public display name was filled to match. */
  principals: number
}

/**
 * Write directory names onto accounts that are missing them.
 *
 * `user.name` is NOT NULL but is empty-string when an IdP sent no `name`
 * claim, so blankness is tested with NULLIF rather than IS NULL. The
 * final COALESCE arm re-supplies the existing value, which keeps the
 * column non-null even if a directory row somehow arrives nameless.
 *
 * `principal.display_name` is the copy of `user.name` that portal-facing
 * surfaces read, and it is otherwise only refreshed at sign-in. Updating
 * it in the same statement stops a filled name from being invisible
 * everywhere except the admin user list until the person next signs in.
 */
export async function syncDirectoryProfiles(
  members: EntraGroupMember[],
  /** Injectable so the statement can be exercised against a real database in tests. */
  database: Database = db
): Promise<ProfileSyncResult> {
  const profiles = collectDirectoryProfiles(members)
  if (profiles.length === 0) return { users: 0, principals: 0 }

  // Casts are required: an untyped parameter inside VALUES leaves
  // Postgres unable to infer the column types of the CTE.
  const values = sql.join(
    profiles.map(
      (p) =>
        sql`(${p.email}::text, ${p.displayName}::text, ${p.givenName}::text, ${p.familyName}::text)`
    ),
    sql`, `
  )

  const result = await database.execute(sql`
    WITH incoming(email, display_name, given_name, family_name) AS (
      VALUES ${values}
    ), updated AS (
      UPDATE "user" AS u
      SET name = COALESCE(NULLIF(u.name, ''), i.display_name, u.name),
          given_name = COALESCE(u.given_name, i.given_name),
          family_name = COALESCE(u.family_name, i.family_name)
      FROM incoming AS i
      WHERE LOWER(u.email) = i.email
        AND (
          (NULLIF(u.name, '') IS NULL AND i.display_name IS NOT NULL)
          OR (u.given_name IS NULL AND i.given_name IS NOT NULL)
          OR (u.family_name IS NULL AND i.family_name IS NOT NULL)
        )
      RETURNING u.id, u.name
    ), synced AS (
      UPDATE principal AS p
      SET display_name = updated.name
      FROM updated
      WHERE p.user_id = updated.id
        AND NULLIF(p.display_name, '') IS NULL
        AND NULLIF(updated.name, '') IS NOT NULL
      RETURNING p.id
    )
    SELECT (SELECT count(*) FROM updated)::int AS users,
           (SELECT count(*) FROM synced)::int AS principals
  `)

  const rows = getExecuteRows<{ users: number; principals: number }>(result)
  return {
    users: Number(rows[0]?.users ?? 0),
    principals: Number(rows[0]?.principals ?? 0),
  }
}

/**
 * Best-effort wrapper for the group-sync path.
 *
 * Naming people is a side benefit of resolving a group; it must never be
 * able to fail the membership evaluation that triggered it.
 */
export async function syncDirectoryProfilesSafely(
  members: EntraGroupMember[],
  groupId: string
): Promise<void> {
  try {
    const { users, principals } = await syncDirectoryProfiles(members)
    if (users > 0) {
      log.info(
        { group_id: groupId, users, principals },
        'filled missing account names from the directory'
      )
    }
  } catch (error) {
    log.warn({ err: error, group_id: groupId }, 'directory name sync failed; membership unaffected')
  }
}
