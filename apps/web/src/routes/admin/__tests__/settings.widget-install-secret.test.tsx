// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let secret: string | null = null
const mutateAsync = vi.fn(async () => 'wgt_new')

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useRouteContext: () => ({ baseUrl: 'https://feedback.example' }),
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  }
})
vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: secret }),
  useQuery: () => ({
    data: {
      useCase: 'feedback',
      hasWidgetInstalled: false,
      hasWidgetEnabled: true,
      widgetOriginHost: null,
      widgetSdkNeedsUpdate: false,
    },
  }),
}))
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: { widgetSecret: () => ({ queryKey: ['s'] }) },
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: { onboardingStatus: () => ({ queryKey: ['o'] }) },
}))
vi.mock('@/lib/client/mutations/settings', () => ({
  useRegenerateWidgetSecret: () => ({ mutateAsync, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { Route } = await import('../settings.widget.install')
const Page = Route.options.component as React.ComponentType

describe('widget install signing secret', () => {
  beforeEach(() => {
    mutateAsync.mockClear()
  })

  it('offers to generate a secret when the workspace has none', () => {
    secret = null
    render(<Page />)
    expect(
      screen.queryByRole('button', { name: /Copy widget signing secret/ })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rotate signing secret/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Generate signing secret/ }))
    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('offers copy and rotate once a secret exists, rotating only after confirmation', async () => {
    secret = `wgt_${'a'.repeat(64)}`
    render(<Page />)
    expect(screen.getByRole('button', { name: /Copy widget signing secret/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Generate signing secret/ })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Rotate signing secret/ }))
    expect(mutateAsync).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Rotate' }))
    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })
})
