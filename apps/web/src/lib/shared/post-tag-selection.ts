/**
 * What a portal submission may do with tags.
 *
 * Portal users choose from PUBLIC tags only (internal, team-only tags such as
 * roadmap membership are never offered and are rejected if sent), and a board
 * may require at least one tag on submission. The requirement only bites while
 * there is a public tag to choose: with none left (every tag deleted or made
 * team-only) it would block every submission with nothing to pick. Pure so it
 * can be tested without a database; the caller supplies the current public
 * tag list.
 */
import { ValidationError } from '@/lib/shared/errors'

export function resolvePublicTagSelection(
  publicTags: ReadonlyArray<{ id: string }>,
  requested: readonly string[] | undefined,
  options: { requireTag: boolean }
): string[] {
  const allowed = new Set(publicTags.map((t) => t.id))
  const chosen = [...new Set(requested ?? [])]
  const rejected = chosen.filter((id) => !allowed.has(id))
  if (rejected.length > 0) {
    throw new ValidationError('TAG_NOT_AVAILABLE', 'One of the chosen tags is not available')
  }
  if (options.requireTag && publicTags.length > 0 && chosen.length === 0) {
    throw new ValidationError('TAG_REQUIRED', 'Choose at least one tag before submitting')
  }
  return chosen
}
