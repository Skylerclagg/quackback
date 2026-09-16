/**
 * AI connection test.
 *
 * "Configured" and "working" are different things, and until now the product
 * could only show the first. The client in ./config is built lazily from the
 * API key and base URL and nothing ever probes the endpoint, so a key that is
 * revoked, a base URL missing its version path, or a model id that does not
 * exist all look identical from the admin UI: AI features simply produce
 * nothing. The provider's real error does get recorded — into ai_usage_log,
 * a table a self-hoster on a compose deployment has no way to read — and the
 * retry layer deliberately stays silent on 4xx (see retry.ts), so the one
 * failure an operator most wants to see is the one that never reaches a log.
 *
 * This module answers the question directly, from inside the running process
 * so it also proves the environment actually reached the container:
 *
 *   - describeAiConnection() reports what is configured, without any network.
 *   - runAiConnectionTest() makes one `GET /models/{id}` per configured model.
 *     That exercises key, base URL and model id together, costs no tokens, and
 *     is supported by every OpenAI-compatible endpoint that supports the models
 *     API at all. Failures are translated into a plain-language hint naming the
 *     variable to check, with the provider's own message kept alongside.
 *
 * The key is never returned. The snapshot carries its last four characters
 * only, enough to tell a rotated key from a stale one.
 */

import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { getOpenAI } from './config'
import { getEmbeddingModel, resolveModel } from './models'

const log = logger.child({ component: 'ai-connection-test' })

/** Cap on the provider message we echo back — enough to read, not a dump. */
const MAX_PROVIDER_MESSAGE = 300

export type MissingSetting = 'OPENAI_API_KEY' | 'OPENAI_BASE_URL' | 'AI_CHAT_MODEL'

export interface AiConnectionSnapshot {
  /** True when a probe can be attempted: key, base URL and a chat model are all set. */
  configured: boolean
  /** The endpoint as configured. Base URLs carry no secrets; shown so an operator can spot a missing `/v1`. */
  baseUrl: string | null
  /** Last four characters of the key, or null when unset. Never more than that. */
  keyHint: string | null
  /** Effective chat role default (AI_CHAT_MODEL), null when unset or disabled. */
  chatModel: string | null
  /** Effective embedding model, null when unset or disabled. */
  embeddingModel: string | null
  /** Which of the three required settings are absent, in a stable order. */
  missing: MissingSetting[]
}

export type ProbeRole = 'chat' | 'embedding'

export interface ProbeResult {
  role: ProbeRole
  model: string
  ok: boolean
  /** Provider message, trimmed. Only on failure. */
  error?: string
  /** What to check. Only on failure. */
  hint?: string
  durationMs: number
}

export interface AiConnectionTestResult {
  ok: boolean
  snapshot: AiConnectionSnapshot
  probes: ProbeResult[]
  /** Set when no probe could run at all (not configured). */
  error?: string
  hint?: string
  testedAt: string
}

/** The one method the probe needs. Kept minimal so tests inject a fake. */
export interface ModelProbeClient {
  models: { retrieve(id: string): Promise<unknown> }
}

function keyHintFor(key: string | undefined): string | null {
  if (!key) return null
  // A very short value is almost certainly a placeholder; don't echo it at all.
  return key.length >= 8 ? key.slice(-4) : '••••'
}

/** What is configured, with no network access. */
export function describeAiConnection(): AiConnectionSnapshot {
  const apiKey = config.openaiApiKey
  const baseUrl = config.openaiBaseUrl?.trim() || null
  const chatModel = resolveModel(undefined, config.aiChatModel)
  const embeddingModel = getEmbeddingModel()

  const missing: MissingSetting[] = []
  if (!apiKey) missing.push('OPENAI_API_KEY')
  if (!baseUrl) missing.push('OPENAI_BASE_URL')
  if (!chatModel) missing.push('AI_CHAT_MODEL')

  return {
    configured: missing.length === 0,
    baseUrl,
    keyHint: keyHintFor(apiKey),
    chatModel,
    embeddingModel,
    missing,
  }
}

function truncate(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_PROVIDER_MESSAGE
    ? `${oneLine.slice(0, MAX_PROVIDER_MESSAGE - 1)}…`
    : oneLine
}

interface ProviderErrorShape {
  status?: unknown
  code?: unknown
  message?: unknown
  cause?: unknown
}

/**
 * Translate a provider or network failure into a message plus a hint that
 * names the setting to check. Pure; duck-typed on the SDK error's `status`,
 * `code`, `message` and constructor name, so it needs no SDK import and is
 * trivial to test.
 *
 * Network failures are matched by class as well as by text. The wording of a
 * failed connection is the runtime's, not the SDK's — under Bun a dead port
 * and an unresolvable host both arrive as "Connection error." with the cause
 * "Unable to connect. Is the computer able to access the url?", and neither
 * mentions ECONNREFUSED or ENOTFOUND. The two are therefore reported with one
 * hint rather than guessed apart.
 */
