import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import { createId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => {
  // oxlint-disable-next-line no-restricted-imports
  const { createDb } = await import('@quackback/db/client')
  const url =
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: createDb(url, { max: 5, prepare: false }),
  }
})

import { db, events, eq, sql } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import {
  __resetRelayOwnedConvertForTests,
  convertRelayOwnedEvents,
  runEventDispatch,
} from '../event-dispatch-queue'
import { MAX_STRICT_RESOLVE_ATTEMPTS } from '../outbox'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import type { HookTarget } from '../hook-types'

function job(eventId: string, attempts = 1): ClaimedJob {
  return {
    id: 1n as unknown as ClaimedJob['id'],
    jobId: createId('job'),
    queue: 'event-dispatch',
    dedupeKey: `event-dispatch:${eventId}`,
    payload: { eventId },
    workspaceKey: null,
    attempts,
    maxAttempts: 10,
    leaseToken: 'test',
    lockedUntil: new Date(),
  }
}

async function insertEvent(opts: {
  eventId?: string
  owner: 'job' | 'relay'
  published?: boolean
  depth?: number
  type?: string
}): Promise<string> {
  const eventId = opts.eventId ?? createId('event')
  await db.insert(events).values({
    eventId,
    type: opts.type ?? 'post.created',
    entityType: 'post',
    entityId: createId('post'),
    actorType: 'system',
    payload: {},
    context: { depth: opts.depth ?? 0 },
    dispatchOwner: opts.owner,
    publishedAt: opts.published ? new Date() : null,
  })
  return eventId
}

const webhookAndWorkflow = async (): Promise<HookTarget[]> => [
  {
    type: 'webhook',
    target: { url: 'https://example.test/hook' },
    config: { webhookId: 'wh_1' },
    deliveryKey: 'wh_1',
  },
  {
    type: 'workflow',
    target: { workflowId: 'wf_1' },
    config: {},
    deliveryKey: 'wf_1',
  },
]

