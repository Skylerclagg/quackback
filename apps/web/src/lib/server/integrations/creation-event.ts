/**
 * Turn a routed post event into the "create an item for this post" signal
 * tracker hooks act on.
 *
 * Trackers historically created one item per NEW post and ignored every other
 * event. Routing rows can now send them a vote threshold, a status change or an
 * edit as well, so "create when this post reaches 10 votes" works. Those events
 * carry only a post reference; this loads the post and returns a
 * post.created-shaped event the existing body builders already understand.
 *
 * Idempotent by construction: a post already linked to this integration (by an
 * earlier event, or by hand) yields null, so a tracker never creates twice.
 */
import { db, posts, boards, postExternalLinks, eq, and } from '@/lib/server/db'
import type { PostId } from '@quackback/ids'
import type { EventData, PostCreatedEvent } from '@/lib/server/events/types'

export const CREATION_TRIGGER_EVENTS = [
  'post.created',
  'post.voted',
  'post.status_changed',
  'post.updated',
] as const

export async function resolveCreationEvent(
  event: EventData,
  integrationType: string
): Promise<PostCreatedEvent | null> {
  // A brand-new post cannot be linked yet: no lookup, same behaviour as before.
  if (event.type === 'post.created') return event
  if (
    event.type !== 'post.voted' &&
    event.type !== 'post.status_changed' &&
    event.type !== 'post.updated'
  ) {
    return null
  }
  const postId = event.data.post.id as PostId

  const linked = await db
    .select({ id: postExternalLinks.id })
    .from(postExternalLinks)
    .where(
      and(
        eq(postExternalLinks.postId, postId),
        eq(postExternalLinks.integrationType, integrationType)
      )
    )
    .limit(1)
  if (linked.length > 0) return null

  const [row] = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      boardId: posts.boardId,
      boardSlug: boards.slug,
      voteCount: posts.voteCount,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(eq(posts.id, postId))
    .limit(1)
  if (!row) return null

  return {
    id: event.id,
    timestamp: event.timestamp,
    actor: event.actor,
    type: 'post.created',
    data: {
      post: {
        id: row.id,
        title: row.title,
        content: row.content,
        boardId: row.boardId,
        boardSlug: row.boardSlug,
        voteCount: row.voteCount,
      },
    },
  } as PostCreatedEvent
}
