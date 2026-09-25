/**
 * Image magic-byte sniffer for the content rehoster.
 *
 * Parses the first few bytes of a response body and returns the detected
 * MIME type only if it matches one of our allowed image formats. The caller
 * uses this to verify that a server-reported Content-Type header wasn't
 * spoofed: if `header !== sniffed` or `sniffed === null`, reject the image.
 *
 * SVG is deliberately never returned — even if the bytes look XML-ish, we
 * don't allow SVG because it can carry script payloads.
 */

export const ALLOWED_REHOST_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/x-icon',
])

/**
 * Map equivalent MIME spellings to the canonical form `sniffImageMime` returns,
 * so a header cross-check accepts e.g. `image/vnd.microsoft.icon` as `image/x-icon`.
 * Owns the alias vocabulary alongside the canonical set above.
 */
export function canonicalizeImageMime(mime: string): string {
  if (mime === 'image/vnd.microsoft.icon' || mime === 'image/icon' || mime === 'image/ico') {
    return 'image/x-icon'
  }
  return mime
}

function startsWithAt(buf: Buffer, offset: number, pattern: number[]): boolean {
  if (buf.length < offset + pattern.length) return false
  for (let i = 0; i < pattern.length; i++) {
    if (buf[offset + i] !== pattern[i]) return false
  }
  return true
}

/**
 * Sniff the image MIME type from the first ~16 bytes of the buffer.
 * Returns one of ALLOWED_REHOST_MIMES or null.
 */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 8) return null

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWithAt(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (startsWithAt(buf, 0, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  // GIF: "GIF87a" or "GIF89a"
  if (buf.slice(0, 6).toString('ascii') === 'GIF87a') return 'image/gif'
  if (buf.slice(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  // AVIF: ...."ftyp""avif" or ...."ftyp""avis" at offset 4
  if (buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  // ICO: 00 00 01 00
  if (startsWithAt(buf, 0, [0x00, 0x00, 0x01, 0x00])) {
    return 'image/x-icon'
  }
  return null
}

/** SQLite 3 database file header: the 16-byte string "SQLite format 3\0". */
export function isSqliteHeader(buf: Buffer): boolean {
  return buf.length >= 16 && buf.subarray(0, 16).toString('latin1') === 'SQLite format 3\0'
}

/**
 * True when the leading bytes read as text rather than a binary blob: no NUL
 * byte in the first 8 KiB, unless the file opens with a UTF-16 byte-order
 * mark (Notepad's "Unicode" encoding interleaves NULs). Deliberately not a
 * UTF-8 validity check — Excel writes CSVs in the Windows ANSI code page, and
 * those must still pass. Enough to catch a renamed binary without decoding a
 * multi-megabyte log.
 */
export function looksLikePlainText(buf: Buffer): boolean {
  if (buf.length === 0) return false
  if (
    buf.length >= 2 &&
    ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))
  ) {
    return true
  }
  return !buf.subarray(0, 8192).includes(0)
}

/**
 * Whether an attachment's bytes are plausible for the type it will be stored
 * and served under (see DOCUMENT_ATTACHMENT_TYPES). Text and JSON must look
 * like text; SQLite must carry its header. Image types are the image
 * sniffer's job, so they return false here.
 */
export function attachmentBytesMatchType(buf: Buffer, contentType: string): boolean {
  if (contentType === 'application/vnd.sqlite3') return isSqliteHeader(buf)
  if (contentType.startsWith('text/') || contentType === 'application/json') {
    return looksLikePlainText(buf)
  }
  return false
}
