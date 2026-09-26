// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { WidgetMessages } from '../widget-messages'

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ sessionVersion: 0, isIdentified: true }),
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({}),
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  getMyConversationsFn: () => Promise.resolve({ conversations: [], linkedTickets: {} }),
}))

function renderMessages(teamInboxHref: string | null) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <WidgetMessages
          teamName="Support"
          assistant={null}
          onOpenMessenger={() => {}}
          teamInboxHref={teamInboxHref}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('WidgetMessages — teammate inbox notice', () => {
  it('links teammates out to the dashboard inbox in a new tab', () => {
    renderMessages('https://quack.example.com/admin/inbox')
    const notice = screen.getByTestId('widget-team-inbox-notice')
    const link = notice.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://quack.example.com/admin/inbox')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noreferrer')
  })

  it('shows nothing extra to ordinary visitors', () => {
    renderMessages(null)
    expect(screen.queryByTestId('widget-team-inbox-notice')).toBeNull()
  })
})
