import { describe, expect, it } from 'vitest'
import { attachmentBytesMatchType, isSqliteHeader, looksLikePlainText } from '../magic-bytes'

const SQLITE = Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(100)])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('isSqliteHeader', () => {
  it('recognises the 16-byte SQLite 3 header', () => {
    expect(isSqliteHeader(SQLITE)).toBe(true)
  })

  it('rejects other bytes and short buffers', () => {
    expect(isSqliteHeader(PNG)).toBe(false)
    expect(isSqliteHeader(Buffer.from('SQLite format 3'))).toBe(false)
    expect(isSqliteHeader(Buffer.from('team,number\n1,2\n'))).toBe(false)
  })
})

describe('looksLikePlainText', () => {
  it('accepts UTF-8 and Windows-ANSI text (no UTF-8 validity check)', () => {
    expect(looksLikePlainText(Buffer.from('team,number\n1,2\n'))).toBe(true)
    // "é" in Windows-1252 — what Excel writes for a CSV on Windows.
    expect(looksLikePlainText(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))).toBe(true)
    expect(looksLikePlainText(Buffer.from('\uFEFFbom-prefixed\n'))).toBe(true)
  })

  it('accepts UTF-16 text by its byte-order mark despite the interleaved NULs', () => {
    expect(looksLikePlainText(Buffer.from('\uFEFFhello', 'utf16le'))).toBe(true)
  })

  it('rejects binaries and empty files', () => {
    expect(looksLikePlainText(PNG)).toBe(false)
    expect(looksLikePlainText(SQLITE)).toBe(false)
    expect(looksLikePlainText(Buffer.alloc(0))).toBe(false)
  })

  it('only inspects the leading 8 KiB', () => {
    const big = Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0])])
    expect(looksLikePlainText(big)).toBe(true)
  })
})

describe('attachmentBytesMatchType', () => {
  it('pairs each document type with its byte check', () => {
    expect(attachmentBytesMatchType(Buffer.from('a,b\n'), 'text/csv')).toBe(true)
    expect(attachmentBytesMatchType(Buffer.from('line\n'), 'text/plain')).toBe(true)
    expect(attachmentBytesMatchType(Buffer.from('{}'), 'application/json')).toBe(true)
    expect(attachmentBytesMatchType(SQLITE, 'application/vnd.sqlite3')).toBe(true)
  })

  it('rejects a renamed binary or a text file posing as a database', () => {
    expect(attachmentBytesMatchType(PNG, 'text/csv')).toBe(false)
    expect(attachmentBytesMatchType(SQLITE, 'text/plain')).toBe(false)
    expect(attachmentBytesMatchType(Buffer.from('not a db'), 'application/vnd.sqlite3')).toBe(false)
  })

  it('never vouches for image types (the image sniffer owns those)', () => {
    expect(attachmentBytesMatchType(PNG, 'image/png')).toBe(false)
  })
})
