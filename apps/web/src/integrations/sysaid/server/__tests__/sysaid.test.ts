import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  infoValue,
  login,
  normaliseAccountUrl,
  serviceRecordUrl,
  splitCredentials,
  SysAidApiError,
} from '../api'
import { buildRecordInfo, sysaidIssues } from '../issues'
import { parseSysAidStatusPayload, sysaidInboundHandler } from '../inbound'
import { buildServiceRecordBody } from '../message'
import type { EventData } from '@/lib/server/events/types'

afterEach(() => vi.restoreAllMocks())

describe('account URL and credentials', () => {
  it('normalises the account URL to https without a trailing slash', () => {
    expect(normaliseAccountUrl('recf.sysaidit.com')).toBe('https://recf.sysaidit.com')
    expect(normaliseAccountUrl('https://recf.sysaidit.com/')).toBe('https://recf.sysaidit.com')
    expect(normaliseAccountUrl('http://recf.sysaidit.com')).toBe('https://recf.sysaidit.com')
  })
  it('splits username:password, keeping colons inside the password', () => {
    expect(splitCredentials('api-user:p:a:ss')).toEqual({
      username: 'api-user',
      password: 'p:a:ss',
    })
    expect(() => splitCredentials('nocolon')).toThrow(SysAidApiError)
  })
  it('builds the classic UI link for a record', () => {
    expect(serviceRecordUrl('https://recf.sysaidit.com', '42')).toBe(
      'https://recf.sysaidit.com/SREdit.jsp?id=42'
    )
  })
})

describe('login', () => {
  it('posts the API user credentials and keeps the session cookie', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=abc; Path=/; HttpOnly' },
      })
    )
    const session = await login('https://recf.sysaidit.com', 'api-user:secret')
    expect(session.cookie).toBe('JSESSIONID=abc')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://recf.sysaidit.com/api/v1/login')
    expect(JSON.parse(String(init?.body))).toEqual({ user_name: 'api-user', password: 'secret' })
  })
  it('maps a 401 to a non-retryable credentials error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))
    await expect(login('https://recf.sysaidit.com', 'u:p')).rejects.toMatchObject({
      retryable: false,
      status: 401,
    })
  })
})

describe('record fields', () => {
  it('maps title, description, the routed category and operator defaults into info entries', () => {
    const info = buildRecordInfo(
      {
        channelId: '17',
        fieldDefaults: [
          { key: 'urgency', value: '2' },
          { key: 'title', value: 'ignored' },
          { key: 'responsibility', value: 'IT Group' },
        ],
      },
      'Add dark mode',
      'Body'
    )
    expect(info).toEqual([
      { key: 'title', value: 'Add dark mode' },
      { key: 'description', value: 'Body' },
      { key: 'problem_type', value: '17' },
      { key: 'urgency', value: '2' },
      { key: 'responsibility', value: 'IT Group' },
    ])
  })
  it('omits the category for the default destination', () => {
    expect(
      buildRecordInfo({ channelId: 'default' }, 't', 'd').some((f) => f.key === 'problem_type')
    ).toBe(false)
  })
  it('reads a field back off a record', () => {
    expect(infoValue({ id: '1', info: [{ key: 'status', value: 3 }] }, 'status')).toBe('3')
  })
})

describe('issue creation', () => {
  it('logs in, creates the record, and returns the link', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'set-cookie': 'JSESSIONID=s1' } })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 908, info: [] }), { status: 200 }))
    const ref = await sysaidIssues.create!({
      auth: {
        accountUrl: 'recf.sysaidit.com',
        accessToken: 'u:p',
        channelId: '5',
        srType: 'incident',
      },
      title: 'T',
      bodyMarkdown: 'D',
    })
    expect(ref).toEqual({
      externalId: '908',
      externalDisplayId: 'SR #908',
      externalUrl: 'https://recf.sysaidit.com/SREdit.jsp?id=908',
    })
    const [createUrl, createInit] = fetchMock.mock.calls[1]!
    expect(createUrl).toBe('https://recf.sysaidit.com/api/v1/sr?type=incident')
    expect((createInit?.headers as Record<string, string>).Cookie).toBe('JSESSIONID=s1')
  })
  it('parses pasted references', () => {
    expect(
      sysaidIssues.parseRef!('https://recf.sysaidit.com/SREdit.jsp?id=42', {})?.externalId
    ).toBe('42')
    expect(sysaidIssues.parseRef!('#42', {})?.externalDisplayId).toBe('SR #42')
    expect(sysaidIssues.parseRef!('not a ref', {})).toBeNull()
  })
})

describe('inbound status webhook', () => {
  it('accepts JSON, SysAid record shape, and form bodies', () => {
    expect(parseSysAidStatusPayload('{"id": 42, "status": "Closed"}')).toEqual({
      id: '42',
      status: 'Closed',
    })
    expect(
      parseSysAidStatusPayload('{"id": 42, "info": [{"key":"status","value":"In Process"}]}')
    ).toEqual({ id: '42', status: 'In Process' })
    expect(parseSysAidStatusPayload('sr_id=7&status_caption=Resolved')).toEqual({
      id: '7',
      status: 'Resolved',
    })
    expect(parseSysAidStatusPayload('{"id": 42}')).toBeNull()
  })
  it('requires the shared secret, in a header or the query string', async () => {
    const ok = await sysaidInboundHandler.verifySignature(
      new Request('https://q.example/api/integrations/sysaid', {
        headers: { 'X-Webhook-Secret': 's3cret' },
      }),
      '',
      's3cret'
    )
    expect(ok).toBe(true)
    const viaQuery = await sysaidInboundHandler.verifySignature(
      new Request('https://q.example/api/integrations/sysaid?secret=s3cret'),
      '',
      's3cret'
    )
    expect(viaQuery).toBe(true)
    const bad = await sysaidInboundHandler.verifySignature(
      new Request('https://q.example/api/integrations/sysaid', {
        headers: { 'X-Webhook-Secret': 'nope' },
      }),
      '',
      's3cret'
    )
    expect(bad).toBeInstanceOf(Response)
  })
  it('reports the record id and status caption', async () => {
    expect(
      await sysaidInboundHandler.parseStatusChange('{"id":"9","status":"Closed"}', {}, {})
    ).toEqual({
      externalId: '9',
      externalStatus: 'Closed',
      eventType: 'sr.status_changed',
    })
  })
})

describe('record body', () => {
  it('describes the post in plain text with a link back', () => {
    const event = {
      id: 'e',
      timestamp: 't',
      actor: { type: 'system' },
      type: 'post.created',
      data: {
        post: {
          id: 'post_1',
          title: 'Dark mode',
          content: '<p>Please</p>',
          boardId: 'b',
          boardSlug: 'ideas',
          voteCount: 12,
          authorName: 'Sky',
        },
      },
    } as unknown as EventData
    const body = buildServiceRecordBody(event, 'https://quack.recf.cloud/')
    expect(body.title).toBe('Dark mode')
    expect(body.description).toContain('Please')
    expect(body.description).toContain('12 votes')
    expect(body.description).toContain('https://quack.recf.cloud/b/ideas/posts/post_1')
  })
})
