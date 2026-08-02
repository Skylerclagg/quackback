import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { z } from 'zod'
import { RssIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { ChangelogListPublic } from '@/components/portal/changelog'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { cn } from '@/lib/shared/utils'

const searchSchema = z.object({
  // Collection tab: a collection slug or 'general'; omitted = all entries
  changelog: z.string().optional(),
})

export const Route = createFileRoute('/_portal/changelog/')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    // Prefetch the collections so the tab strip is present in the SSR
    // HTML — without this the tabs pop in only after hydration.
    await context.queryClient.ensureQueryData(publicChangelogQueries.collections())
    return {
      workspaceName: context.settings?.name ?? 'Quackback',
      baseUrl: context.baseUrl ?? '',
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { workspaceName, baseUrl } = loaderData
    const title = `Changelog - ${workspaceName}`
    const description = `Stay up to date with the latest ${workspaceName} product updates and shipped features.`
    const canonicalUrl = baseUrl ? `${baseUrl}/changelog` : ''
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(canonicalUrl ? [{ property: 'og:url', content: canonicalUrl }] : []),
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
      ],
      links: canonicalUrl ? [{ rel: 'canonical', href: canonicalUrl }] : [],
    }
  },
  component: ChangelogPage,
})

function ChangelogPage() {
  const intl = useIntl()
  const navigate = useNavigate({ from: Route.fullPath })
  const { changelog: activeTab } = Route.useSearch()

  // Named collections visible to this viewer power the tab strip. With no
  // collections (or none visible) the page renders exactly as before.
  const { data: collections = [] } = useQuery(publicChangelogQueries.collections())
  const showTabs = collections.length > 0

  const tabs = [
    {
      slug: undefined as string | undefined,
      name: intl.formatMessage({ id: 'portal.changelog.tab.all', defaultMessage: 'All' }),
    },
    {
      slug: 'general',
      name: intl.formatMessage({ id: 'portal.changelog.tab.general', defaultMessage: 'General' }),
    },
    ...collections.map((c) => ({ slug: c.slug as string | undefined, name: c.name })),
  ]

  const feedUrl = activeTab
    ? `/changelog/feed?changelog=${encodeURIComponent(activeTab)}`
    : '/changelog/feed'

  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-8">
      <PageHeader
        size="large"
        title={intl.formatMessage({ id: 'portal.changelog.title', defaultMessage: 'Changelog' })}
        description={intl.formatMessage({
          id: 'portal.changelog.description',
          defaultMessage: 'Stay up to date with the latest product updates and shipped features.',
        })}
        action={
          <Button variant="outline" size="sm" asChild className="shrink-0 gap-1.5">
            <a href={feedUrl} target="_blank" rel="noopener noreferrer">
              <RssIcon className="h-4 w-4" />
              <span className="hidden sm:inline">
                {intl.formatMessage({ id: 'portal.changelog.rssFeed', defaultMessage: 'RSS Feed' })}
              </span>
            </a>
          </Button>
        }
        animate
        className="mb-8"
      />

      {showTabs && (
        <div
          className="flex flex-wrap items-center gap-1.5 mb-8 animate-in fade-in duration-300 fill-mode-backwards"
          role="tablist"
          aria-label="Changelogs"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.slug || (!activeTab && tab.slug === undefined)
            return (
              <button
                key={tab.slug ?? 'all'}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() =>
                  navigate({
                    search: tab.slug ? { changelog: tab.slug } : {},
                    replace: true,
                  })
                }
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {tab.name}
              </button>
            )
          })}
        </div>
      )}

      <div
        className="animate-in fade-in duration-300 fill-mode-backwards"
        style={{ animationDelay: '100ms' }}
      >
        <ChangelogListPublic changelog={activeTab} showChangelogBadge={!activeTab && showTabs} />
      </div>
    </div>
  )
}