describe('runEventDispatch', () => {
  beforeAll(async () => {
    const url =
      process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
    const admin = postgres(url, { max: 1, onnotice: () => {} })
    try {
      await admin.unsafe(
        readFileSync(
          path.resolve(
            __dirname,
            '../../../../../../../packages/db/drizzle/0253_event_dispatch_owner.sql'
          ),
          'utf8'
        )
      )
      await admin.unsafe(
        readFileSync(
          path.resolve(
            __dirname,
            '../../../../../../../packages/db/drizzle/0254_event_dispatch_owner_default_job.sql'
          ),
          'utf8'
        )
      )
    } finally {
      await admin.end({ timeout: 2 })
    }
  })

  it('is a no-op for a missing or already-published event', async () => {
    const enqueued: Array<{ jobId: string }> = []
    await expect(
      runEventDispatch(job('evt_does_not_exist'), {
        enqueue: async (jobs) => {
          enqueued.push(...jobs)
        },
      })
    ).resolves.toBeUndefined()
    expect(enqueued).toEqual([])

    const eventId = await insertEvent({ owner: 'job', published: true })
    await expect(
      runEventDispatch(job(eventId), {
        enqueue: async (jobs) => {
          enqueued.push(...jobs)
        },
      })
    ).resolves.toBeUndefined()
    expect(enqueued).toEqual([])
  })

  it('does not publish a relay-owned row', async () => {
    const eventId = await insertEvent({ owner: 'relay' })
    await runEventDispatch(job(eventId), { resolve: webhookAndWorkflow })
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).toBeNull()
  })

  it('is idempotent: a second run enqueues nothing', async () => {
    const eventId = await insertEvent({ owner: 'job' })
    const enqueued: string[] = []
    const enqueue = async (jobs: Array<{ jobId: string }>) => {
      enqueued.push(...jobs.map((j) => j.jobId))
    }
    await runEventDispatch(job(eventId), { resolve: webhookAndWorkflow, enqueue })
    const [first] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(first.publishedAt).not.toBeNull()
    expect(enqueued).toHaveLength(2)

    await runEventDispatch(job(eventId), { resolve: webhookAndWorkflow, enqueue })
    expect(enqueued).toHaveLength(2)
  })

  it('duplicate concurrent execution uses the same deterministic keys', async () => {
    const eventId = await insertEvent({ owner: 'job' })
    const keys: string[] = []
    const enqueue = async (jobs: Array<{ jobId: string }>) => {
      keys.push(...jobs.map((j) => j.jobId))
    }
    await Promise.all([
      runEventDispatch(job(eventId), { resolve: webhookAndWorkflow, enqueue }),
      runEventDispatch(job(eventId), { resolve: webhookAndWorkflow, enqueue }),
    ])
    expect(new Set(keys).size).toBe(2)
    expect(keys.every((k) => k.startsWith(`${eventId}:`))).toBe(true)
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).not.toBeNull()
  })

  it('preserves the reaction-loop depth ceiling', async () => {
    const eventId = await insertEvent({ owner: 'job', depth: 6 })
    const enqueued: unknown[] = []
    await runEventDispatch(job(eventId), {
      resolve: webhookAndWorkflow,
      enqueue: async (jobs) => {
        enqueued.push(...jobs)
      },
    })
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).not.toBeNull()
    expect(enqueued).toEqual([])
  })

  it('rethrows a strict destination-resolution failure and leaves the event unpublished', async () => {
    const eventId = await insertEvent({ owner: 'job' })
    await expect(
      runEventDispatch(job(eventId, 1), {
        resolve: async () => {
          throw new Error('webhook sink down')
        },
      })
    ).rejects.toThrow('webhook sink down')
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).toBeNull()
  })

  it('degrades to best-effort after the strict retry budget', async () => {
    const eventId = await insertEvent({ owner: 'job' })
    const modes: Array<boolean | undefined> = []
    const enqueued: string[] = []
    await runEventDispatch(job(eventId, MAX_STRICT_RESOLVE_ATTEMPTS), {
      resolve: async (_event, opts) => {
        modes.push(opts?.bestEffort)
        return webhookAndWorkflow()
      },
      enqueue: async (jobs) => {
        enqueued.push(...jobs.map((j) => j.jobId))
      },
    })
    expect(modes).toEqual([true])
    expect(enqueued).toHaveLength(2)
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).not.toBeNull()
  })

  it('uses deterministic job ids of the form eventId:sink:hash', async () => {
    const eventId = await insertEvent({ owner: 'job' })
    const fromJob: string[] = []
    await runEventDispatch(job(eventId), {
      resolve: webhookAndWorkflow,
      enqueue: async (jobs) => {
        fromJob.push(...jobs.map((j) => j.jobId))
      },
    })

    expect(fromJob.every((k) => k.startsWith(`${eventId}:`))).toBe(true)
    expect(fromJob.some((s) => s.startsWith(`${eventId}:webhook:`))).toBe(true)
    expect(fromJob.some((s) => s.startsWith(`${eventId}:workflow:`))).toBe(true)
    expect(new Set(fromJob).size).toBe(2)
  })

  it('leaves leftover relay-owned rows unpublished while publishing job-owned ones', async () => {
    const jobId = await insertEvent({ owner: 'job' })
    const relayId = await insertEvent({ owner: 'relay' })

    await runEventDispatch(job(jobId), { resolve: webhookAndWorkflow, enqueue: async () => {} })
    await runEventDispatch(job(relayId), { resolve: webhookAndWorkflow, enqueue: async () => {} })

    const [jobRow] = await db.select().from(events).where(eq(events.eventId, jobId))
    const [relayRow] = await db.select().from(events).where(eq(events.eventId, relayId))
    expect(jobRow.publishedAt).not.toBeNull()
    expect(relayRow.publishedAt).toBeNull()
    expect(jobRow.dispatchOwner).toBe('job')
    expect(relayRow.dispatchOwner).toBe('relay')
  })

  it('marks the event published after the last attempt still fails', async () => {
    const eventId = await insertEvent({ owner: 'job' })
    await expect(
      runEventDispatch(job(eventId, 10), {
        resolve: async () => {
          throw new Error('all sinks down')
        },
      })
    ).resolves.toBeUndefined()
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).not.toBeNull()
  })

  it('converts leftover relay-owned rows onto event-dispatch jobs', async () => {
    __resetRelayOwnedConvertForTests()
    const leftover = await insertEvent({ owner: 'relay' })
    const alreadyJob = await insertEvent({ owner: 'job' })
    const publishedRelay = await insertEvent({ owner: 'relay', published: true })

    const first = await convertRelayOwnedEvents()
    expect(first.converted).toBeGreaterThanOrEqual(1)

    const [converted] = await db.select().from(events).where(eq(events.eventId, leftover))
    expect(converted.dispatchOwner).toBe('job')
    expect(converted.publishedAt).toBeNull()

    const [jobRow] = await db.select().from(events).where(eq(events.eventId, alreadyJob))
    expect(jobRow.dispatchOwner).toBe('job')
    expect(jobRow.publishedAt).toBeNull()

    const [stillRelay] = await db.select().from(events).where(eq(events.eventId, publishedRelay))
    expect(stillRelay.dispatchOwner).toBe('relay')
    expect(stillRelay.publishedAt).not.toBeNull()

    const jobs = await db.execute(sql`
      SELECT dedupe_key FROM job_queue
      WHERE queue = 'event-dispatch' AND payload->>'eventId' = ${leftover}
    `)
    expect(getExecuteRows(jobs).length).toBeGreaterThan(0)

    const again = await convertRelayOwnedEvents()
    expect(again.converted).toBe(0)
  })
})

