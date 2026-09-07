import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { DEFAULT_ASSISTANT_NAME, setAssistantName } from '@/lib/client/assistant-name'

/**
 * The assistant's configured display name ("Quinn" until the identity query
 * resolves or when the workspace kept the default). Also keeps the non-React
 * name store in step, so static label tables follow the same name.
 */
export function useAssistantName(): string {
  const { data } = useQuery(assistantQueries.identity())
  const name = data?.name?.trim() || DEFAULT_ASSISTANT_NAME
  useEffect(() => {
    setAssistantName(name)
  }, [name])
  return name
}
