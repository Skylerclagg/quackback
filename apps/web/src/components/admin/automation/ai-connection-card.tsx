'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { aiConnectionQueries } from '@/lib/client/queries/ai-connection'
import { testAiConnectionFn } from '@/lib/server/functions/ai-connection'

/**
 * Shows what the running app has for its AI endpoint and lets an admin prove
 * the connection works, from inside the container.
 *
 * Every other AI surface can only report "configured". This card is the one
 * place that distinguishes a wrong key, a wrong base URL and a wrong model id
 * from each other — the three failures that otherwise look identical (see
 * domains/ai/connection-test.ts for why they are invisible in the logs too).
 */
export function AiConnectionCard() {
  const intl = useIntl()
  const status = useQuery(aiConnectionQueries.status())
  const test = useMutation({ mutationFn: () => testAiConnectionFn() })

  const snapshot = test.data?.snapshot ?? status.data
  const configured = snapshot?.configured ?? false
  const result = test.data

  const badge = !snapshot
    ? null
    : !configured
      ? {
          variant: 'outline' as const,
          label: intl.formatMessage({
            id: 'automation.aiConnection.status.notConfigured',
            defaultMessage: 'Not configured',
          }),
        }
      : result === undefined
        ? {
            variant: 'secondary' as const,
            label: intl.formatMessage({
              id: 'automation.aiConnection.status.untested',
              defaultMessage: 'Untested',
            }),
          }
        : result.ok
          ? {
              variant: 'default' as const,
              label: intl.formatMessage({
                id: 'automation.aiConnection.status.connected',
                defaultMessage: 'Connected',
              }),
            }
          : {
              variant: 'destructive' as const,
              label: intl.formatMessage({
                id: 'automation.aiConnection.status.failed',
                defaultMessage: 'Failed',
              }),
            }

  const notSet = intl.formatMessage({
    id: 'automation.aiConnection.value.notSet',
    defaultMessage: 'Not set',
  })

  return (
    <section
      aria-labelledby="ai-connection-heading"
      className="rounded-xl border border-border/50 bg-card px-4 py-3 shadow-sm sm:px-5 sm:py-4"
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="ai-connection-heading" className="text-sm font-medium">
              {intl.formatMessage({
                id: 'automation.aiConnection.heading',
                defaultMessage: 'AI connection',
              })}
            </h2>
            {badge && (
              <Badge variant={badge.variant} shape="pill">
                {badge.label}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {intl.formatMessage({
              id: 'automation.aiConnection.description',
              defaultMessage:
                'The endpoint and models this deployment is using. Testing looks each model up on the provider — it validates the key, the base URL and the model id together and uses no tokens.',
            })}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full sm:min-h-9 sm:w-auto"
          disabled={!configured || test.isPending || status.isPending}
          onClick={() => test.mutate()}
        >
          {test.isPending
            ? intl.formatMessage({
                id: 'automation.aiConnection.testing',
                defaultMessage: 'Testing…',
              })
            : intl.formatMessage({
                id: 'automation.aiConnection.test',
                defaultMessage: 'Test connection',
              })}
        </Button>
      </div>

      {status.isError && !snapshot && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {intl.formatMessage({
            id: 'automation.aiConnection.loadError',
            defaultMessage: 'The AI configuration could not be loaded.',
          })}
        </p>
      )}

      {snapshot && (
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <ConfigRow
            label={intl.formatMessage({
              id: 'automation.aiConnection.field.endpoint',
              defaultMessage: 'Endpoint',
            })}
            value={snapshot.baseUrl}
            missing={snapshot.missing.includes('OPENAI_BASE_URL')}
            envVar="OPENAI_BASE_URL"
            notSet={notSet}
          />
          <ConfigRow
            label={intl.formatMessage({
              id: 'automation.aiConnection.field.apiKey',
              defaultMessage: 'API key',
            })}
            value={snapshot.keyHint ? `••••${snapshot.keyHint}` : null}
            missing={snapshot.missing.includes('OPENAI_API_KEY')}
            envVar="OPENAI_API_KEY"
            notSet={notSet}
          />
          <ConfigRow
            label={intl.formatMessage({
              id: 'automation.aiConnection.field.chatModel',
              defaultMessage: 'Chat model',
            })}
            value={snapshot.chatModel}
            missing={snapshot.missing.includes('AI_CHAT_MODEL')}
            envVar="AI_CHAT_MODEL"
            notSet={notSet}
          />
          <ConfigRow
            label={intl.formatMessage({
              id: 'automation.aiConnection.field.embeddingModel',
              defaultMessage: 'Embedding model',
            })}
            value={snapshot.embeddingModel}
            missing={false}
            envVar="AI_EMBEDDING_MODEL"
            notSet={intl.formatMessage({
              id: 'automation.aiConnection.value.optionalOff',
              defaultMessage: 'Not set (optional)',
            })}
          />
        </dl>
      )}

      <div aria-live="polite">
        {test.isError && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {intl.formatMessage({
              id: 'automation.aiConnection.runError',
              defaultMessage: 'The test could not be run. Try again.',
            })}
          </p>
        )}

        {result && result.probes.length === 0 && result.error && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">{result.error}</p>
            {result.hint && <p className="mt-1 text-muted-foreground">{result.hint}</p>}
          </div>
        )}

        {result && result.probes.length > 0 && (
          <ul className="mt-4 space-y-2" data-testid="ai-connection-probes">
            {result.probes.map((probe) => (
              <li
                key={`${probe.role}:${probe.model}`}
                className={
                  probe.ok
                    ? 'rounded-lg border border-border/50 p-3 text-sm'
                    : 'rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm'
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={probe.ok ? 'text-primary' : 'text-destructive'}
                    >
                      {probe.ok ? '✓' : '✕'}
                    </span>
                    <span className="font-medium">
                      {probe.role === 'chat'
                        ? intl.formatMessage({
                            id: 'automation.aiConnection.probe.chat',
                            defaultMessage: 'Chat model',
                          })
                        : intl.formatMessage({
                            id: 'automation.aiConnection.probe.embedding',
                            defaultMessage: 'Embedding model',
                          })}
                    </span>
                    <code className="text-xs text-muted-foreground">{probe.model}</code>
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {intl.formatMessage(
                      {
                        id: 'automation.aiConnection.probe.duration',
                        defaultMessage: '{ms} ms',
                      },
                      { ms: probe.durationMs }
                    )}
                  </span>
                </div>
                {!probe.ok && (
                  <>
                    {probe.hint && <p className="mt-2 text-muted-foreground">{probe.hint}</p>}
                    {probe.error && (
                      <p className="mt-1 break-words text-xs text-muted-foreground/80">
                        {intl.formatMessage(
                          {
                            id: 'automation.aiConnection.probe.providerSaid',
                            defaultMessage: 'Provider response: {message}',
                          },
                          { message: probe.error }
                        )}
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

interface ConfigRowProps {
  label: string
  value: string | null
  missing: boolean
  envVar: string
  notSet: string
}

/** One label/value pair; a missing required value names the variable to set. */
function ConfigRow({ label, value, missing, envVar, notSet }: ConfigRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={missing ? 'text-destructive' : 'break-all'}>
        {value ?? notSet}
        {missing && <code className="ml-2 text-xs text-muted-foreground">{envVar}</code>}
      </dd>
    </div>
  )
}
