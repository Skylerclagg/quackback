import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_ACCEPT,
  DOCUMENT_ATTACHMENT_LABEL,
  isAllowedAttachmentFile,
  resolveAttachmentContentType,
} from '../storage-config'

describe('resolveAttachmentContentType', () => {
  it('keeps an allowed image type as declared', () => {
    expect(resolveAttachmentContentType({ name: 'shot.png', type: 'image/png' })).toBe('image/png')
  })

  it('types documents by extension, not by the browser label', () => {
    // Windows with Excel installed reports CSV as an Excel type.
    expect(
      resolveAttachmentContentType({ name: 'teams.csv', type: 'application/vnd.ms-excel' })
    ).toBe('text/csv')
    // .db / .log usually arrive with no type at all.
    expect(resolveAttachmentContentType({ name: 'event.db', type: '' })).toBe(
      'application/vnd.sqlite3'
    )
    expect(
      resolveAttachmentContentType({ name: 'CompetitionControl-20260924.log', type: '' })
    ).toBe('text/plain')
    expect(resolveAttachmentContentType({ name: 'notes.txt', type: 'text/plain' })).toBe(
      'text/plain'
    )
    expect(resolveAttachmentContentType({ name: 'export.JSON', type: '' })).toBe('application/json')
  })

  it('refuses everything else, whatever the label claims', () => {
    expect(resolveAttachmentContentType({ name: 'doc.pdf', type: 'application/pdf' })).toBeNull()
    expect(resolveAttachmentContentType({ name: 'page.html', type: 'text/html' })).toBeNull()
    expect(resolveAttachmentContentType({ name: 'evil.exe', type: 'text/csv' })).toBeNull()
    expect(resolveAttachmentContentType({ name: 'noext', type: '' })).toBeNull()
    expect(resolveAttachmentContentType({ name: 'vector.svg', type: 'image/svg+xml' })).toBeNull()
  })

  it('is what the picker and the paste/drop filters agree on', () => {
    expect(isAllowedAttachmentFile({ name: 'a.csv', type: '' })).toBe(true)
    expect(isAllowedAttachmentFile({ name: 'a.pdf', type: 'application/pdf' })).toBe(false)
    expect(ATTACHMENT_ACCEPT.split(',')).toEqual(
      expect.arrayContaining(['image/*', '.csv', '.txt', '.log', '.json', '.db'])
    )
    expect(DOCUMENT_ATTACHMENT_LABEL).toContain('CSV')
    expect(DOCUMENT_ATTACHMENT_LABEL).toContain('DB')
  })
})
