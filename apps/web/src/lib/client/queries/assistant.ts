import { queryOptions } from '@tanstack/react-query'
import {
  getAssistantSettingsFn,
  getAssistantIdentityFn,
} from '@/lib/server/functions/assistant-settings'
import {
  listGuidanceRulesFn,
  listAssistantToolsFn,
} from '@/lib/server/functions/assistant-guidance'
import { getGuidanceRuleStatsFn } from '@/lib/server/functions/assistant-guidance-stats'

const STALE_TIME = 30 * 1000
// The tool catalogue is static, so it can sit stale far longer than settings
// a teammate is actively editing.
const TOOLS_STALE_TIME = 5 * 60 * 1000

export const assistantKeys = {
  settings: () => ['assistant', 'settings'] as const,
  identity: () => ['assistant', 'identity'] as const,
  guidanceRules: () => ['assistant', 'guidanceRules'] as const,
  guidanceRuleStats: () => ['assistant', 'guidanceRuleStats'] as const,
  tools: () => ['assistant', 'tools'] as const,
}

/** AI agent settings, guidance, and action-catalogue queries. */
export const assistantQueries = {
  settings: () =>
    queryOptions({
      queryKey: assistantKeys.settings(),
      queryFn: getAssistantSettingsFn,
      staleTime: STALE_TIME,
    }),
  /** Display name + avatar only; readable by any teammate (see useAssistantName). */
  identity: () =>
    queryOptions({
      queryKey: assistantKeys.identity(),
      queryFn: getAssistantIdentityFn,
      staleTime: TOOLS_STALE_TIME,
    }),

  guidanceRules: () =>
    queryOptions({
      queryKey: assistantKeys.guidanceRules(),
      queryFn: listGuidanceRulesFn,
      staleTime: STALE_TIME,
    }),

  /** Honest per-rule Applied count and last-applied timestamp, keyed by rule id. */
  guidanceRuleStats: () =>
    queryOptions({
      queryKey: assistantKeys.guidanceRuleStats(),
      queryFn: getGuidanceRuleStatsFn,
      staleTime: STALE_TIME,
    }),

  tools: () =>
    queryOptions({
      queryKey: assistantKeys.tools(),
      queryFn: listAssistantToolsFn,
      staleTime: TOOLS_STALE_TIME,
    }),
}
