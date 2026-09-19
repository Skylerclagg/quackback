/**
 * The `let_assistant_answer` block editor. Runtime seam: action.executor.ts
 * invokes runAssistantTurnForConversation with `stepInstructions`.
 */
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Textarea } from '@/components/ui/textarea'
import { Field } from './shared'
import { MAX_ASSISTANT_STEP_INSTRUCTIONS, type TreeStep } from '../../workflow-graph'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { settingsQueries } from '@/lib/client/queries/settings'
import { assistantWaitMinutes } from '@/lib/shared/workflows/abandoned-auto-close'
import { useAssistantName } from '@/lib/client/hooks/use-assistant-name'

export function LetAssistantAnswerEditor({
  step,
  onChange,
}: {
  step: Extract<TreeStep, { kind: 'let_assistant_answer' }>
  onChange: (step: TreeStep) => void
}) {
  const canAgent = usePermission(PERMISSIONS.ASSISTANT_MANAGE)
  const autoClose = useQuery(settingsQueries.workflowAbandonedAutoClose())
  const escalateMinutes = assistantWaitMinutes(autoClose.data)
  const assistantName = useAssistantName()

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Hands the turn to {assistantName} using its{' '}
        {canAgent ? (
          <Link to="/admin/automation/agent" className="font-medium text-primary hover:underline">
            Agent settings
          </Link>
        ) : (
          'Agent settings'
        )}
        , plus any one-time instruction below for just this step. Escalates after {escalateMinutes}{' '}
        {escalateMinutes === 1 ? 'minute' : 'minutes'} if {assistantName} can&apos;t reply.
      </p>

      <Field label="Instructions for this step (optional)">
        <Textarea
          value={step.instructions ?? ''}
          onChange={(e) => onChange({ ...step, instructions: e.target.value || undefined })}
          maxLength={MAX_ASSISTANT_STEP_INSTRUCTIONS}
          placeholder="e.g. Focus only on billing questions; hand off anything else."
          className="min-h-20 text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          Added to {assistantName}&apos;s prompt for this turn only — it never changes the
          workspace-wide configuration.
        </p>
      </Field>

      <p className="text-xs text-muted-foreground">
        Continues on its default path once {assistantName} answers. If the conversation escalates to
        a human, the run instead follows the “If escalated to a human” path below.
      </p>
    </div>
  )
}
