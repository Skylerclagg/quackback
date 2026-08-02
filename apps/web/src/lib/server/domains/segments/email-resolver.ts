/**
 * Bulk email → principal resolution for segment CSV imports.
 *
 * Lookup-only: unlike the feedback ingestion author-resolver, this never
 * creates accounts. An admin uploading a spreadsheet of addresses must not
 * be able to conjure user rows for people who never signed up — those land
 * in `unmatched` so the UI can report them back.
 */

import { db, eq, and, asc, inArray, sql, user, principal } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'

/**
 * Deliberately loose shape check — this only separates "looks like an
 * address" from "obvious garbage in the spreadsheet". Deliverability is
 * decided by whether an account actually exists, not by the regex.
 */
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

/**
 * Postgres caps a statement at 65535 bound parameters. 500 emails per
 * round-trip keeps us far under that while still collapsing a 10k-row
 * upload into 20 queries instead of 10k.
 */
const LOOKUP_CHUNK_SIZE = 500

export interface ResolvedEmails {
  matched: { principalId: PrincipalId; email: string }[]
  /** Valid-looking emails with no account. */
  unmatched: string[]
  /** Strings that aren't emails. */
  invalid: string[]
}

/**
 * Resolve a list of raw email strings to existing user principals.
 *
 * Input is trimmed, lower-cased and de-duplicated first, so a 10k-row file
 * of the same address costs one lookup. Matching is case-insensitive via
 * `LOWER(user.email)`, which is backed by the `user_email_lower_idx`
 * functional index (see author-resolver.ts) — without the LOWER() on both
 * sides an account created as `Alice@example.com` would silently miss an
 * import row spelled `alice@example.com`.
 *
 * Only `principal.type = 'user'` rows are returned: anonymous visitors and
 * service principals can't be segment members. Team members (role admin /
 * member) *are* eligible, so role is intentionally not filtered.
 */
export async function resolvePrincipalsByEmail(emails: string[]): Promise<ResolvedEmails> {
  const invalid: string[] = []
  const candidates: string[] = []
  const seenValid = new Set<string>()
  const seenInvalid = new Set<string>()

  for (const raw of emails) {
    const normalized = (raw ?? '').trim().toLowerCase()
    if (!normalized) continue

    if (!EMAIL_PATTERN.test(normalized)) {
      if (!seenInvalid.has(normalized)) {
        seenInvalid.add(normalized)
        invalid.push(normalized)
      }
      continue
    }

    if (seenValid.has(normalized)) continue
    seenValid.add(normalized)
    candidates.push(normalized)
  }

  if (candidates.length === 0) {
    return { matched: [], unmatched: [], invalid }
  }

  // email (lower-cased) → first principal, "first" meaning oldest by
  // principal.createdAt so a duplicated address resolves deterministically
  // across runs rather than to whatever the planner happened to emit first.
  const byEmail = new Map<string, PrincipalId>()

  for (let offset = 0; offset < candidates.length; offset += LOOKUP_CHUNK_SIZE) {
    const chunk = candidates.slice(offset, offset + LOOKUP_CHUNK_SIZE)

    const rows = await db
      .select({ principalId: principal.id, email: user.email })
      .from(user)
      .innerJoin(principal, eq(principal.userId, user.id))
      .where(and(inArray(sql`LOWER(${user.email})`, chunk), eq(principal.type, 'user')))
      .orderBy(asc(principal.createdAt))

    for (const row of rows) {
      const key = (row.email ?? '').toLowerCase()
      if (!key || byEmail.has(key)) continue
      byEmail.set(key, row.principalId as PrincipalId)
    }
  }

  const matched: { principalId: PrincipalId; email: string }[] = []
  const unmatched: string[] = []

  // Walk the candidates (not the DB rows) so both buckets come back in the
  // order the admin's file listed them.
  for (const email of candidates) {
    const principalId = byEmail.get(email)
    if (principalId) {
      matched.push({ principalId, email })
    } else {
      unmatched.push(email)
    }
  }

  return { matched, unmatched, invalid }
}