export function explainProviderError(
  err: unknown,
  ctx: { baseUrl: string | null; model: string }
): { message: string; hint: string } {
  const e = (err ?? {}) as ProviderErrorShape
  const status = typeof e.status === 'number' ? e.status : undefined
  const code = typeof e.code === 'string' ? e.code : undefined
  const rawMessage =
    typeof e.message === 'string' && e.message.length > 0
      ? e.message
      : err instanceof Error
        ? err.message
        : String(err)
  const message = truncate(rawMessage)
  const lower =
    `${rawMessage} ${String((e.cause as { message?: unknown } | undefined)?.message ?? '')}`.toLowerCase()
  // `err.name` is the unhelpful "Error" on every SDK error; the class name is
  // the stable signal for a transport failure.
  const ctorName = (err as { constructor?: { name?: unknown } } | null | undefined)?.constructor
    ?.name
  const isConnectionError =
    ctorName === 'APIConnectionError' || ctorName === 'APIConnectionTimeoutError'

  if (status === 401) {
    return {
      message,
      hint: 'The endpoint rejected the API key. Check OPENAI_API_KEY is a current API key for this provider — a ChatGPT subscription login is not an API key.',
    }
  }
  if (status === 403) {
    return {
      message,
      hint: `The API key is not permitted to use "${ctx.model}" here. Check the key's project or organisation has access to this model.`,
    }
  }
  if (status === 404) {
    return {
      message,
      hint: `The endpoint does not recognise the model "${ctx.model}". Check the id matches one this provider offers, and that OPENAI_BASE_URL includes the API version path (for OpenAI, it ends in /v1). Some gateways do not support looking a model up by id.`,
    }
  }
  if (status === 429) {
    return code === 'insufficient_quota' ||
      lower.includes('insufficient_quota') ||
      lower.includes('quota')
      ? {
          message,
          hint: 'The account has no available quota. Add billing or credits to the API account this key belongs to.',
        }
      : {
          message,
          hint: 'The provider is rate limiting this key. Wait a moment and test again.',
        }
  }
  if (status !== undefined && status >= 500) {
    return {
      message,
      hint: 'The provider returned a server error. Wait a moment and test again; if it persists, check the provider’s status page.',
    }
  }
  if (
    isConnectionError ||
    /enotfound|getaddrinfo|econnrefused|econnreset|etimedout|socket hang up|fetch failed|connection error|unable to connect|able to access the url|network|certificate|self.signed|unable to verify/.test(
      lower
    )
  ) {
    return {
      message,
      hint: `Could not reach ${ctx.baseUrl ?? 'the endpoint'}. Check the OPENAI_BASE_URL host is correct and that the server can make outbound HTTPS connections to it.`,
    }
  }
  if (status === 400 || status === 422) {
    return {
      message,
      hint: 'The endpoint rejected the request as malformed. This usually means OPENAI_BASE_URL points at something that is not an OpenAI-compatible API.',
    }
  }
  return {
    message,
    hint: 'Check OPENAI_BASE_URL, OPENAI_API_KEY and the configured model ids together — the provider’s message above is the best clue.',
  }
}

async function probeOne(
  client: ModelProbeClient,
  role: ProbeRole,
  model: string,
  baseUrl: string | null
): Promise<ProbeResult> {
  const startedAt = Date.now()
  try {
    await client.models.retrieve(model)
    return { role, model, ok: true, durationMs: Date.now() - startedAt }
  } catch (err) {
    const { message, hint } = explainProviderError(err, { baseUrl, model })
    return { role, model, ok: false, error: message, hint, durationMs: Date.now() - startedAt }
  }
}

/**
 * One `GET /models/{id}` per configured model, in parallel. Embeddings are
 * probed only when a model is set for them; a missing embedding model is a
 * choice, not a failure.
 */
export async function probeModels(
  client: ModelProbeClient,
  snapshot: AiConnectionSnapshot
): Promise<ProbeResult[]> {
  const targets: Array<[ProbeRole, string]> = []
  if (snapshot.chatModel) targets.push(['chat', snapshot.chatModel])
  if (snapshot.embeddingModel) targets.push(['embedding', snapshot.embeddingModel])
  return Promise.all(
    targets.map(([role, model]) => probeOne(client, role, model, snapshot.baseUrl))
  )
}

/**
 * Run the full test. `client` is injectable for tests; production callers
 * let it default to the shared client (null when AI is not configured).
 */
export async function runAiConnectionTest(
  client: ModelProbeClient | null = getOpenAI()
): Promise<AiConnectionTestResult> {
  const snapshot = describeAiConnection()
  const testedAt = new Date().toISOString()

  if (!snapshot.configured || client === null) {
    const missing = snapshot.missing.join(', ')
    return {
      ok: false,
      snapshot,
      probes: [],
      error: missing ? `Not configured: ${missing} is not set.` : 'AI client is not available.',
      hint: 'Set the missing environment variable(s) on the app and restart it. There is no default endpoint or model.',
      testedAt,
    }
  }

  const probes = await probeModels(client, snapshot)
  const ok = probes.every((p) => p.ok)

  // The operator can see the result on screen; this line is for whoever is
  // reading the container logs afterwards and wants to correlate.
  log.info(
    {
      ok,
      base_url: snapshot.baseUrl,
      probes: probes.map((p) => ({ role: p.role, model: p.model, ok: p.ok, ms: p.durationMs })),
    },
    ok ? 'ai connection test passed' : 'ai connection test failed'
  )

  return { ok, snapshot, probes, testedAt }
}
