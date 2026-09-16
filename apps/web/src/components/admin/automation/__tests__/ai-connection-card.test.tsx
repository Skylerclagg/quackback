// @vitest-environment happy-dom
/**
 * AiConnectionCard: the states an admin sees, driven entirely by what the two
 * server functions return. The server functions are mocked at the module
 * boundary; nothing here talks to a provider.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, within, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const hoisted = vi.hoisted(() => ({
  status: vi.fn(),
  test: vi.fn(),
}))

vi.mock('@/lib/server/functions/ai-connection', () => ({
  getAiConnectionStatusFn: hoisted.status,
  testAiConnectionFn: hoisted.test,
}))

import { AiConnectionCard } from '../ai-connection-card'

function renderCard(ui: ReactElement = <AiConnectionCard />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" defaultLocale="en" messages={{}}>
        {ui}
      </IntlProvider>
    </QueryClientProvider>
  )
}

const CONFIGURED = {
  configured: true,
  baseUrl: 'https://api.openai.com/v1',
  keyHint: '1234',
  chatModel: 'gpt-4o-mini',
  embeddingModel: null,
  missing: [] as string[],
}

const NOT_CONFIGURED = {
  configured: false,
  baseUrl: null,
  keyHint: '1234',
  chatModel: 'gpt-4o-mini',
  embeddingModel: null,
  missing: ['OPENAI_BASE_URL'],
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('AiConnectionCard', () => {
  it('shows what is configured, masks the key, and offers the test', async () => {
    hoisted.status.mockResolvedValue(CONFIGURED)
    renderCard()

    expect(await screen.findByText('Untested')).toBeTruthy()
    expect(screen.getByText('https://api.openai.com/v1')).toBeTruthy()
    expect(screen.getByText('••••1234')).toBeTruthy()
    expect(screen.queryByText(/sk-/)).toBeNull()

    const button = screen.getByRole('button', { name: 'Test connection' })
    expect(button).not.toBeDisabled()
  })

  it('names the missing variable and disables the test when not configured', async () => {
    hoisted.status.mockResolvedValue(NOT_CONFIGURED)
    renderCard()

    expect(await screen.findByText('Not configured')).toBeTruthy()
    // The missing setting is named as the variable to set, not just "Not set".
    expect(screen.getByText('OPENAI_BASE_URL')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()
    expect(hoisted.test).not.toHaveBeenCalled()
  })

  it('reports a passing test with one row per probed model', async () => {
    hoisted.status.mockResolvedValue({ ...CONFIGURED, embeddingModel: 'text-embedding-3-small' })
    hoisted.test.mockResolvedValue({
      ok: true,
      snapshot: { ...CONFIGURED, embeddingModel: 'text-embedding-3-small' },
      probes: [
        { role: 'chat', model: 'gpt-4o-mini', ok: true, durationMs: 120 },
        { role: 'embedding', model: 'text-embedding-3-small', ok: true, durationMs: 95 },
      ],
      testedAt: new Date().toISOString(),
    })
    renderCard()

    // The button exists from the first paint but is disabled until the status
    // query settles; clicking before that is silently swallowed.
    await screen.findByText('Untested')
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('Connected')).toBeTruthy()
    const probes = within(screen.getByTestId('ai-connection-probes'))
    expect(probes.getAllByRole('listitem')).toHaveLength(2)
    expect(probes.getByText('gpt-4o-mini')).toBeTruthy()
    expect(probes.getByText('text-embedding-3-small')).toBeTruthy()
    expect(probes.getByText('120 ms')).toBeTruthy()
    expect(hoisted.test).toHaveBeenCalledTimes(1)
  })

  it('shows the hint and the provider’s own message when a probe fails', async () => {
    hoisted.status.mockResolvedValue(CONFIGURED)
    hoisted.test.mockResolvedValue({
      ok: false,
      snapshot: CONFIGURED,
      probes: [
        {
          role: 'chat',
          model: 'gpt-4o-mini',
          ok: false,
          error: 'Incorrect API key provided',
          hint: 'The endpoint rejected the API key. Check OPENAI_API_KEY.',
          durationMs: 40,
        },
      ],
      testedAt: new Date().toISOString(),
    })
    renderCard()

    // The button exists from the first paint but is disabled until the status
    // query settles; clicking before that is silently swallowed.
    await screen.findByText('Untested')
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('Failed')).toBeTruthy()
    expect(
      screen.getByText('The endpoint rejected the API key. Check OPENAI_API_KEY.')
    ).toBeTruthy()
    expect(screen.getByText('Provider response: Incorrect API key provided')).toBeTruthy()
  })

  it('shows the not-configured explanation when the server refuses to probe', async () => {
    hoisted.status.mockResolvedValue(CONFIGURED)
    hoisted.test.mockResolvedValue({
      ok: false,
      snapshot: NOT_CONFIGURED,
      probes: [],
      error: 'Not configured: OPENAI_BASE_URL is not set.',
      hint: 'Set the missing environment variable(s) on the app and restart it.',
      testedAt: new Date().toISOString(),
    })
    renderCard()

    // The button exists from the first paint but is disabled until the status
    // query settles; clicking before that is silently swallowed.
    await screen.findByText('Untested')
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('Not configured: OPENAI_BASE_URL is not set.')).toBeTruthy()
    expect(
      screen.getByText('Set the missing environment variable(s) on the app and restart it.')
    ).toBeTruthy()
    // The snapshot returned by the test drives the badge, so it flips to the
    // real state rather than staying on the stale pre-test read.
    expect(screen.getByText('Not configured')).toBeTruthy()
  })

  it('surfaces a failure to run the test at all as an alert', async () => {
    hoisted.status.mockResolvedValue(CONFIGURED)
    hoisted.test.mockRejectedValue(new Error('network down'))
    renderCard()

    // The button exists from the first paint but is disabled until the status
    // query settles; clicking before that is silently swallowed.
    await screen.findByText('Untested')
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The test could not be run. Try again.')
  })

  it('disables the button and relabels it while the test is running', async () => {
    hoisted.status.mockResolvedValue(CONFIGURED)
    let resolve!: (v: unknown) => void
    hoisted.test.mockReturnValue(new Promise((r) => (resolve = r)))
    renderCard()

    // The button exists from the first paint but is disabled until the status
    // query settles; clicking before that is silently swallowed.
    await screen.findByText('Untested')
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    const pending = await screen.findByRole('button', { name: 'Testing…' })
    expect(pending).toBeDisabled()

    resolve({ ok: true, snapshot: CONFIGURED, probes: [], testedAt: new Date().toISOString() })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Test connection' })).not.toBeDisabled()
    )
  })
})
