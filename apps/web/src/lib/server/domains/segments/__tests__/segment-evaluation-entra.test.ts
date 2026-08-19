/**
 * Evaluator tests for the `entra_group` rule attribute.
 *
 * Same SQL-capture harness as segment-evaluation-builtin.test.ts, with
 * the Graph accessor mocked. The two behaviors that matter most:
 * membership compiles to an email IN-list, and a Graph failure ABORTS
 * evaluation rather than compiling to "no members" — the latter would
 * sweep every member out of the segment on a transient outage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let capturedSql = ''
let transactionRan = false

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

vi.mock('@/lib/server/db', () => {
  return {
    db: {
      execute: vi.fn(async (sqlObj: SqlObj) => {
        capturedSql = sqlObj.text
        return []
      }),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => []),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(async () => {}),
        })),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        transactionRan = true
        await fn({
          insert: vi.fn(() => ({
            values: vi.fn(() => ({
              onConflictDoNothing: vi.fn(async () => {}),
            })),
          })),
          delete: vi.fn(() => ({
            where: vi.fn(async () => {}),
          })),
        })
      }),
    },
    eq: vi.fn((a: unknown, b: unknown) => ({ __cond: 'eq', a, b })),
    and: vi.fn((...args: unknown[]) => ({ __cond: 'and', args })),
    inArray: vi.fn((col: unknown, vals: unknown[]) => ({ __cond: 'in', col, vals })),
    isNull: vi.fn((col: unknown) => ({ __cond: 'isNull', col })),
    sql: makeSql,
    segments: { id: 'id', type: 'type', deletedAt: 'deleted_at' },
    userSegments: { segmentId: 'segment_id', principalId: 'principal_id', addedBy: 'added_by' },
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

vi.mock('../segment.service', () => ({
  getSegment: vi.fn(async () => mockSegment),
}))

vi.mock('@/lib/server/integrations/user-sync-notify', () => ({
  notifyUserSyncIntegrations: vi.fn(async () => {}),
}))

vi.mock('@quackback/ids', () => ({
  fromUuid: vi.fn((_prefix: string, id: string) => id),
  toUuid: vi.fn((id: string) => id),
}))

const mockGetEmails = vi.fn()
vi.mock('@/lib/server/integrations/entra/graph', () => ({
  getEntraGroupMemberEmails: (...a: unknown[]) => mockGetEmails(...a),
}))

import { evaluateDynamicSegment } from '../segment.evaluation'

const GROUP_ID = '11111111-2222-3333-4444-555555555555'

function makeSegment(conditions: MockCondition[], match: 'all' | 'any' = 'all'): MockSegment {
  return { id: 'segment_test', name: 'Test Segment', type: 'dynamic', rules: { match, conditions } }
}

beforeEach(() => {
  capturedSql = ''
  transactionRan = false
  mockSegment = null
  vi.clearAllMocks()
})

describe('evaluator — entra_group attribute', () => {
  it('compiles group membership to an email IN-list', async () => {
    mockGetEmails.mockResolvedValueOnce(['a@x.com', 'b@x.com'])
    mockSegment = makeSegment([{ attribute: 'entra_group', operator: 'eq', value: GROUP_ID }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(mockGetEmails).toHaveBeenCalledWith(GROUP_ID)
    expect(capturedSql).toContain('LOWER(u.email) IN (a@x.com, b@x.com)')
  })

  it('an EMPTY group compiles to FALSE (matches nobody — mirrors the group)', async () => {
    mockGetEmails.mockResolvedValueOnce([])
    mockSegment = makeSegment([{ attribute: 'entra_group', operator: 'eq', value: GROUP_ID }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('FALSE')
  })

  it('a Graph failure ABORTS evaluation without touching membership', async () => {
    mockGetEmails.mockRejectedValueOnce(new Error('Graph down'))
    mockSegment = makeSegment([{ attribute: 'entra_group', operator: 'eq', value: GROUP_ID }])
    await expect(evaluateDynamicSegment('segment_test' as never)).rejects.toThrow('Graph down')
    // No SQL evaluated, no membership writes — the segment keeps its
    // current members until Graph is reachable again.
    expect(capturedSql).toBe('')
    expect(transactionRan).toBe(false)
  })

  it('resolves each distinct group once even when referenced twice', async () => {
    mockGetEmails.mockResolvedValue(['a@x.com'])
    mockSegment = makeSegment(
      [
        { attribute: 'entra_group', operator: 'eq', value: GROUP_ID },
        { attribute: 'entra_group', operator: 'eq', value: GROUP_ID },
      ],
      'any'
    )
    await evaluateDynamicSegment('segment_test' as never)
    expect(mockGetEmails).toHaveBeenCalledTimes(1)
  })

  it('composes with other conditions', async () => {
    mockGetEmails.mockResolvedValueOnce(['a@x.com'])
    mockSegment = makeSegment(
      [
        { attribute: 'entra_group', operator: 'eq', value: GROUP_ID },
        { attribute: 'email_verified', operator: 'eq', value: true },
      ],
      'all'
    )
    await evaluateDynamicSegment('segment_test' as never)
    expect(capturedSql).toContain('LOWER(u.email) IN (a@x.com)')
    expect(capturedSql).toContain('AND')
    expect(capturedSql).toContain('email_verified')
  })

  it('segments without an entra condition never touch Graph', async () => {
    mockSegment = makeSegment([{ attribute: 'name', operator: 'eq', value: 'Alice' }])
    await evaluateDynamicSegment('segment_test' as never)
    expect(mockGetEmails).not.toHaveBeenCalled()
  })
})
