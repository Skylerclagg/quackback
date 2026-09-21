/**
 * The READ side of `ticket_conversations`: what a ticket surface shows when it
 * offers "open the conversation this came from".
 *
 * Kept apart from ticket-conversation-link.service.test.ts, which covers the
 * write side, because the fixture closes with the describe that owns it and
 * this file's convention is one real-DB block per file.
 *
 * The distinction under test is the one the panel renders: a CUSTOMER link is
 * the pair — one shared thread under two ids — while any other type is
 * provenance, a separate conversation the ticket was merely opened from.
 * `resolveProvenanceConversationIds` deliberately excludes the pair because it
 * answers a different question (is there anywhere to share a note to?); this
 * one must include it, labelled, or a reader following the link would think
 * they were being sent somewhere new.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type ConversationId, type UserId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  settings,
  ticketConversations,
  conversations,
  user,
  principal,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('../ticket.webhooks', () => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishTicketEvent: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
}))

import { createTicket } from '../ticket.service'
import {
  linkTicketToConversation,
  listTicketConversations,
} from '../ticket-conversation-link.service'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketConversations.ticketId }).from(ticketConversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedAdminActor(): Promise<Actor> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Agent-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return {
    principalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

async function seedSettings(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
}

async function seedStatuses(): Promise<void> {
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  await testDb.insert(ticketStatuses).values({
    name: 'T-Open',
    slug: `t_open_${suffix()}`,
    category: 'open',
    position: 100,
    isDefault: true,
    publicStage: 'received',
  })
}

/** A conversation whose visitor carries a display name, so the title fallback
 *  chain (subject → visitor → generic) can be exercised end to end. */
async function seedConversation(visitorName?: string): Promise<ConversationId> {
  const userId = createId('user') as UserId
  const visitorPrincipalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Visitor-${suffix()}` })
  await testDb.insert(principal).values({
    id: visitorPrincipalId,
    userId,
    role: 'member',
    type: 'user',
    displayName: visitorName ?? null,
    createdAt: new Date(),
  })
  const conversationId = createId('conversation') as ConversationId
  await testDb
    .insert(conversations)
    .values({ id: conversationId, visitorPrincipalId, channel: 'messenger' })
  return conversationId
}

describe.skipIf(!fixture.available)('listTicketConversations (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('returns nothing for a ticket that was never opened from a conversation', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'back_office', title: 'Standalone' }, actor)

    expect(await listTicketConversations(ticket.id)).toEqual([])
  })

  it('labels a customer link as the pair — one shared thread, not a second one', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'customer', title: 'Cannot log in' }, actor)
    const conversationId = await seedConversation()
    await linkTicketToConversation(ticket.id, conversationId, actor)

    const linked = await listTicketConversations(ticket.id)
    expect(linked).toHaveLength(1)
    expect(linked[0]).toMatchObject({ id: conversationId, kind: 'pair', channel: 'messenger' })
  })

  it('labels a back-office link as provenance', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'back_office', title: 'Internal task' }, actor)
    const conversationId = await seedConversation()
    await linkTicketToConversation(ticket.id, conversationId, actor)

    const linked = await listTicketConversations(ticket.id)
    expect(linked).toHaveLength(1)
    expect(linked[0]).toMatchObject({ id: conversationId, kind: 'provenance' })
  })

  it('returns every conversation a back-office ticket was opened from', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'back_office', title: 'Spans threads' }, actor)
    const first = await seedConversation()
    const second = await seedConversation()
    await linkTicketToConversation(ticket.id, first, actor)
    await linkTicketToConversation(ticket.id, second, actor)

    const linked = await listTicketConversations(ticket.id)
    expect(linked.map((c) => c.id).sort()).toEqual([first, second].sort())
    expect(linked.every((c) => c.kind === 'provenance')).toBe(true)
  })

  it('titles a row by subject, then visitor, and never renders a blank label', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'back_office', title: 'Internal task' }, actor)
    const conversationId = await seedConversation('Ada Lovelace')
    await linkTicketToConversation(ticket.id, conversationId, actor)

    // No subject yet — the visitor names the thread.
    const [byVisitor] = await listTicketConversations(ticket.id)
    expect(byVisitor.title).toBe('Ada Lovelace')

    await testDb
      .update(conversations)
      .set({ subject: 'Refund for order 1182' })
      .where(eq(conversations.id, conversationId))
    const [bySubject] = await listTicketConversations(ticket.id)
    expect(bySubject.title).toBe('Refund for order 1182')

    // A subject that is only whitespace must fall THROUGH rather than render a
    // blank row the reader cannot aim at.
    await testDb
      .update(conversations)
      .set({ subject: '   ' })
      .where(eq(conversations.id, conversationId))
    const [blankSubject] = await listTicketConversations(ticket.id)
    expect(blankSubject.title).toBe('Ada Lovelace')
  })

  it('falls back to a generic label when neither subject nor visitor names it', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = await seedAdminActor()
    const ticket = await createTicket({ type: 'back_office', title: 'Internal task' }, actor)
    const conversationId = await seedConversation()
    await linkTicketToConversation(ticket.id, conversationId, actor)

    const [row] = await listTicketConversations(ticket.id)
    expect(row.title.trim()).not.toBe('')
  })
})
