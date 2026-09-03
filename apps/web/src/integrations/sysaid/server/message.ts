/**
 * Service record title/description from a post.created-shaped event.
 * SysAid's description field is plain text (HTML is shown escaped in the
 * classic UI), so the body is text with a link back to the post.
 */
import type { EventData } from '@/lib/server/events/types'
import { stripHtml, truncate } from '@/lib/server/events/hook-utils'

export function buildServiceRecordBody(
  event: EventData,
  rootUrl: string
): { title: string; description: string } {
  if (event.type !== 'post.created') return { title: '', description: '' }
  const { post } = event.data
  const postUrl = `${rootUrl.replace(/\/+$/, '')}/b/${post.boardSlug}/posts/${post.id}`
  const content = truncate(stripHtml(post.content), 4000)
  const author = post.authorName || post.authorEmail || 'a portal user'
  const lines = [
    content,
    '',
    `Submitted on Quackback by ${author}.`,
    `${post.voteCount} ${post.voteCount === 1 ? 'vote' : 'votes'} at the time of creation.`,
    `Post: ${postUrl}`,
  ]
  return { title: truncate(post.title, 250), description: lines.join('\n').trim() }
}
