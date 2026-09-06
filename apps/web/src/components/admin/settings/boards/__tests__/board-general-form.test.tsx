// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { BoardId } from '@quackback/ids'

const mutate = vi.fn()
vi.mock('@/lib/client/mutations', () => ({
  useUpdateBoard: () => ({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

const navigate = vi.fn()
// The form reads the status list for the auto-close target; stub it so the
// render needs no server function.
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    statuses: () => ({ queryKey: ['admin', 'statuses'], queryFn: async () => [] }),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

import { BoardGeneralForm } from '../board-general-form'

const board = {
  id: 'board_01test' as BoardId,
  name: 'Bug Reports',
  slug: 'bugs',
  description: 'Track issues',
}

beforeEach(() => {
  mutate.mockReset()
  navigate.mockReset()
})

describe('<BoardGeneralForm> rename navigation', () => {
  it('navigates to the new slug when a rename changes it', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardGeneralForm board={board} />
      </QueryClientProvider>
    )
    fireEvent.change(screen.getByLabelText('Board name'), {
      target: { value: 'Issue Tracker' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    })

    expect(mutate).toHaveBeenCalledTimes(1)
    const opts = mutate.mock.calls[0]![1] as { onSuccess: (b: { slug: string }) => void }
    act(() => {
      opts.onSuccess({ slug: 'issue-tracker' })
    })

    expect(navigate).toHaveBeenCalledWith({
      to: '/admin/settings/boards/$slug',
      params: { slug: 'issue-tracker' },
      search: {},
      replace: true,
    })
  })

  it('does not navigate when the slug is unchanged', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardGeneralForm board={board} />
      </QueryClientProvider>
    )
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Updated description' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    })

    const opts = mutate.mock.calls[0]![1] as { onSuccess: (b: { slug: string }) => void }
    act(() => {
      opts.onSuccess({ slug: 'bugs' })
    })

    expect(navigate).not.toHaveBeenCalled()
  })
})
