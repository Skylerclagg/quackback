import { db, eq, and, inArray, isNull, sql, segments, userSegments } from '@/lib/server/db'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import { fromUuid, toUuid } from '@quackback/ids'
import { InternalError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import type { EvaluationResult } from './segment.types'
import type { SegmentRules, SegmentCondition } from '@/lib/server/db'
import { getSegment } from './segment.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'segment-evaluation' })

/** SQL comparison operators for rule conditions */
const OPERATOR_SQL: Record<string, string> = {
  eq: '=',
  neq: '!=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
}

/** Activity count subquery for post_count, vote_count, comment_count */
function activityCountSql(table: string, hasSoftDelete: boolean): ReturnType<typeof sql> {
  const whereClause = hasSoftDelete
    ? sql.raw(`WHERE ${table}.principal_id = p.id AND ${table}.deleted_at IS NULL`)
    : sql.raw(`WHERE ${table}.principal_id = p.id`)
  return sql`(SELECT COUNT(*)::int FROM ${sql.raw(table)} ${whereClause})`
}

/** Apply string operators (contains, starts_with, ends_with) to a SQL expression */
function stringOperatorSql(
  field: ReturnType<typeof sql>,
  operator: string,
  value: string | number | boolean | (string | number)[] | undefined
): ReturnType<typeof sql> | null {
  const str = String(value)
  if (operator === 'contains') return sql`${field} ILIKE ${'%' + str + '%'}`
  if (operator === 'starts_with') return sql`${field} ILIKE ${str + '%'}`
  if (operator === 'ends_with') return sql`${field} ILIKE ${'%' + str}`
  return null
}

/**
 * Build a condition over a nullable company text column (`co.` alias — see the
 * LEFT JOIN in resolveMatchingPrincipals). Semantics mirror the locale/country
 * built-ins: neq is NULL-safe (a person with no company, or a company without
 * the field, satisfies "is not X"), and is_set / is_not_set test presence.
 */
function companyTextConditionSql(
  columnName: string,
  operator: string,
  value: string | number | boolean | (string | number)[] | undefined
): ReturnType<typeof sql> | null {
  const field = sql.raw(`co.${columnName}`)
  if (operator === 'is_set') return sql`${field} IS NOT NULL`
  if (operator === 'is_not_set') return sql`${field} IS NULL`
  if (operator === 'in') {
    const values = Array.isArray(value) ? value : []
    if (values.length === 0) return null
    const placeholders = sql.join(
      values.map((v) => sql`${String(v)}`),
      sql`, `
    )
    return sql`${field} IN (${placeholders})`
  }
  const strResult = stringOperatorSql(field, operator, value)
  if (strResult) return strResult
  const sqlOp = OPERATOR_SQL[operator]
  if (!sqlOp) return null
  if (operator === 'neq') {
    return sql`(${field} IS NULL OR ${field} != ${String(value)})`
  }
  return sql`${field} ${sql.raw(sqlOp)} ${String(value)}`
}

/**
 * Emails resolved from Microsoft Graph for each `entra_group` condition, keyed
 * by group Object ID. Resolved BEFORE SQL compilation, because Graph is an
 * async network call and this compiler is synchronous.
 */
type EntraGroupEmails = ReadonlyMap<string, string[]>

/**
 * Build a SQL condition fragment for a single rule condition.
 * Returns a SQL template or null if the condition is unsupported.
 */
function buildConditionSql(
  condition: SegmentCondition,
  entraEmails?: EntraGroupEmails
): ReturnType<typeof sql> | null {
  const { attribute, operator, value } = condition

  // Entra group membership, compiled from the pre-resolved email list.
  //
  // An EMPTY group legitimately matches nobody, and FALSE keeps composition
  // under `match: 'any'` correct. A MISSING map entry means resolution was
  // skipped or failed, and compiling that as "no members" would evict the
  // entire segment on the next sweep — a mass lockout caused by a transient
  // network error, for a segment that may gate board or changelog access.
  // So it throws instead, aborting the evaluation and leaving membership as it
  // was.
  if (attribute === 'entra_group') {
    if (operator !== 'eq' || typeof value !== 'string' || !value) return null
    const emails = entraEmails?.get(value)
    if (emails === undefined) {
      throw new InternalError(
        'ENTRA_NOT_RESOLVED',
        'entra_group condition reached SQL compilation without resolved members'
      )
    }
    if (emails.length === 0) return sql`FALSE`
    return sql`LOWER(u.email) IN (${sql.join(
      emails.map((e) => sql`${e}`),
      sql`, `
    )})`
  }

  // Company predicates (§K3), resolved through the `co` LEFT JOIN
  // (principal.company_id -> companies). Handled up front because each helper
  // covers the full operator set including presence and 'in'.
  if (
    attribute === 'company_plan' ||
    attribute === 'company_size' ||
    attribute === 'company_industry'
  ) {
    const column = {
      company_plan: 'plan',
      company_size: 'size',
      company_industry: 'industry',
    }[attribute]
    return companyTextConditionSql(column, operator, value)
  }

  if (attribute === 'company_mrr') {
    // The rule speaks whole currency units (what the directory shows);
    // the column stores minor units.
    if (operator === 'is_set') return sql`co.mrr_cents IS NOT NULL`
    if (operator === 'is_not_set') return sql`co.mrr_cents IS NULL`
    const sqlOp = OPERATOR_SQL[operator]
    if (!sqlOp) return null
    return sql`(co.mrr_cents / 100.0) ${sql.raw(sqlOp)} ${Number(value)}`
  }

  if (attribute === 'company_attr') {
    const key = condition.metadataKey
    if (!key) return null
    const field = sql`(co.custom_attributes::jsonb->>${key})`
    if (operator === 'is_set') return sql`${field} IS NOT NULL`
    if (operator === 'is_not_set') return sql`${field} IS NULL`
    if (operator === 'in') {
      const values = Array.isArray(value) ? value : []
      if (values.length === 0) return null
      const placeholders = sql.join(
        values.map((v) => sql`${String(v)}`),
        sql`, `
      )
      return sql`${field} IN (${placeholders})`
    }
    const strResult = stringOperatorSql(field, operator, value)
    if (strResult) return strResult
    const sqlOp = OPERATOR_SQL[operator]
    if (!sqlOp) return null
    if (typeof value === 'number') {
      return sql`${field}::numeric ${sql.raw(sqlOp)} ${value}`
    }
    return sql`${field} ${sql.raw(sqlOp)} ${String(value)}`
  }

  // Handle is_set / is_not_set
  if (operator === 'is_set' || operator === 'is_not_set') {
    const isSet = operator === 'is_set'
    switch (attribute) {
      case 'email':
        return isSet ? sql`u.email IS NOT NULL` : sql`u.email IS NULL`
      case 'email_verified':
        return isSet ? sql`u.email_verified = true` : sql`u.email_verified = false`
      case 'plan':
        return isSet
          ? sql`(u.metadata::jsonb->>'plan') IS NOT NULL`
          : sql`(u.metadata::jsonb->>'plan') IS NULL`
      case 'metadata_key': {
        const key = condition.metadataKey
        if (!key) return null
        return isSet
          ? sql`(u.metadata::jsonb->>${key}) IS NOT NULL`
          : sql`(u.metadata::jsonb->>${key}) IS NULL`
      }
      case 'post_count':
        return sql`${activityCountSql('posts', true)} ${sql.raw(isSet ? '> 0' : '= 0')}`
      case 'vote_count':
        return sql`${activityCountSql('votes', false)} ${sql.raw(isSet ? '> 0' : '= 0')}`
      case 'comment_count':
        return sql`${activityCountSql('comments', true)} ${sql.raw(isSet ? '> 0' : '= 0')}`
      // name is NOT NULL — is_set is always true, is_not_set is never true
      case 'name':
        return isSet ? sql`TRUE` : sql`FALSE`
      case 'locale':
        return isSet ? sql`u.locale IS NOT NULL` : sql`u.locale IS NULL`
      case 'country':
        return isSet ? sql`u.country IS NOT NULL` : sql`u.country IS NULL`
      case 'last_active_days_ago':
        return isSet
          ? sql`EXISTS (SELECT 1 FROM session s WHERE s.user_id = u.id)`
          : sql`NOT EXISTS (SELECT 1 FROM session s WHERE s.user_id = u.id)`
      // signup_source falls back to 'email' for users with no account row,
      // so it's always set — mirror principal_type / name semantics.
      case 'signup_source':
        return isSet ? sql`TRUE` : sql`FALSE`
      case 'google_workspace':
        return isSet
          ? sql`(u.metadata::jsonb->>'googleWorkspaceDomain') IS NOT NULL`
          : sql`(u.metadata::jsonb->>'googleWorkspaceDomain') IS NULL`
      // principal.type is always set — is_set is always true, is_not_set is never true
      case 'principal_type':
        return isSet ? sql`TRUE` : sql`FALSE`
      default:
        return null
    }
  }

  // Handle 'in' operator — value must be an array
  if (operator === 'in') {
    const values = Array.isArray(value) ? value : []
    if (values.length === 0) return null
    const placeholders = sql.join(
      values.map((v) => sql`${String(v)}`),
      sql`, `
    )

    switch (attribute) {
      case 'email': {
        const emails = values.map((v) => sql`${String(v).toLowerCase()}`)
        return sql`LOWER(u.email) IN (${sql.join(emails, sql`, `)})`
      }
      case 'plan':
        return sql`(u.metadata::jsonb->>'plan') IN (${placeholders})`
      case 'metadata_key': {
        const key = condition.metadataKey
        if (!key) return null
        return sql`(u.metadata::jsonb->>${key}) IN (${placeholders})`
      }
      case 'google_workspace':
        return sql`LOWER(u.metadata::jsonb->>'googleWorkspaceDomain') IN (${placeholders})`
      case 'name':
        return sql`u.name IN (${placeholders})`
      case 'locale':
        return sql`u.locale IN (${placeholders})`
      case 'country': {
        const codes = values.map((v) => sql`${String(v).toUpperCase()}`)
        return sql`u.country IN (${sql.join(codes, sql`, `)})`
      }
      case 'signup_source':
        return sql`COALESCE((SELECT a.provider_id FROM account a WHERE a.user_id = u.id ORDER BY a.created_at ASC LIMIT 1), 'email') IN (${placeholders})`
      case 'principal_type':
        return sql`p.type IN (${placeholders})`
      default:
        return null
    }
  }

  switch (attribute) {
    case 'email_verified':
      return sql`u.email_verified = ${Boolean(value)}`

    case 'email': {
      // Email matching is case-insensitive: better-auth and most OAuth
      // providers normalize on the way in, but human-entered rules
      // ("email eq Alice@example.com") and pre-normalisation rows would
      // otherwise silently miss. LOWER both sides for eq/neq/comparators
      // AND inside stringOperatorSql for contains/starts_with/ends_with.
      const field = sql`LOWER(u.email)`
      const lowered = String(value).toLowerCase()
      const strResult = stringOperatorSql(field, operator, lowered)
      if (strResult) return strResult
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`${field} ${sql.raw(sqlOp)} ${lowered}`
    }

    case 'created_at_days_ago': {
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`(NOW() - p.created_at) ${sql.raw(sqlOp)} (${Number(value)} * INTERVAL '1 day')`
    }

    case 'plan': {
      const field = sql`(u.metadata::jsonb->>'plan')`
      const strResult = stringOperatorSql(field, operator, value)
      if (strResult) return strResult
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`${field} ${sql.raw(sqlOp)} ${String(value)}`
    }

    case 'metadata_key': {
      const key = condition.metadataKey
      if (!key) return null
      const field = sql`(u.metadata::jsonb->>${key})`
      const strResult = stringOperatorSql(field, operator, value)
      if (strResult) return strResult
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      if (typeof value === 'number') {
        return sql`${field}::numeric ${sql.raw(sqlOp)} ${value}`
      }
      return sql`${field} ${sql.raw(sqlOp)} ${String(value)}`
    }

    case 'post_count': {
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`${activityCountSql('posts', true)} ${sql.raw(sqlOp)} ${Number(value)}`
    }

    case 'vote_count': {
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`${activityCountSql('votes', false)} ${sql.raw(sqlOp)} ${Number(value)}`
    }

    case 'comment_count': {
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`${activityCountSql('comments', true)} ${sql.raw(sqlOp)} ${Number(value)}`
    }

    case 'name': {
      const field = sql`u.name`
      const strResult = stringOperatorSql(field, operator, value)
      if (strResult) return strResult
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`${field} ${sql.raw(sqlOp)} ${String(value)}`
    }

    case 'locale': {
      const field = sql`u.locale`
      const strResult = stringOperatorSql(field, operator, value)
      if (strResult) return strResult
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      // PostgreSQL `NULL != 'x'` is NULL, not TRUE — so a bare neq silently
      // excludes every locale-unset user. Mirror is_not_set semantics for
      // 'neq' on this nullable column.
      if (operator === 'neq') {
        return sql`(${field} IS NULL OR ${field} != ${String(value)})`
      }
      return sql`${field} ${sql.raw(sqlOp)} ${String(value)}`
    }

    case 'country': {
      // Country codes are normalized uppercase on write (capture helper) —
      // uppercase the comparand too so admins typing "us" still match.
      const field = sql`u.country`
      const upperValue = String(value).toUpperCase()
      const strResult = stringOperatorSql(field, operator, upperValue)
      if (strResult) return strResult
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      // NULL-safe neq: see 'locale' note above. Users with no country set
      // satisfy "country is not X" because they don't have country=X.
      if (operator === 'neq') {
        return sql`(${field} IS NULL OR ${field} != ${upperValue})`
      }
      return sql`${field} ${sql.raw(sqlOp)} ${upperValue}`
    }

    case 'last_active_days_ago': {
      // "Last active" must reflect actual activity, not just sign-in time.
      // Better Auth refreshes sessions on activity by bumping updated_at
      // while leaving created_at at the original sign-in instant — so
      // MAX(created_at) alone would mark a long-lived active session as
      // stale. COALESCE(updated_at, created_at) recovers the intended
      // semantics; created_at is the fallback for rows that pre-date the
      // updated_at bump.
      //
      // EXTRACT returns NULL when the user has no session — NULL fails
      // every comparison, so users who never signed in correctly do not
      // match numeric predicates. Use is_set / is_not_set for that
      // audience.
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`EXTRACT(EPOCH FROM (NOW() - (SELECT MAX(COALESCE(s.updated_at, s.created_at)) FROM session s WHERE s.user_id = u.id))) / 86400 ${sql.raw(sqlOp)} ${Number(value)}`
    }

    case 'signup_source': {
      // No account row (magic-link / OTP only sign-ups) → COALESCE to 'email'
      // so admins can target that cohort explicitly.
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`COALESCE((SELECT a.provider_id FROM account a WHERE a.user_id = u.id ORDER BY a.created_at ASC LIMIT 1), 'email') ${sql.raw(sqlOp)} ${String(value)}`
    }

    case 'principal_type': {
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`p.type ${sql.raw(sqlOp)} ${String(value)}`
    }

    case 'google_workspace': {
      // Stored lowercased by the sign-in capture, but LOWER both sides so a
      // hand-typed rule ("Acme.com") and any legacy row still match.
      const field = sql`LOWER(u.metadata::jsonb->>'googleWorkspaceDomain')`
      const lowered = String(value).toLowerCase()
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      // NULL-safe neq: someone with no workspace captured satisfies
      // "workspace is not X", which a bare != would exclude.
      if (operator === 'neq') {
        return sql`((u.metadata::jsonb->>'googleWorkspaceDomain') IS NULL OR ${field} != ${lowered})`
      }
      return sql`${field} ${sql.raw(sqlOp)} ${lowered}`
    }

    default:
      return null
  }
}

/**
 * Evaluate a dynamic segment's rules and return the set of matching principal IDs.
 * Translates rules to SQL — does not load users into memory.
 */
/**
 * Resolve every `entra_group` condition's member emails from Microsoft Graph
 * ahead of SQL compilation. Returns an empty map when the rules carry no such
 * condition — the common case, and zero overhead.
 *
 * Deliberately allowed to throw: see the failure note in buildConditionSql.
 */
async function resolveEntraGroupEmails(rules: SegmentRules): Promise<EntraGroupEmails> {
  const groupIds = new Set<string>()
  for (const condition of rules.conditions ?? []) {
    // Mirror buildConditionSql's guard exactly: a condition it will discard
    // must not cost a Graph round trip here.
    if (
      condition.attribute === 'entra_group' &&
      condition.operator === 'eq' &&
      typeof condition.value === 'string' &&
      condition.value
    ) {
      groupIds.add(condition.value)
    }
  }
  const map = new Map<string, string[]>()
  if (groupIds.size === 0) return map

  const { getEntraGroupMemberEmails } = await import('@/lib/server/integrations/entra/graph')
  for (const groupId of groupIds) {
    map.set(groupId, await getEntraGroupMemberEmails(groupId))
  }
  return map
}

/**
 * Compile a rule set into one WHERE fragment, or null when nothing compiles.
 * Extracted so the full sweep and the per-principal check cannot disagree
 * about what a rule means.
 */
function combineConditions(
  rules: SegmentRules,
  entraEmails?: EntraGroupEmails
): ReturnType<typeof sql> | null {
  const conditionSqls = (rules.conditions ?? [])
    .map((condition) => buildConditionSql(condition, entraEmails))
    .filter((c): c is NonNullable<typeof c> => c !== null)

  if (conditionSqls.length === 0) return null

  return rules.match === 'all'
    ? conditionSqls.reduce((acc, c) => sql`${acc} AND ${c}`)
    : conditionSqls.reduce((acc, c) => sql`${acc} OR ${c}`)
}

async function resolveMatchingPrincipals(rules: SegmentRules): Promise<string[]> {
  const entraEmails = await resolveEntraGroupEmails(rules)
  const combinedWhere = combineConditions(rules, entraEmails)
  if (!combinedWhere) return []

  // Audience = ANY human principal — team accounts (role admin/member) as well
  // as portal users — so a segment can target teammates too. The invariant is
  // principal.type='user' plus a linked user row, NOT principal.role:
  // anonymous visitors carry role='user' but type='anonymous', and service
  // principals carry role='member' with no person behind them, so both stay
  // excluded by the type guard alone.
  //
  // Gating on role here made the segments page contradict itself: the member
  // count counts every user_segments row, teammates included, and the list then
  // omitted them. policy/audience.ts's segment door admits any
  // principalType==='user' for the same reason; these two must agree.
  //
  // The companies LEFT JOIN feeds the company_* predicates; people without a
  // company keep a NULL co row.
  const rows = await db.execute(sql`
    SELECT p.id
    FROM principal p
    INNER JOIN "user" u ON u.id = p.user_id
    LEFT JOIN companies co ON co.id = p.company_id
    WHERE p.type = 'user'
      AND p.user_id IS NOT NULL
      AND (${combinedWhere})
  `)

  // db.execute() returns raw UUIDs from PostgreSQL, but the rest of the
  // evaluation logic uses Drizzle query builder which converts UUIDs to TypeIDs
  // via the typeIdColumn custom type. We must convert here to ensure the
  // Set-based diff in evaluateDynamicSegment compares like with like.
  return (rows as unknown as Array<{ id: string }>).map(
    (r) => fromUuid('principal', r.id) as string
  )
}

/**
 * Evaluate a single dynamic segment and sync the user_segments table.
 * Adds new matches, removes stale members.
 */
export async function evaluateDynamicSegment(segmentId: SegmentId): Promise<EvaluationResult> {
  const segment = await getSegment(segmentId)
  if (!segment) {
    throw new NotFoundError('SEGMENT_NOT_FOUND', `Segment ${segmentId} not found`)
  }
  if (segment.type !== 'dynamic') {
    throw new ValidationError('SEGMENT_TYPE_ERROR', 'Segment is not dynamic')
  }
  if (!segment.rules || !segment.rules.conditions?.length) {
    const deleted = await db
      .delete(userSegments)
      .where(and(eq(userSegments.segmentId, segmentId), eq(userSegments.addedBy, 'dynamic')))
      .returning({ principalId: userSegments.principalId })
    const removedIds = deleted.map((row) => row.principalId as PrincipalId)
    if (removedIds.length > 0) {
      import('@/lib/server/integrations/user-sync-notify')
        .then(({ notifyUserSyncIntegrations }) =>
          notifyUserSyncIntegrations(segment.name, [], removedIds)
        )
        .catch((err) => log.error({ err }, 'user sync notify failed'))
    }
    return { segmentId, added: 0, removed: deleted.length }
  }

  const currentMembers = await db
    .select({ principalId: userSegments.principalId })
    .from(userSegments)
    .where(and(eq(userSegments.segmentId, segmentId), eq(userSegments.addedBy, 'dynamic')))

  const currentIds = new Set<string>(currentMembers.map((r) => r.principalId))

  const matchingIds = await resolveMatchingPrincipals(segment.rules)
  const matchingSet = new Set(matchingIds)

  const toAdd = matchingIds.filter((id) => !currentIds.has(id)) as PrincipalId[]
  const toRemove = [...currentIds].filter((id) => !matchingSet.has(id)) as PrincipalId[]

  await db.transaction(async (tx) => {
    if (toAdd.length > 0) {
      await tx
        .insert(userSegments)
        .values(
          toAdd.map((pid) => ({
            principalId: pid,
            segmentId,
            addedBy: 'dynamic' as const,
          }))
        )
        .onConflictDoNothing()
    }
    if (toRemove.length > 0) {
      // Scope to addedBy='dynamic' so we never wipe rows whose source is
      // manual / sso / api / widget. Without this, a principal who is both
      // a manual member and a stale dynamic match loses their manual row
      // on the next sweep — silently locking them out of segment-gated boards.
      await tx
        .delete(userSegments)
        .where(
          and(
            eq(userSegments.segmentId, segmentId),
            eq(userSegments.addedBy, 'dynamic'),
            inArray(userSegments.principalId, toRemove)
          )
        )
    }
  })

  if (toAdd.length > 0 || toRemove.length > 0) {
    import('@/lib/server/integrations/user-sync-notify')
      .then(({ notifyUserSyncIntegrations }) =>
        notifyUserSyncIntegrations(segment.name, toAdd, toRemove)
      )
      .catch((err) => log.error({ err }, 'user sync notify failed'))
  }

  return { segmentId, added: toAdd.length, removed: toRemove.length }
}

/**
 * Evaluate all active dynamic segments.
 */
export async function evaluateAllDynamicSegments(): Promise<EvaluationResult[]> {
  const dynamicSegments = await db
    .select({ id: segments.id })
    .from(segments)
    .where(and(eq(segments.type, 'dynamic'), isNull(segments.deletedAt)))

  const results: EvaluationResult[] = []
  for (const seg of dynamicSegments) {
    const result = await evaluateDynamicSegment(seg.id as SegmentId)
    results.push(result)
  }
  return results
}

/**
 * Get all segment members (principal IDs) for a given segment.
 */
export async function getSegmentMembers(segmentId: SegmentId): Promise<PrincipalId[]> {
  const rows = await db
    .select({ principalId: userSegments.principalId })
    .from(userSegments)
    .where(eq(userSegments.segmentId, segmentId))

  return rows.map((r) => r.principalId as PrincipalId)
}

/**
 * Evaluate a single principal against every active dynamic segment and sync
 * their 'dynamic'-sourced memberships.
 *
 * Used at sign-in — after the Google Workspace domain is captured — so
 * rule-based memberships apply immediately instead of waiting up to an hour
 * for the next scheduled sweep. Someone whose access is gated on a
 * workspace-derived segment would otherwise sign in and find it missing.
 *
 * Mirrors evaluateDynamicSegment's contract: only rows with addedBy='dynamic'
 * are added or removed, so manual / sso / widget / api memberships are never
 * touched. Audience matches resolveMatchingPrincipals exactly — any human
 * principal, gated on principal.type rather than role.
 */
export async function evaluatePrincipalDynamicSegments(principalId: PrincipalId): Promise<void> {
  const dynamicSegments = await db
    .select({ id: segments.id, name: segments.name, rules: segments.rules })
    .from(segments)
    .where(and(eq(segments.type, 'dynamic'), isNull(segments.deletedAt)))
  if (dynamicSegments.length === 0) return

  const existing = await db
    .select({ segmentId: userSegments.segmentId })
    .from(userSegments)
    .where(and(eq(userSegments.principalId, principalId), eq(userSegments.addedBy, 'dynamic')))
  const existingIds = new Set<string>(existing.map((r) => String(r.segmentId)))
  const principalUuid = toUuid(principalId)

  for (const seg of dynamicSegments) {
    // Rule-less dynamic segments match nobody, same as the full sweep. An
    // entra_group condition resolves through a short-lived cache so a sign-in
    // burst doesn't become one Graph request per user; if resolution fails,
    // skip THIS segment (leaving its membership untouched) rather than
    // aborting the whole per-principal pass.
    let combinedWhere: ReturnType<typeof combineConditions> = null
    if (seg.rules) {
      try {
        const entraEmails = await resolveEntraGroupEmails(seg.rules)
        combinedWhere = combineConditions(seg.rules, entraEmails)
      } catch (err) {
        log.error(
          { err, segment_id: seg.id },
          'entra group resolution failed; skipping segment for this principal'
        )
        continue
      }
    }

    let matches = false
    if (combinedWhere) {
      const rows = await db.execute(sql`
        SELECT 1
        FROM principal p
        INNER JOIN "user" u ON u.id = p.user_id
        LEFT JOIN companies co ON co.id = p.company_id
        WHERE p.id = ${principalUuid}::uuid
          AND p.type = 'user'
          AND p.user_id IS NOT NULL
          AND (${combinedWhere})
        LIMIT 1
      `)
      matches = (rows as unknown as unknown[]).length > 0
    }

    const segId = seg.id as SegmentId
    if (matches === existingIds.has(String(segId))) continue

    if (matches) {
      await db
        .insert(userSegments)
        .values({ principalId, segmentId: segId, addedBy: 'dynamic' })
        .onConflictDoNothing()
    } else {
      await db
        .delete(userSegments)
        .where(
          and(
            eq(userSegments.principalId, principalId),
            eq(userSegments.segmentId, segId),
            eq(userSegments.addedBy, 'dynamic')
          )
        )
    }

    import('@/lib/server/integrations/user-sync-notify')
      .then(({ notifyUserSyncIntegrations }) =>
        notifyUserSyncIntegrations(
          seg.name,
          matches ? [principalId] : [],
          matches ? [] : [principalId]
        )
      )
      .catch((err) => log.error({ err }, 'user sync notify failed'))
  }
}
