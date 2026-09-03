import { describe, expect, it } from 'vitest'
import {
  inferReleaseDates,
  parseJsonChangelog,
  parseReleaseDate,
  parseVitePressChangelog,
} from '../changelog-source.parsers'

// Modelled on the rendered HTML of c2.recf.org/changelog.html (VitePress 1.x).
const PAGE = `<!DOCTYPE html><html><head><title>Changelog | Competition Control</title></head><body>
<div class="VPNav">Competition Control <a href="/changelog">Changelog</a></div>
<main class="main">
<div class="vp-doc">
<h1 id="changelog" tabindex="-1">Changelog <a class="header-anchor" href="#changelog" aria-label="Permalink to &quot;Changelog&quot;">​</a></h1>
<h2 id="v0-1-0-beta8" tabindex="-1">v0.1.0-beta8 <a class="header-anchor" href="#v0-1-0-beta8" aria-label="Permalink">​</a></h2>
<ul><li><em>August 6, 2026</em></li></ul>
<h3 id="engage-support" tabindex="-1">Engage Support <a class="header-anchor" href="#engage-support">​</a></h3>
<p>This release includes support for running Engage tournaments using Tier Takeover.</p>
<ul>
<li>Includes Engage-style exhibition finals matches</li>
</ul>
<h3 id="team-setup" tabindex="-1">Team Setup <a class="header-anchor" href="#team-setup">​</a></h3>
<ul>
<li>Adds support for generating placeholder teams</li>
<li>Improvements to the team setup UI</li>
</ul>
<h2 id="v0-1-0-beta7" tabindex="-1">v0.1.0-beta7 <a class="header-anchor" href="#v0-1-0-beta7">​</a></h2>
<p>July 21, 2026</p>
<p>Fixes a bug that prevented a red card from disqualifying teams.</p>
</div>
</main>
<footer>© RECF</footer>
</body></html>`

describe('parseVitePressChangelog', () => {
  const releases = parseVitePressChangelog(PAGE, 'https://c2.recf.org/changelog.html')

  it('finds one release per h2, keyed by its anchor, with a clean title', () => {
    expect(releases.map((r) => r.key)).toEqual(['v0-1-0-beta8', 'v0-1-0-beta7'])
    expect(releases[0]!.title).toBe('v0.1.0-beta8')
    expect(releases[0]!.url).toBe('https://c2.recf.org/changelog.html#v0-1-0-beta8')
  })

  it('reads the date (a one-item list, as VitePress renders it, or a paragraph) and keeps it out of the notes', () => {
    expect(releases[0]!.date?.toISOString().slice(0, 10)).toBe('2026-08-06')
    expect(releases[1]!.date?.toISOString().slice(0, 10)).toBe('2026-07-21')
    expect(releases[0]!.markdown).not.toContain('August 6, 2026')
  })

  it('converts the section to markdown with headings and bullets, without anchor links', () => {
    const md = releases[0]!.markdown
    expect(md).toContain('### Engage Support')
    expect(md).toContain('- Includes Engage-style exhibition finals matches')
    expect(md).toContain('- Adds support for generating placeholder teams')
    expect(md).not.toContain('header-anchor')
    expect(md).not.toContain('Permalink')
    // Content outside <main> (nav, footer) never leaks in.
    expect(md).not.toContain('RECF')
  })

  it('returns nothing for a page without release headings', () => {
    expect(
      parseVitePressChangelog('<main><h1>Empty</h1><p>Nothing here.</p></main>', 'https://x/y')
    ).toEqual([])
  })
})

describe('parseJsonChangelog', () => {
  it('accepts an array or a releases wrapper, with html or markdown bodies', () => {
    const out = parseJsonChangelog(
      {
        releases: [
          {
            version: 'v1.2.0',
            date: '2026-08-06',
            html: '<p>Adds <strong>dark mode</strong></p>',
            url: 'https://x/#v1',
          },
          {
            key: 'v1.1.0',
            title: 'v1.1.0',
            markdown: '- fixes',
            publishedAt: '2026-07-01T00:00:00Z',
          },
          { nonsense: true },
        ],
      },
      'https://x/changelog.json'
    )
    expect(out.map((r) => r.key)).toEqual(['v1.2.0', 'v1.1.0'])
    expect(out[0]!.markdown).toBe('Adds **dark mode**')
    expect(out[0]!.url).toBe('https://x/#v1')
    expect(out[1]!.url).toBe('https://x/changelog.json')
    expect(out[1]!.date?.toISOString().slice(0, 10)).toBe('2026-07-01')
  })
  it('returns nothing for shapes it does not understand', () => {
    expect(parseJsonChangelog('nope', 'https://x')).toEqual([])
    expect(parseJsonChangelog({ foo: 1 }, 'https://x')).toEqual([])
  })
})

describe('parseReleaseDate', () => {
  it('parses common release date spellings and rejects prose', () => {
    expect(parseReleaseDate('August 6, 2026')?.toISOString().slice(0, 10)).toBe('2026-08-06')
    expect(parseReleaseDate('2026-08-06')?.toISOString().slice(0, 10)).toBe('2026-08-06')
    expect(parseReleaseDate('This release includes support for Engage.')).toBeNull()
    expect(parseReleaseDate('')).toBeNull()
  })
})

describe('inferReleaseDates', () => {
  const rel = (key: string, date: string | null) => ({
    key,
    title: key,
    date: date ? new Date(date) : null,
    markdown: '',
    url: null,
  })

  it('places an undated release just before the nearest dated release above it', () => {
    const out = inferReleaseDates([
      rel('b8', '2026-08-06'),
      rel('b7', '2026-08-01'),
      rel('b5', null),
    ])
    expect(out[2]!.orderDate?.toISOString()).toBe('2026-07-31T23:59:59.000Z')
    expect(out[2]!.date).toBeNull()
  })

  it('places an undated first release just after the nearest dated one below', () => {
    const out = inferReleaseDates([rel('next', null), rel('b8', '2026-08-06')])
    expect(out[0]!.orderDate?.toISOString()).toBe('2026-08-06T00:00:01.000Z')
  })

  it('keeps dated releases and leaves everything null when nothing is dated', () => {
    expect(inferReleaseDates([rel('a', '2026-08-06')])[0]!.orderDate?.toISOString()).toBe(
      '2026-08-06T00:00:00.000Z'
    )
    expect(inferReleaseDates([rel('a', null), rel('b', null)]).map((r) => r.orderDate)).toEqual([
      null,
      null,
    ])
  })
})