/**
 * The relay must populate the resolver registry itself.
 *
 * `resolveTargets` is a loop over a module-level array that only
 * `registerAllResolvers()` fills, and it does not self-register. The legacy
 * adapter (targets.ts) calls it; the relay imported `resolveTargets` and did
 * not. In a worker process where nothing else touched the adapter, the array
 * stayed empty, every event resolved to ZERO targets, and the dispatch job
 * reported success — so workflows, notification bells, ticket-assignment
 * emails and webhooks all silently never ran while the queue looked healthy.
 *
 * Asserting on the registry rather than on enqueued jobs keeps this pinned to
 * the actual defect: a real event's target list legitimately varies with
 * workspace data, but "the relay resolved against an empty registry" is the
 * bug regardless of what any sink would have returned.
 */
describe('runEventDispatch resolver registration', () => {
  it('registers the resolvers before resolving, without help from another caller', async () => {
    const { __resetResolversForTests, listResolvers } = await import('../resolvers/registry')
    const { __resetRegistrationForTests } = await import('../resolvers')

    // Simulate a fresh worker process: nothing has registered anything yet.
    __resetResolversForTests()
    __resetRegistrationForTests()
    expect(listResolvers()).toHaveLength(0)

    // Observe the registry at the moment of resolution rather than letting the
    // real resolvers run: several of them query workspace tables a bare test
    // database has no rows for, and their success is not what this pins.
    let sinksAtResolveTime: string[] = []
    const eventId = await insertEvent({ owner: 'job', type: 'ticket.created' })
    await runEventDispatch(job(eventId), {
      resolve: async () => {
        sinksAtResolveTime = listResolvers().map((r) => r.sink)
        return []
      },
      enqueue: async () => {},
    })

    // Before the fix this was empty: the relay resolved against an empty
    // registry and published the event having fanned it to nobody.
    expect(sinksAtResolveTime.length).toBeGreaterThan(0)
    expect(sinksAtResolveTime).toContain('workflow')
  })
})
