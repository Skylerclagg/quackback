/**
 * Shared storage configuration constants.
 * Client-safe subset of lib/server/storage/s3 — no AWS SDK or node:crypto deps.
 */

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
])

/** Validate that a file is an allowed image type. */
export function isAllowedImageType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(contentType)
}

/** Maximum allowed file size in bytes (5MB). */
export const MAX_FILE_SIZE = 5 * 1024 * 1024

/**
 * Non-image files a conversation composer may attach, keyed by extension —
 * the exports support asks visitors for (a CSV, a Competition Control
 * `.log`, a Tournament Manager `.db`). The browser's `File.type` is not
 * trustworthy for these: Windows reports a CSV as `application/vnd.ms-excel`
 * and `.db` / `.log` usually arrive with an empty type, so the extension is
 * the source of truth and the canonical type here is what gets stored and
 * served. Text formats are served as text under `nosniff`; SQLite is
 * verified by its file header server-side.
 */
export const DOCUMENT_ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  csv: 'text/csv',
  txt: 'text/plain',
  log: 'text/plain',
  json: 'application/json',
  db: 'application/vnd.sqlite3',
  sqlite: 'application/vnd.sqlite3',
  sqlite3: 'application/vnd.sqlite3',
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * The canonical content type for a file a composer wants to attach, or null
 * when it is neither an allowed image nor an allowed document. Images resolve
 * by declared type (browsers report those reliably); documents by extension.
 */
export function resolveAttachmentContentType(file: { name: string; type: string }): string | null {
  if (isAllowedImageType(file.type)) return file.type
  return DOCUMENT_ATTACHMENT_TYPES[fileExtension(file.name)] ?? null
}

/** True when a composer may attach this file (allowed image or document). */
export function isAllowedAttachmentFile(file: { name: string; type: string }): boolean {
  return resolveAttachmentContentType(file) !== null
}

/** `accept` attribute for a composer attachment picker: images plus the document extensions. */
export const ATTACHMENT_ACCEPT = [
  'image/*',
  ...Object.keys(DOCUMENT_ATTACHMENT_TYPES).map((ext) => `.${ext}`),
].join(',')

/** Upper-cased extension list for error messages: "CSV, TXT, LOG, …". */
export const DOCUMENT_ATTACHMENT_LABEL = Object.keys(DOCUMENT_ATTACHMENT_TYPES)
  .map((ext) => ext.toUpperCase())
  .join(', ')
