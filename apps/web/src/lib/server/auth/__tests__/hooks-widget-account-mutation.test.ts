/**
 * Widget Bearers must not hit Better Auth's account-mutation endpoints. A
 * teammate identified through the widget holds a widget-scoped session; if
 * that token could drive change-email / link-social / revoke-sessions, an
 * embedding origin could mutate the teammate's dashboard account.
 */
import { describe, expect, it, vi } from 'vitest'
import { APIError } from 'better-auth/api'

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: {} },
}))

const { handleWidgetAccountMutationGate } = await import('../hooks')

function ctx(opts: { path: string; token?: string; cookie?: string; scope?: string | null }) {
  const headers = new Headers()
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`)
  if (opts.cookie) headers.set('cookie', opts.cookie)
  return {
    path: opts.path,
    headers,
    context: {
      internalAdapter: {
        findSession: vi.fn(async (token: string) => {
          if (opts.scope === null) return null
          if (opts.token && token !== opts.token.split('.')[0]) return null
          return { session: { scope: opts.scope } }
        }),
      },
    },
  }
}

describe('handleWidgetAccountMutationGate', () => {
  it('rejects a widget Bearer on request-email-change', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/email-otp/request-email-change', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toBeInstanceOf(APIError)
  })

  it('rejects a widget Bearer on change-email OTP confirm', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/email-otp/change-email', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  it('allows a portal-scoped Bearer so handoff customers can still change email', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/email-otp/request-email-change', token: 'portal-tok', scope: 'portal' })
      )
    ).resolves.toBeUndefined()
  })

  it('allows a dashboard-scoped Bearer', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/change-email', token: 'dash-tok', scope: 'dashboard' })
      )
    ).resolves.toBeUndefined()
  })

  it('reads the session token off the cookie too', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({
          path: '/change-email',
          cookie: 'better-auth.session_token=widget-tok.sig; theme=dark',
          scope: 'widget',
        })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  it('rejects a widget Bearer on session-revocation and account-link routes', async () => {
    for (const path of [
      '/revoke-sessions',
      '/revoke-other-sessions',
      '/link-social',
      '/oauth2/link',
    ]) {
      await expect(
        handleWidgetAccountMutationGate(ctx({ path, token: 'widget-tok', scope: 'widget' }))
      ).rejects.toThrow(/Widget sessions/)
    }
  })

  it('allows widget Bearers on the session/OTT allowlist', async () => {
    for (const path of ['/get-session', '/sign-in/anonymous', '/one-time-token/generate']) {
      await expect(
        handleWidgetAccountMutationGate(ctx({ path, token: 'widget-tok', scope: 'widget' }))
      ).resolves.toBeUndefined()
    }
  })

  it('rejects a widget Bearer on any other Better Auth path', async () => {
    await expect(
      handleWidgetAccountMutationGate(
        ctx({ path: '/sign-out', token: 'widget-tok', scope: 'widget' })
      )
    ).rejects.toThrow(/Widget sessions/)
  })

  it('no-ops when there is no session token or no session row', async () => {
    await expect(
      handleWidgetAccountMutationGate(ctx({ path: '/change-email' }))
    ).resolves.toBeUndefined()
    await expect(
      handleWidgetAccountMutationGate(ctx({ path: '/change-email', token: 'gone', scope: null }))
    ).resolves.toBeUndefined()
  })
})
