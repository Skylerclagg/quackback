/**
 * The tickets page's URL contract and loader gate.
 *
 * `validateSearch` is the whole reason a refresh restores the view and a link
 * is shareable, and it is also the compatibility surface: `?t=<ticketId>` is
 * the deep link this route has accepted since before the unified inbox retired
 * it, so old bookmarks must still resolve. Everything it does not recognise
 * must drop to `undefined` rather than reach the list filter.
 */
import { describe, it, expect, vi } from 'vitest'
import { createId } from '@quackback/ids'

const { Route } = await import('../tickets')
const { scopeToAssignee } = await import('@/components/admin/tickets/tickets-workspace')

type Search = ReturnType<typeof validate>
const validate = Route.options.validateSearch as (
  s: Record<string, unknown>
) => Record<string, unknown>

const TICKET_ID = createId('ticket')
const CONVERSATION_ID = createId('conversation')

describe('tickets route search contract', () => {
  it('accepts the full view: ticket, scope, type, status and sort', () => {
    expect(
      validate({
        t: TICKET_ID,
        scope: 'mine',
        type: 'back_office',
        status: 'open',
        sort: 'priority',
      })
    ).toEqual({
      t: TICKET_ID,
      scope: 'mine',
      type: 'back_office',
      status: 'open',
      sort: 'priority',
    })
  })

  it('keeps the legacy ?t= deep link working', () => {
    expect(validate({ t: TICKET_ID }).t).toBe(TICKET_ID)
  })

  it('drops a t= that is not a ticket id, so a stale link cannot select garbage', () => {
    expect(validate({ t: CONVERSATION_ID }).t).toBeUndefined()
    expect(validate({ t: 'not-an-id' }).t).toBeUndefined()
    expect(validate({ t: 42 }).t).toBeUndefined()
  })

  it('drops unrecognised scope, type, status and sort values', () => {
    const out = validate({ scope: 'everyone', type: 'nope', status: 'whatever', sort: 'sideways' })
    expect(out).toEqual({
      t: undefined,
      scope: undefined,
      type: undefined,
      status: undefined,
      sort: undefined,
    })
  })

  it('returns an all-undefined view for an empty query string', () => {
    const out: Search = validate({})
    expect(Object.values(out).every((v) => v === undefined)).toBe(true)
  })
})

describe('tickets route loader', () => {
  const loader = Route.options.loader as (args: {
    deps: Record<string, unknown>
    context: Record<string, unknown>
  }) => Promise<unknown>

  it('warms nothing when supportTickets is off — the page redirects anyway', async () => {
    const ensureQueryData = vi.fn()
    await loader({
      deps: {},
      context: {
        settings: { featureFlags: { supportTickets: false } },
        queryClient: { ensureQueryData },
      },
    })
    expect(ensureQueryData).not.toHaveBeenCalled()
  })

  it('warms the list and statuses, and the open ticket only when one is selected', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue(undefined)
    const context = {
      settings: { featureFlags: { supportTickets: true } },
      queryClient: { ensureQueryData },
    }

    await loader({ deps: {}, context })
    expect(ensureQueryData).toHaveBeenCalledTimes(2)

    ensureQueryData.mockClear()
    await loader({ deps: { t: TICKET_ID }, context })
    expect(ensureQueryData).toHaveBeenCalledTimes(3)
  })

  it('survives a warm that rejects — a cold cache must not break the route', async () => {
    const ensureQueryData = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(
      loader({
        deps: { t: TICKET_ID },
        context: {
          settings: { featureFlags: { supportTickets: true } },
          queryClient: { ensureQueryData },
        },
      })
    ).resolves.toEqual({})
  })
})

describe('scopeToAssignee', () => {
  it('maps the scope pill onto the list filter clause', () => {
    expect(scopeToAssignee('mine')).toBe('me')
    expect(scopeToAssignee('unassigned')).toBe('unassigned')
    // 'all' is the absence of a clause, not a value — the filter key must be
    // omitted so it does not become part of the query cache key.
    expect(scopeToAssignee('all')).toBeUndefined()
  })
})
