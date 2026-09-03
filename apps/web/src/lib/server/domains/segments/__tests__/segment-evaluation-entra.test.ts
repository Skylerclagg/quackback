/**
 * Evaluator cases for the `entra_group` attribute.
 *
 * Unlike every other rule attribute, this one cannot be compiled straight to
 * SQL: membership lives in Microsoft Entra and has to be fetched over the
 * network first. The tests below pin the two things that matter — the compiled
 * shape, and the failure semantics, which are the reason this attribute is
 * allowed to abort an evaluation rather than degrade.
 *
 * Same SQL-capture approach as segment-evaluation-builtin.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let capturedSql = ''

type SqlValue = string | number | boolean | null | SqlObj | SqlObj[]
interface SqlObj {
  __sql: true
  text: string
}

function makeSql(strings: TemplateStringsArray, ...values: SqlValue[]): SqlObj {
  let text = strings[0] ?? ''
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v && typeof v === 'object' && '__sql' in v) {
      text += (v as SqlObj).text
    } else if (Array.isArray(v)) {
      text += v
        .map((x) => (x && typeof x === 'object' && '__sql' in x ? x.text : String(x)))
        .join(', ')
    } else {
      text += String(v)
    }
    text += strings[i + 1] ?? ''
  }
  return { __sql: true, text }
}
makeSql.raw = (s: string): SqlObj => ({ __sql: true, text: s })
makeSql.join = (parts: SqlObj[], sep: SqlObj): SqlObj => ({
  __sql: true,
  text: parts.map((p) => p.text).join(sep.text),
})

vi.mock('@/lib/server/db', async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      execute: vi.fn(async (sqlObj: SqlObj) => {
        capturedSql = sqlObj.text
        return []
      }),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
      delete: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => []) })) })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => {}) })),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        await fn({
          insert: vi.fn(() => ({
            values: vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => {}) })),
          })),
          delete: vi.fn(() => ({ where: vi.fn(async () => {}) })),
        })
      }),
    },
    eq: vi.fn((a: unknown, b: unknown) => ({ __cond: 'eq', a, b })),
    and: vi.fn((...args: unknown[]) => ({ __cond: 'and', args })),
    inArray: vi.fn((col: unknown, vals: unknown[]) => ({ __cond: 'in', col, vals })),
    isNull: vi.fn((col: unknown) => ({ __cond: 'isNull', col })),
    sql: makeSql,
  }
})

type MockCondition = {
  attribute: string
  operator: string
  value?: string | number | boolean | string[]
}
type MockSegment = {
  id: string
  name: string
  type: string
  rules: { match: 'all' | 'any'; conditions: MockCondition[] } | null
}
let mockSegment: MockSegment | null = null

vi.mock('../segment.service', () => ({ getSegment: vi.fn(async () => mockSegment) }))
vi.mock('@/lib/server/integrations/user-sync-notify', () => ({
  notifyUserSyncIntegrations: vi.fn(async () => {}),
}))
vi.mock('@quackback/ids', () => ({ fromUuid: vi.fn((_p: string, id: string) => id) }))

const getEntraGroupMemberEmails = vi.fn<(groupId: string) => Promise<string[]>>()
vi.mock('@/lib/server/integrations/entra/graph', () => ({ getEntraGroupMemberEmails }))

import { evaluateDynamicSegment } from '../segment.evaluation'

const GROUP = '11111111-2222-3333-4444-555555555555'

function makeSegment(conditions: MockCondition[], match: 'all' | 'any' = 'all'): MockSegment {
  return { id: 'segment_test', name: 'Test Segment', type: 'dynamic', rules: { match, conditions } }
}

beforeEach(() => {
  capturedSql = ''
  mockSegment = null
  vi.clearAllMocks()
})

describe('evaluator — entra_group', () => {
  it('compiles resolved members into a lower-cased email IN list', async () => {
    getEntraGroupMemberEmails.mockResolvedValue(['ada@example.com', 'grace@example.com'])
    mockSegment = makeSegment([{ attribute: 'entra_group', operator: 'eq', value: GROUP }])

    await evaluateDynamicSegment('segment_test' as never)

    expect(getEntraGroupMemberEmails).toHaveBeenCalledWith(GROUP)
    expect(capturedSql).toContain('LOWER(u.email) IN')
    expect(capturedSql).toContain('ada@example.com')
    expect(capturedSql).toContain('grace@example.com')
  })

  // An empty group is a legitimate answer, and FALSE composes correctly under
  // `match: 'any'` where TRUE or a dropped condition would not.
  it('compiles an empty group to FALSE rather than matching everyone', async () => {
    getEntraGroupMemberEmails.mockResolvedValue([])
    mockSegment = makeSegment([{ attribute: 'entra_group', operator: 'eq', value: GROUP }])

    await evaluateDynamicSegment('segment_test' as never)

    expect(capturedSql).toContain('FALSE')
    expect(capturedSql).not.toContain('LOWER(u.email) IN')
  })

  // The property this attribute exists to protect. A Graph outage must abort
  // the evaluation, leaving membership as it was. Degrading to "no members"
  // would sweep every person out of the segment on the next sweep — for a
  // segment gating board or changelog access, a mass lockout caused by a
  // transient network error.
  it('propagates a Graph failure instead of evicting the segment', async () => {
    getEntraGroupMemberEmails.mockRejectedValue(new Error('Graph 503'))
    mockSegment = makeSegment([{ attribute: 'entra_group', operator: 'eq', value: GROUP }])

    await expect(evaluateDynamicSegment('segment_test' as never)).rejects.toThrow('Graph 503')
    expect(capturedSql).toBe('')
  })

  it('resolves each distinct group once even when cited by several conditions', async () => {
    getEntraGroupMemberEmails.mockResolvedValue(['ada@example.com'])
    mockSegment = makeSegment(
      [
        { attribute: 'entra_group', operator: 'eq', value: GROUP },
        { attribute: 'entra_group', operator: 'eq', value: GROUP },
      ],
      'any'
    )

    await evaluateDynamicSegment('segment_test' as never)

    expect(getEntraGroupMemberEmails).toHaveBeenCalledTimes(1)
  })

  it('ignores an unsupported operator without calling Graph', async () => {
    mockSegment = makeSegment([{ attribute: 'entra_group', operator: 'contains', value: GROUP }])

    await evaluateDynamicSegment('segment_test' as never)

    expect(getEntraGroupMemberEmails).not.toHaveBeenCalled()
  })

  it('does not touch Graph for rules with no entra_group condition', async () => {
    mockSegment = makeSegment([{ attribute: 'email', operator: 'contains', value: '@recf.org' }])

    await evaluateDynamicSegment('segment_test' as never)

    expect(getEntraGroupMemberEmails).not.toHaveBeenCalled()
    expect(capturedSql).toContain('@recf.org')
  })
})
