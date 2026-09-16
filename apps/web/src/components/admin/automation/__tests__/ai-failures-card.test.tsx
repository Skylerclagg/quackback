// @vitest-environment happy-dom
/**
 * AiFailuresCard: the three states that lead an operator somewhere different
 * — failures recorded, everything succeeding, and nothing recorded at all.
 * The server function is mocked at the module boundary; no database here.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, within, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const hoisted = vi.hoisted(() => ({ activity: vi.fn(), status: vi.fn(), test: vi.fn() }))

vi.mock('@/lib/server/functions/ai-connection', () => ({
  getRecentAiActivityFn: hoisted.activity,
  getAiConnectionStatusFn: hoisted.status,
  testAiConnectionFn: hoisted.test,
}))

import { AiFailuresCard } from '../ai-failures-card'

function renderCard(ui: ReactElement = <AiFailuresCard />) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" defaultLocale="en" messages={{}}>
        {ui}
      </IntlProvider>
    </QueryClientProvider>
  )
}

const EMPTY = { windowHours: 168, successes: 0, failures: 0, groups: [] }

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('AiFailuresCard', () => {
  it('shows each failure with its feature, model, count and provider message', async () => {
    hoisted.activity.mockResolvedValue({
      windowHours: 168,
      successes: 4,
      failures: 42,
      groups: [
        {
          pipelineStep: 'extraction',
          model: 'gpt-4.1-nano',
          error: '404 Resource not found',
          count: 40,
          lastAt: new Date().toISOString(),
        },
        {
          pipelineStep: 'summary',
          model: 'my-summary-deployment',
          error: '401 Unauthorized',
          count: 2,
          lastAt: new Date().toISOString(),
        },
      ],
    })
    renderCard()

    expect(await screen.findByText('42 failed')).toBeTruthy()
    const groups = within(screen.getByTestId('ai-failure-groups'))
    expect(groups.getAllByRole('listitem')).toHaveLength(2)
    // The model column is the point: it shows what a per-feature override
    // actually resolved to, which is where a wrong deployment name shows up.
    expect(groups.getByText('my-summary-deployment')).toBeTruthy()
    expect(groups.getByText('404 Resource not found')).toBeTruthy()
    expect(groups.getByText('40 times')).toBeTruthy()
    expect(groups.getByText('2 times')).toBeTruthy()
  })

  it('reports a healthy window without listing anything', async () => {
    hoisted.activity.mockResolvedValue({ ...EMPTY, successes: 12 })
    renderCard()

    expect(await screen.findByText('All succeeded')).toBeTruthy()
    expect(screen.queryByTestId('ai-failure-groups')).toBeNull()
  })

  it('distinguishes "nothing ran" from "everything worked", and points at the worker', async () => {
    // Zero successes AND zero failures is the shape that means no AI call was
    // even attempted — a different problem from a failing provider.
    hoisted.activity.mockResolvedValue(EMPTY)
    renderCard()

    expect(await screen.findByText('No calls')).toBeTruthy()
    expect(screen.getByText(/QUACKBACK_ROLE/)).toBeTruthy()
    expect(screen.queryByTestId('ai-failure-groups')).toBeNull()
  })

  it('surfaces a read failure as an alert', async () => {
    hoisted.activity.mockRejectedValue(new Error('nope'))
    renderCard()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Recent AI activity could not be loaded.')
  })
})
