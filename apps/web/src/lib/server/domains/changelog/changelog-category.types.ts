import type { RoadmapId, PrincipalId } from '@quackback/ids'
/**
 * Input/Output types for the changelog categories (labels) domain.
 */
import type { ChangelogCategoryId } from '@quackback/ids'

export interface ChangelogCategory {
  id: ChangelogCategoryId
  name: string
  color: string
  /** Segments this category is gated to; [] = everyone. */
  segmentIds: string[]
  position: number
  createdAt: Date
  /** Collection slug; null for a plain label. */
  slug: string | null
  description: string | null
  roadmapId: RoadmapId | null
  /** null = every team actor; [] = admins only; [ids] = admins plus those principals (raw jsonb ids). */
  allowedTeamPrincipalIds: string[] | null
}

export interface CreateChangelogCategoryInput {
  name: string
  color: string
  segmentIds?: string[]
  /**
   * Public URL key, which promotes a label into a named changelog at
   * /changelog?changelog=<slug>. Omit for a plain label.
   */
  slug?: string | null
  /** Shown on the collection's own page. */
  description?: string | null
  /** Informational link to a roadmap; clearing the roadmap clears this. */
  roadmapId?: RoadmapId | null
  /**
   * Narrows the collection to specific teammates. null/omitted = every team
   * actor, [] = admins only, [ids] = admins plus those principals.
   */
  allowedTeamPrincipalIds?: PrincipalId[] | null
}

export interface UpdateChangelogCategoryInput {
  name?: string
  color?: string
  segmentIds?: string[]
  /**
   * Public URL key, which promotes a label into a named changelog at
   * /changelog?changelog=<slug>. Omit for a plain label.
   */
  slug?: string | null
  /** Shown on the collection's own page. */
  description?: string | null
  /** Informational link to a roadmap; clearing the roadmap clears this. */
  roadmapId?: RoadmapId | null
  /**
   * Narrows the collection to specific teammates. null/omitted = every team
   * actor, [] = admins only, [ids] = admins plus those principals.
   */
  allowedTeamPrincipalIds?: PrincipalId[] | null
}
