/**
 * Tests for the AI connection test.
 *
 * The classifier is pure and covers the failures that are otherwise
 * indistinguishable from the admin UI: bad key, bad base URL, bad model id,
 * no quota. The probe and runner take an injected client, so no module
 * mocking of the OpenAI SDK is needed — only `config` is mocked, and only to
 * drive describeAiConnection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: undefined as string | undefined,
  openaiBaseUrl: undefined as string | undefined,
  aiChatModel: undefined as string | undefined,
  aiEmbeddingModel: undefined as string | undefined,
}))

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}))
// The runner's default client argument comes from here; every test passes its
// own client, so this only has to exist.
vi.mock('../config', () => ({ getOpenAI: () => null }))

import {
  describeAiConnection,
  explainProviderError,
  probeModels,
  runAiConnectionTest,
  type AiConnectionSnapshot,
  type ModelProbeClient,
} from '../connection-test'

function setConfig(values: Partial<typeof mockConfig>) {
  mockConfig.openaiApiKey = values.openaiApiKey
  mockConfig.openaiBaseUrl = values.openaiBaseUrl
  mockConfig.aiChatModel = values.aiChatModel
  mockConfig.aiEmbeddingModel = values.aiEmbeddingModel
}

function fakeClient(behaviour: Record<string, unknown | Error>): ModelProbeClient {
  return {
    models: {
      retrieve: vi.fn(async (id: string) => {
        const outcome = behaviour[id]
        if (outcome instanceof Error) throw outcome
        return outcome ?? { id }
      }),
    },
  }
}

function apiError(status: number, message: string, code?: string): Error {
  const err = new Error(message) as Error & { status: number; code?: string }
  err.status = status
  if (code) err.code = code
  return err
}

const CTX = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }

describe('explainProviderError', () => {
  it('points a 401 at the API key, and says a ChatGPT login is not one', () => {
    const out = explainProviderError(apiError(401, 'Incorrect API key provided'), CTX)
    expect(out.hint).toContain('OPENAI_API_KEY')
    expect(out.hint).toContain('ChatGPT subscription')
    expect(out.message).toBe('Incorrect API key provided')
  })

  it('points a 403 at model access for that key', () => {
    const out = explainProviderError(apiError(403, 'Project does not have access'), CTX)
    expect(out.hint).toContain('gpt-4o-mini')
    expect(out.hint).toMatch(/project or organisation/)
  })

  it('points a 404 at the model id and the /v1 path, and allows for gateways', () => {
    const out = explainProviderError(apiError(404, 'The model does not exist'), CTX)
    expect(out.hint).toContain('"gpt-4o-mini"')
    expect(out.hint).toContain('/v1')
    expect(out.hint).toMatch(/gateways/)
  })

  it('distinguishes no-quota from rate limiting on a 429', () => {
    const quota = explainProviderError(
      apiError(429, 'You exceeded your current quota', 'insufficient_quota'),
      CTX
    )
    expect(quota.hint).toMatch(/billing or credits/)

    const quotaByMessage = explainProviderError(apiError(429, 'insufficient_quota'), CTX)
    expect(quotaByMessage.hint).toMatch(/billing or credits/)

    const limited = explainProviderError(apiError(429, 'Rate limit reached'), CTX)
    expect(limited.hint).toMatch(/rate limiting/)
  })

  it('treats 5xx as the provider’s problem', () => {
    const out = explainProviderError(apiError(503, 'Service Unavailable'), CTX)
    expect(out.hint).toMatch(/server error/)
  })

  it('points network failures at the base URL host, without a status', () => {
    const dns = explainProviderError(new Error('getaddrinfo ENOTFOUND api.openai.example'), CTX)
    expect(dns.hint).toContain('https://api.openai.com/v1')
    expect(dns.hint).toContain('OPENAI_BASE_URL')

    const refused = explainProviderError(new Error('connect ECONNREFUSED 127.0.0.1:443'), CTX)
    expect(refused.hint).toMatch(/Could not reach/)
  })

  it('reads the network cause when the SDK wraps it', () => {
    const wrapped = new Error('Connection error.') as Error & { cause: Error }
    wrapped.cause = new Error('getaddrinfo ENOTFOUND nope.invalid')
    const out = explainProviderError(wrapped, CTX)
    expect(out.hint).toMatch(/Could not reach/)
  })

  it('recognises the SDK’s connection error by class, whatever the runtime’s wording', () => {
    // The exact shape the installed SDK produces under Bun for BOTH a dead
    // port and an unresolvable host: no status, no code, `name` is "Error",
    // and nothing in the text says ECONNREFUSED or ENOTFOUND.
    class APIConnectionError extends Error {}
    const err = new APIConnectionError('Connection error.') as Error & { cause: Error }
    err.cause = new Error('Unable to connect. Is the computer able to access the url?')
    const out = explainProviderError(err, CTX)
    expect(out.hint).toMatch(/Could not reach/)
    expect(out.hint).toContain('OPENAI_BASE_URL')
  })

  it('recognises that wording from a plain Error too, without the SDK class', () => {
    const out = explainProviderError(
      new Error('Connection error. Unable to connect. Is the computer able to access the url?'),
      CTX
    )
    expect(out.hint).toMatch(/Could not reach/)
  })

  it('reads the live 401 shape: status plus the invalid_api_key code', () => {
    const out = explainProviderError(
      apiError(
        401,
        '401 Incorrect API key provided: sk-test-***0000. You can find your API key at https://platform.openai.com/account/api-keys.',
        'invalid_api_key'
      ),
      CTX
    )
    expect(out.hint).toContain('OPENAI_API_KEY')
  })

  it('reads a 400 as "this is not an OpenAI-compatible API"', () => {
    const out = explainProviderError(apiError(400, 'Bad Request'), CTX)
    expect(out.hint).toMatch(/not an OpenAI-compatible API/)
  })

  it('falls back to a generic hint but always keeps the provider message', () => {
    const out = explainProviderError(new Error('something odd'), CTX)
    expect(out.message).toBe('something odd')
    expect(out.hint).toMatch(/OPENAI_BASE_URL, OPENAI_API_KEY/)
  })

  it('collapses whitespace and truncates a very long provider message', () => {
    const out = explainProviderError(new Error(`a\n\n  b ${'x'.repeat(500)}`), CTX)
    expect(out.message.startsWith('a b ')).toBe(true)
    expect(out.message.length).toBeLessThanOrEqual(300)
    expect(out.message.endsWith('…')).toBe(true)
  })

  it('survives a non-Error throw', () => {
    const out = explainProviderError('boom', CTX)
    expect(out.message).toBe('boom')
  })
})

describe('describeAiConnection', () => {
  beforeEach(() => setConfig({}))

  it('reports everything missing when nothing is set', () => {
    const snap = describeAiConnection()
    expect(snap.configured).toBe(false)
    expect(snap.missing).toEqual(['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AI_CHAT_MODEL'])
    expect(snap.keyHint).toBeNull()
    expect(snap.baseUrl).toBeNull()
  })

  it('is configured only when key, base URL and a chat model are all present', () => {
    setConfig({
      openaiApiKey: 'sk-test-abcdefghijklmnop1234',
      openaiBaseUrl: 'https://api.openai.com/v1',
      aiChatModel: 'gpt-4o-mini',
    })
    const snap = describeAiConnection()
    expect(snap.configured).toBe(true)
    expect(snap.missing).toEqual([])
    expect(snap.chatModel).toBe('gpt-4o-mini')
    expect(snap.embeddingModel).toBeNull()
  })

  it('never returns more than the last four characters of the key', () => {
    setConfig({
      openaiApiKey: 'sk-test-abcdefghijklmnop1234',
      openaiBaseUrl: 'https://api.openai.com/v1',
      aiChatModel: 'gpt-4o-mini',
    })
    const snap = describeAiConnection()
    expect(snap.keyHint).toBe('1234')
    expect(JSON.stringify(snap)).not.toContain('sk-test')
  })

  it('does not echo a suspiciously short key at all', () => {
    setConfig({ openaiApiKey: 'abc', openaiBaseUrl: 'https://x/v1', aiChatModel: 'm' })
    expect(describeAiConnection().keyHint).toBe('••••')
  })

  it('treats a chat model of "off" as missing, so the probe has nothing to test', () => {
    setConfig({
      openaiApiKey: 'sk-test-abcdefghijklmnop1234',
      openaiBaseUrl: 'https://api.openai.com/v1',
      aiChatModel: 'off',
    })
    const snap = describeAiConnection()
    expect(snap.chatModel).toBeNull()
    expect(snap.configured).toBe(false)
    expect(snap.missing).toEqual(['AI_CHAT_MODEL'])
  })

  it('flags a key without a base URL — the trap for OpenAI users, since there is no default', () => {
    setConfig({ openaiApiKey: 'sk-test-abcdefghijklmnop1234', aiChatModel: 'gpt-4o-mini' })
    const snap = describeAiConnection()
    expect(snap.configured).toBe(false)
    expect(snap.missing).toEqual(['OPENAI_BASE_URL'])
  })

  it('treats a whitespace-only base URL as unset', () => {
    setConfig({
      openaiApiKey: 'sk-test-abcdefghijklmnop1234',
      openaiBaseUrl: '   ',
      aiChatModel: 'm',
    })
    expect(describeAiConnection().baseUrl).toBeNull()
  })
})

const CONFIGURED: AiConnectionSnapshot = {
  configured: true,
  baseUrl: 'https://api.openai.com/v1',
  keyHint: '1234',
  chatModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  missing: [],
}

describe('probeModels', () => {
  it('probes the chat and embedding models and reports both ok', async () => {
    const client = fakeClient({})
    const probes = await probeModels(client, CONFIGURED)
    expect(probes.map((p) => [p.role, p.model, p.ok])).toEqual([
      ['chat', 'gpt-4o-mini', true],
      ['embedding', 'text-embedding-3-small', true],
    ])
    expect(client.models.retrieve).toHaveBeenCalledTimes(2)
    for (const p of probes) expect(p.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('skips the embedding probe when no embedding model is set', async () => {
    const client = fakeClient({})
    const probes = await probeModels(client, { ...CONFIGURED, embeddingModel: null })
    expect(probes).toHaveLength(1)
    expect(probes[0].role).toBe('chat')
  })

  it('reports one model failing without hiding the other succeeding', async () => {
    const client = fakeClient({
      'text-embedding-3-small': apiError(404, 'The model does not exist'),
    })
    const probes = await probeModels(client, CONFIGURED)
    const chat = probes.find((p) => p.role === 'chat')!
    const emb = probes.find((p) => p.role === 'embedding')!
    expect(chat.ok).toBe(true)
    expect(emb.ok).toBe(false)
    expect(emb.error).toBe('The model does not exist')
    expect(emb.hint).toContain('"text-embedding-3-small"')
  })
})

describe('runAiConnectionTest', () => {
  beforeEach(() => setConfig({}))

  it('refuses to probe when not configured and names what is missing', async () => {
    setConfig({ openaiApiKey: 'sk-test-abcdefghijklmnop1234' })
    const client = fakeClient({})
    const result = await runAiConnectionTest(client)
    expect(result.ok).toBe(false)
    expect(result.probes).toEqual([])
    expect(result.error).toContain('OPENAI_BASE_URL')
    expect(result.error).toContain('AI_CHAT_MODEL')
    expect(client.models.retrieve).not.toHaveBeenCalled()
  })

  it('refuses when configured but no client is available', async () => {
    setConfig({
      openaiApiKey: 'sk-test-abcdefghijklmnop1234',
      openaiBaseUrl: 'https://api.openai.com/v1',
      aiChatModel: 'gpt-4o-mini',
    })
    const result = await runAiConnectionTest(null)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('AI client is not available.')
  })

  it('passes when every configured model resolves', async () => {
    setConfig({
      openaiApiKey: 'sk-test-abcdefghijklmnop1234',
      openaiBaseUrl: 'https://api.openai.com/v1',
      aiChatModel: 'gpt-4o-mini',
      aiEmbeddingModel: 'text-embedding-3-small',
    })
    const result = await runAiConnectionTest(fakeClient({}))
    expect(result.ok).toBe(true)
    expect(result.probes).toHaveLength(2)
    expect(result.error).toBeUndefined()
    expect(new Date(result.testedAt).getTime()).not.toBeNaN()
  })

  it('fails as a whole when any probe fails, and carries the snapshot for the UI', async () => {
    setConfig({
      openaiApiKey: 'sk-test-abcdefghijklmnop1234',
      openaiBaseUrl: 'https://api.openai.com/v1',
      aiChatModel: 'gpt-4o-mini',
    })
    const result = await runAiConnectionTest(
      fakeClient({ 'gpt-4o-mini': apiError(401, 'Incorrect API key provided') })
    )
    expect(result.ok).toBe(false)
    expect(result.probes[0].hint).toContain('OPENAI_API_KEY')
    expect(result.snapshot.keyHint).toBe('1234')
    expect(JSON.stringify(result)).not.toContain('sk-test')
  })
})
