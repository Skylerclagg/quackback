'use client'

import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { Badge } from '@/components/ui/badge'
import { aiConnectionQueries } from '@/lib/client/queries/ai-connection'

/**
 * What actually happened to the real AI calls, from ai_usage_log.
 *
 * The connection test answers "can this deployment reach the provider right
 * now". This answers the different question an operator has when the test
 * passes and features still produce nothing: which feature failed, with which
 * model, and what the provider said. The two together separate a broken
 * endpoint from a single per-feature model override pointing at something
 * that does not exist.
 */
export function AiFailuresCard() {
  const intl = useIntl()
  const { data, isPending, isError } = useQuery(aiConnectionQueries.activity())

  const days = data ? Math.round(data.windowHours / 24) : 7
  const hasFailures = (data?.groups.length ?? 0) > 0
  // No calls at all is its own finding: nothing has even tried, which points
  // at the worker tier rather than at the provider.
  const idle = data !== undefined && data.successes === 0 && data.failures === 0

  return (
    <section
      aria-labelledby="ai-failures-heading"
      className="rounded-xl border border-border/50 bg-card px-4 py-3 shadow-sm sm:px-5 sm:py-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ai-failures-heading" className="text-sm font-medium">
          {intl.formatMessage({
            id: 'automation.aiFailures.heading',
            defaultMessage: 'Recent AI activity',
          })}
        </h2>
        {data && (
          <Badge variant={hasFailures ? 'destructive' : idle ? 'outline' : 'default'} shape="pill">
            {hasFailures
              ? intl.formatMessage(
                  {
                    id: 'automation.aiFailures.status.failing',
                    defaultMessage: '{count} failed',
                  },
                  { count: data.failures }
                )
              : idle
                ? intl.formatMessage({
                    id: 'automation.aiFailures.status.idle',
                    defaultMessage: 'No calls',
                  })
                : intl.formatMessage({
                    id: 'automation.aiFailures.status.healthy',
                    defaultMessage: 'All succeeded',
                  })}
          </Badge>
        )}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {intl.formatMessage(
          {
            id: 'automation.aiFailures.description',
            defaultMessage:
              'Outcomes of the AI calls this deployment actually made over the last {days} days, with the provider’s own message on each failure.',
          },
          { days }
        )}
      </p>

      {isPending && (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {intl.formatMessage({
            id: 'automation.aiFailures.loading',
            defaultMessage: 'Loading recent activity…',
          })}
        </p>
      )}

      {isError && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {intl.formatMessage({
            id: 'automation.aiFailures.loadError',
            defaultMessage: 'Recent AI activity could not be loaded.',
          })}
        </p>
      )}

      {data && (
        <>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.aiFailures.succeeded',
                  defaultMessage: 'Succeeded',
                })}
              </dt>
              <dd className="tabular-nums">{data.successes}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.aiFailures.failed',
                  defaultMessage: 'Failed',
                })}
              </dt>
              <dd className="tabular-nums">{data.failures}</dd>
            </div>
          </dl>

          {idle && (
            <p className="mt-4 rounded-lg border border-border/50 p-3 text-sm text-muted-foreground">
              {intl.formatMessage({
                id: 'automation.aiFailures.idleHelp',
                defaultMessage:
                  'No AI calls were recorded at all. Either nothing has triggered one yet, or the background worker that runs them is not processing jobs — check that QUACKBACK_ROLE is unset or set to “worker” or “all” on this deployment.',
              })}
            </p>
          )}

          {hasFailures && (
            <ul className="mt-4 space-y-2" data-testid="ai-failure-groups">
              {data.groups.map((group) => (
                <li
                  key={`${group.pipelineStep}:${group.model}:${group.error}`}
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{group.pipelineStep}</span>
                      <code className="text-xs text-muted-foreground">{group.model}</code>
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {intl.formatMessage(
                        {
                          id: 'automation.aiFailures.occurrences',
                          defaultMessage: '{count, plural, one {# time} other {# times}}',
                        },
                        { count: group.count }
                      )}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-xs text-muted-foreground/90">{group.error}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
