/**
 * Read releases out of an external changelog.
 *
 * Two shapes are understood. A VitePress changelog page (the rendered HTML of a
 * single markdown file: one `<h2>` per version, then a date paragraph, then the
 * release notes) and a JSON feed (an array of releases, or `{ releases: [] }`).
 * Pure functions: the caller fetches, these only parse.
 */
import TurndownService from 'turndown'

export interface ParsedRelease {
  /** Stable key within the source (the heading anchor, or the version). */
  key: string
  title: string
  date: Date | null
  /** Release notes as markdown. */
  markdown: string
  url: string | null
}

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' })

/** turndown pads list markers ("-   item"); tighten to the usual "- item". */
function toMarkdown(html: string): string {
  return turndown
    .turndown(html)
    .replace(/^(\s*)([-*])\s{2,}/gm, '$1$2 ')
    .replace(/^(\s*)(\d+\.)\s{2,}/gm, '$1$2 ')
    .trim()
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|​/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** "August 6, 2026", "2026-08-06", "6 Aug 2026" → Date; anything else → null. */
export function parseReleaseDate(text: string): Date | null {
  const t = text.trim()
  if (!t || t.length > 40) return null
  if (!/\d{4}/.test(t)) return null
  const ms = Date.parse(t)
  return Number.isNaN(ms) ? null : new Date(ms)
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function parseVitePressChangelog(html: string, pageUrl: string): ParsedRelease[] {
  const mainMatch = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)
  const scope = mainMatch ? mainMatch[1]! : html
  const headings = [...scope.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi)]
  const releases: ParsedRelease[] = []
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!
    const id = /\bid="([^"]+)"/.exec(h[1]!)?.[1]
    const title = stripTags(
      h[2]!.replace(/<a\b[^>]*class="header-anchor"[^>]*>[\s\S]*?<\/a>/gi, '')
    )
    if (!title) continue
    const start = h.index! + h[0].length
    const end = i + 1 < headings.length ? headings[i + 1]!.index! : scope.length
    let body = scope.slice(start, end)
    // First paragraph that is a date is the release date, not content.
    let date: Date | null = null
    const firstP = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(body)
    if (firstP) {
      const parsed = parseReleaseDate(stripTags(firstP[1]!))
      if (parsed) {
        date = parsed
        body = body.slice(0, firstP.index) + body.slice(firstP.index + firstP[0].length)
      }
    }
    body = body.replace(/<a\b[^>]*class="header-anchor"[^>]*>[\s\S]*?<\/a>/gi, '')
    const markdown = toMarkdown(body)
    const key = id ?? slugify(title)
    releases.push({
      key,
      title,
      date,
      markdown,
      url: id ? `${pageUrl.replace(/#.*$/, '')}#${id}` : pageUrl,
    })
  }
  return releases
}

interface JsonRelease {
  key?: unknown
  id?: unknown
  version?: unknown
  title?: unknown
  date?: unknown
  publishedAt?: unknown
  html?: unknown
  markdown?: unknown
  content?: unknown
  url?: unknown
}

export function parseJsonChangelog(data: unknown, pageUrl: string): ParsedRelease[] {
  const list: unknown = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? ((data as { releases?: unknown; items?: unknown }).releases ??
        (data as { items?: unknown }).items)
      : undefined
  if (!Array.isArray(list)) return []
  const releases: ParsedRelease[] = []
  for (const raw of list as JsonRelease[]) {
    if (!raw || typeof raw !== 'object') continue
    const title = String(raw.title ?? raw.version ?? '').trim()
    const key = String(raw.key ?? raw.id ?? raw.version ?? slugify(title)).trim()
    if (!title || !key) continue
    const dateRaw = raw.date ?? raw.publishedAt
    const date = typeof dateRaw === 'string' ? parseReleaseDate(dateRaw) : null
    const markdown =
      typeof raw.markdown === 'string'
        ? raw.markdown.trim()
        : typeof raw.html === 'string'
          ? toMarkdown(raw.html)
          : typeof raw.content === 'string'
            ? raw.content.trim()
            : ''
    releases.push({
      key,
      title,
      date,
      markdown,
      url: typeof raw.url === 'string' ? raw.url : pageUrl,
    })
  }
  return releases
}
