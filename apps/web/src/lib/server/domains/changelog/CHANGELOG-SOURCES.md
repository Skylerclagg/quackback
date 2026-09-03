# External changelog sources

Settings → Changelog → External changelogs. Each source is a page Quackback
reads on a schedule (hourly, plus "Sync now"); every release on it becomes one
changelog entry, filed under the chosen collection, created once and updated
when its notes change. Entries are keyed by source + release, so a re-run never
duplicates.

## Formats

**VitePress changelog page** — the rendered HTML of a single markdown file such
as `https://c2.recf.org/changelog.html`: one `##` heading per version, an
optional date paragraph right under it ("August 6, 2026"), then the notes.
Nothing has to change on the site for this to work; the trade-off is that a
redesign of the page could change what is read.

**JSON release feed** — a stable contract the site publishes at build time:

```json
[
  {
    "version": "v0.1.0-beta8",
    "date": "2026-08-06",
    "html": "<h3>Engage Support</h3><p>…</p>",
    "url": "https://c2.recf.org/changelog.html#v0-1-0-beta8"
  }
]
```

`version` (or `key`/`id`) is the stable key; `title` defaults to the version;
`date` (or `publishedAt`) is ISO or a natural date; the body is `html`,
`markdown` or `content`. `{ "releases": [...] }` is accepted as well.

### Emitting the JSON from VitePress

Add a `buildEnd` hook to `.vitepress/config.ts`. It reads the changelog markdown,
splits it on `##` headings, and writes `changelog.json` next to the site:

```ts
import { defineConfig } from 'vitepress'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import MarkdownIt from 'markdown-it'

export default defineConfig({
  // ...
  async buildEnd(siteConfig) {
    const md = new MarkdownIt()
    const source = await readFile(resolve(siteConfig.srcDir, 'changelog.md'), 'utf8')
    const releases = [...source.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |\s*$)/gm)].map((m) => {
      const version = m[1].trim()
      const body = m[2].trim()
      const dateLine = body.split('\n')[0]
      const hasDate = !Number.isNaN(Date.parse(dateLine))
      const slug = version
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      return {
        version,
        date: hasDate ? new Date(dateLine).toISOString().slice(0, 10) : null,
        html: md.render(hasDate ? body.slice(dateLine.length) : body),
        url: `https://c2.recf.org/changelog.html#${slug}`,
      }
    })
    await writeFile(resolve(siteConfig.outDir, 'changelog.json'), JSON.stringify(releases, null, 2))
  },
})
```

Then add a source with format "JSON release feed" and URL
`https://c2.recf.org/changelog.json`.
