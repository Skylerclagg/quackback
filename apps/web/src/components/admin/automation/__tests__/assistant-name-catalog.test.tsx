// @vitest-environment happy-dom
/**
 * The configured assistant name must survive the message catalog.
 *
 * Copy is authored with the default name and swapped at render by
 * `withAssistantName`, which callers apply to the `defaultMessage` they hand
 * `intl.formatMessage`. But react-intl resolves by `id` FIRST: when the id
 * exists in the loaded catalog, the catalog's string is used and the
 * substituted defaultMessage is never consulted. en.json carries the literal
 * default name in 18 entries, and the admin shell loads that catalog
 * (routes/admin.tsx passes `loadMessages` output to IntlProvider), so every
 * one of those strings shows the default no matter what the workspace set.
 *
 * Every other component test in this directory renders with `messages={{}}`
 * AND pins the name to the default — two independent reasons they exercise
 * only the fallback path, which is why the suite was blind to this. These
 * tests deliberately use the REAL catalog and a NON-default name, the two
 * conditions that actually hold in production.
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import enMessages from '@/locales/en.json'

const CONFIGURED_NAME = 'Aiden'

const hoisted = vi.hoisted(() => ({
  permissions: new Set<string>(['assistant.manage', 'office_hours.manage', 'workflow.manage']),
}))

vi.mock('@/lib/client/hooks/use-assistant-name', () => ({
  useAssistantName: () => 'Aiden',
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouteContext: () => ({ settings: { featureFlags: { supportInbox: true } } }),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: '/admin/automation/workflows' } }),
}))

vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: (key: string) => hoisted.permissions.has(key),
}))

import { WhoRepliesFirstCard } from '../who-replies-first-card'

afterEach(cleanup)

/** The production shape: the real catalog, exactly as the admin shell loads it. */
function renderWithRealCatalog(ui: ReactNode) {
  return render(
    <IntlProvider
      locale="en"
      defaultLocale="en"
      messages={enMessages as unknown as Record<string, string>}
    >
      {ui}
    </IntlProvider>
  )
}

describe('assistant name vs the message catalog', () => {
  it('renders the configured name, not the authored default', () => {
    renderWithRealCatalog(<WhoRepliesFirstCard />)
    expect(screen.getByText(`Manage ${CONFIGURED_NAME}`)).toBeTruthy()
  })

  it('leaves no visible occurrence of the default name anywhere in the card', () => {
    // Broader than the assertion above: catches sibling strings in the same
    // component that were never wrapped at all, which the targeted check
    // would miss.
    const { container } = renderWithRealCatalog(<WhoRepliesFirstCard />)
    expect(container.textContent).not.toContain('Quinn')
    expect(container.textContent).toContain(CONFIGURED_NAME)
  })
})

describe('the catalog is what defeats the substitution', () => {
  it('pins that en.json still carries the authored default', () => {
    // Not a bug in itself — copy is authored with the default on purpose. It
    // is the reason a defaultMessage-side swap cannot work, and if these
    // entries are ever migrated to an ICU placeholder this test should be
    // updated deliberately rather than silently passing.
    const withDefaultName = Object.entries(enMessages as unknown as Record<string, string>).filter(
      ([, value]) => typeof value === 'string' && value.includes('Quinn')
    )
    expect(withDefaultName.length).toBeGreaterThan(0)
  })

  // The render tests above can only cover the components they mount, and the
  // defeated call sites were spread over eight files whose pages need the
  // router, permissions and a dozen queries to render. This pins the SHAPE
  // instead: the swap must never be applied to the `defaultMessage` going in,
  // because the catalog wins over it. It has to wrap what formatMessage
  // RETURNS. One grep is worth eight render harnesses.
  it('no caller applies the swap to defaultMessage, where the catalog defeats it', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { walkSourceFiles } = await import('@/lib/server/policy/source-files')
    const offenders = walkSourceFiles(join(process.cwd(), 'src')).filter((f) =>
      /defaultMessage:\s*(formattedW|w)ithAssistantName\(/.test(readFileSync(f, 'utf8'))
    )
    expect(offenders).toEqual([])
  })

  it('substitution works when the id is absent from the catalog — the path tests used to exercise', () => {
    // Establishes the contrast: with an empty catalog the same component
    // renders correctly, which is exactly why every existing test passed.
    render(
      <IntlProvider locale="en" defaultLocale="en" messages={{}}>
        <WhoRepliesFirstCard />
      </IntlProvider>
    )
    expect(screen.getByText(`Manage ${CONFIGURED_NAME}`)).toBeTruthy()
  })
})
