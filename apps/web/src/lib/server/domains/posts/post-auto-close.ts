/**
 * Board auto-close: posts that have sat in a Complete-category status for a
 * board's configured number of days move to the board's chosen Closed status.
 *
 * Runs hourly as the `post-auto-close` job and only when at least one board
 * has the setting. "Time in status" is the post's most recent status.changed
 * activity, falling back to its creation time for a post that was created
 * straight into a complete status. Each post goes through the same path as a
 * person's status change, so the timeline shows it (attributed to the system)
 * and post.status_changed fires for integrations and subscribers.
 */
import type { BoardId, PostId, PostStatusId } from '@quackback/ids'
import {
  db,
  boards,
  posts,
  postStatuses,
  postActivity,
  sql,
  eq,
  ne,
  and,
  isNull,
  lte,
} from '@/lib/server/db'
import type { BoardSettings } from '@/lib/shared/db-types'
import type { JobHandler } from '@/lib/server/jobs/definitions'
import { logger } from '@/lib/server/logger'
import { changeStatusBySystem } from './post.status'

const log = logger.child({ component: 'post-auto-close' })

/** Bound per board per run, so one badly configured board cannot monopolise the sweep. */
export const AUTO_CLOSE_BATCH = 200

export interface AutoCloseBoard {
  boardId: BoardId
  afterDays: number
  toStatusId: PostStatusId
}

/** Pure: has a post been in its status long enough? */
export function isDueForAutoClose(enteredAt: Date, afterDays: number, now: Date): boolean {
  return enteredAt.getTime() + afterDays * 86_400_000 <= now.getTime()
}

/** The boards with the setting on and well-formed. */
export async function listAutoCloseBoards(): Promise<AutoCloseBoard[]> {
  const rows = await db.select({ id: boards.id, settings: boards.settings }).from(boards)
  const out: AutoCloseBoard[] = []
  for (const row of rows) {
    const auto = (row.settings as BoardSettings | null)?.autoClose
    if (!auto || !(auto.afterDays >= 1) || !auto.toStatusId) continue
    out.push({ boardId: row.id, afterDays: auto.afterDays, toStatusId: auto.toStatusId })
  }
  return out
}

export async function hasAutoCloseBoards(): Promise<boolean> {
  return (await listAutoCloseBoards()).length > 0
}

/** Posts on the board due to move: complete-category status, not already the target, past the threshold. */
export async function findDuePosts(board: AutoCloseBoard, now: Date): Promise<PostId[]> {
  const cutoff = new Date(now.getTime() - board.afterDays * 86_400_000)
  const lastChange = db
    .select({
      postId: postActivity.postId,
      at: sql<Date>`max(${postActivity.createdAt})`.as('at'),
    })
    .from(postActivity)
    .where(eq(postActivity.type, 'status.changed'))
    .groupBy(postActivity.postId)
    .as('last_change')
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .innerJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .leftJoin(lastChange, eq(lastChange.postId, posts.id))
    .where(
      and(
        eq(posts.boardId, board.boardId),
        isNull(posts.deletedAt),
        eq(postStatuses.category, 'complete'),
        ne(posts.statusId, board.toStatusId),
        lte(sql`coalesce(${lastChange.at}, ${posts.createdAt})`, cutoff)
      )
    )
    .orderBy(posts.createdAt)
    .limit(AUTO_CLOSE_BATCH)
  return rows.map((r) => r.id)
}

export async function runAutoClose(now = new Date()): Promise<{ closed: number; skipped: number }> {
  let closed = 0
  let skipped = 0
  for (const board of await listAutoCloseBoards()) {
    const target = await db.query.postStatuses.findFirst({
      where: eq(postStatuses.id, board.toStatusId),
    })
    if (!target) {
      log.warn(
        { board_id: board.boardId, status_id: board.toStatusId },
        'auto-close target status no longer exists; board skipped'
      )
      skipped++
      continue
    }
    const due = await findDuePosts(board, now)
    for (const postId of due) {
      try {
        await changeStatusBySystem(postId, board.toStatusId, 'auto-close')
        closed++
      } catch (err) {
        log.warn({ err, post_id: postId, board_id: board.boardId }, 'auto-close failed for post')
        skipped++
      }
    }
    if (due.length > 0) {
      log.info(
        {
          board_id: board.boardId,
          moved: due.length,
          to: target.name,
          after_days: board.afterDays,
        },
        'auto-closed completed posts'
      )
    }
  }
  return { closed, skipped }
}

export const runPostAutoClose: JobHandler = async () => {
  await runAutoClose()
}

export async function isPostAutoCloseDue(): Promise<boolean> {
  return hasAutoCloseBoards()
}
