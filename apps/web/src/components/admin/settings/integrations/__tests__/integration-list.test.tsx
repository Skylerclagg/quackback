// @vitest-environment happy-dom
/**
 * Integrations page cards open a details dialog before anything is set up:
 *   - a connected provider offers "Manage integration" (its settings page)
 *   - an available-but-unconnected provider offers "Set up this integration"
 *   - a provider needing platform credentials hands off to the credentials form
 *   - a coming-soon provider only describes itself
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { IntegrationCatalogEntry } from '@/lib/shared/integration-types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string; [k: string]: unknown }) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('../platform-credentials-dialog', () => ({
  PlatformCredentialsDialog: ({ integrationName }: { integrationName: string }) => (
    <div data-testid="credentials-dialog">Credentials for {integrationName}</div>
  ),
}))

import { IntegrationList } from '../integration-list'

const entry = (over: Partial<IntegrationCatalogEntry>): IntegrationCatalogEntry => ({
  id: 'slack',
  name: 'Slack',
  description: 'Post feedback events into Slack channels.',
  category: 'notifications',
  capabilities: [
    { label: 'Send channel notifications', description: 'Posts a message when events occur.' },
  ],
  iconBg: 'bg-purple-600',
  settingsPath: '/admin/settings/integrations/slack',
  available: true,
  configurable: false,
  platformCredentialFields: [],
  docsUrl: 'https://docs.example.com/slack',
  ...over,
})

const catalog: IntegrationCatalogEntry[] = [
  entry({}),
  entry({ id: 'discord', name: 'Discord', settingsPath: '/admin/settings/integrations/discord' }),
  entry({
    id: 'github',
    name: 'GitHub',
    category: 'issue_tracking',
    available: false,
    configurable: true,
    platformCredentialFields: [{ key: 'clientId', label: 'Client ID', type: 'text' } as never],
    settingsPath: '/admin/settings/integrations/github',
  }),
  entry({
    id: 'notion',
    name: 'Notion',
    category: 'issue_tracking',
    available: false,
    configurable: false,
    settingsPath: '/admin/settings/integrations/notion',
  }),
]

function renderList() {
  return render(
    <IntegrationList catalog={catalog} integrations={[{ id: 'slack', status: 'active' }]} />
  )
}

afterEach(() => cleanup())

describe('IntegrationList details dialog', () => {
  it('describes a connected integration and offers to manage it', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /Slack/ }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Post feedback events into Slack channels.')).toBeTruthy()
    expect(screen.getByText('Send channel notifications')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Setup guide' }).getAttribute('href')).toBe(
      'https://docs.example.com/slack'
    )
    const manage = screen.getByRole('link', { name: 'Manage integration' })
    expect(manage.getAttribute('href')).toBe('/admin/settings/integrations/slack')
    // Radix adds its own screen-reader Close control; the footer button is last.
    const closeButtons = screen.getAllByRole('button', { name: 'Close' })
    fireEvent.click(closeButtons[closeButtons.length - 1]!)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('offers to set up an available integration that is not connected yet', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /Discord/ }))
    await screen.findByRole('dialog')
    expect(screen.getByRole('link', { name: 'Set up this integration' }).getAttribute('href')).toBe(
      '/admin/settings/integrations/discord'
    )
  })

  it('hands a credentials-first provider to the credentials form', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /GitHub/ }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Set up this integration' }))
    expect(await screen.findByTestId('credentials-dialog')).toHaveTextContent(
      'Credentials for GitHub'
    )
  })

  it('only describes a coming-soon provider', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /Notion/ }))
    await screen.findByRole('dialog')
    expect(screen.getByText('What this integration will do')).toBeTruthy()
    expect(screen.queryByText('Set up this integration')).toBeNull()
    expect(screen.queryByText('Manage integration')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0)
  })
})
