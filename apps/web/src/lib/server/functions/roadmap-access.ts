/**
 * Shared roadmap access gate for the roadmap + timeline server fns.
 *
 * Lives in its own module (NOT in a createServerFn file) on purpose:
 * server-fn modules are rewritten into client RPC stubs, and a plain
 * function export would force the whole server-only import graph
 * (db client, request headers) into the browser bundle — vite's
 * import-protection then hard-fails the client. Never export plain
 * functions from files the client imports server fns from.
 */
import type { RoadmapId } from '@quackback/ids'
import { getRoadmap } from '@/lib/server/domains/roadmaps/roadmap.service'
import { canViewRoadmap, isAllowed } from '@/lib/server/policy'
import { teamActorFromAuth, type AuthContext } from './auth-helpers'
import { NotFoundError } from '@/lib/shared/errors'

/**
 * Load a roadmap and 404 unless the caller may view it. Admins always
 * pass; members need the roadmap public or their principal id in its
 * team allowlist. 404 (not 403) so restricted roadmaps stay
 * indistinguishable from missing ones.
 */
export async function requireRoadmapAccess(auth: AuthContext, id: RoadmapId) {
  const roadmap = await getRoadmap(id)
  if (!isAllowed(canViewRoadmap(teamActorFromAuth(auth), roadmap))) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${id} not found`)
  }
  return roadmap
}
