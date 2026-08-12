import { Heading, Hr, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, utils } from './shared-styles'

interface NewSignInEmailProps {
  workspaceName?: string
  occurredAt: string
  ipAddress?: string | null
  userAgent?: string | null
  logoUrl?: string
}

/**
 * "New device" sign-in notification — sent only on first-sight of a
 * (UA + network-prefix) combination for the recipient's account. The
 * user is already signed in by the time this lands; the alert is purely
 * informational with a recovery path if it wasn't them.
 *
 * The wording leads with the DEVICE, not the sign-in. Signing in is
 * routine and expected; a device the account has never used before is
 * the part worth a recipient's attention.
 */
export function NewSignInEmail({
  workspaceName,
  occurredAt,
  ipAddress,
  userAgent,
  logoUrl,
}: NewSignInEmailProps) {
  return (
    <EmailLayout
      preview="Your account was used on a device we haven’t seen before"
      logoUrl={logoUrl}
    >
      <Heading style={typography.h1}>New device signed in to your account</Heading>
      <Text style={typography.text}>
        {workspaceName
          ? `Someone just signed in to your ${workspaceName} account on a device we haven't seen before.`
          : 'Someone just signed in to your account on a device we haven’t seen before.'}
      </Text>

      <Section style={utils.codeBox}>
        <Text style={typography.text}>
          <strong>When:</strong> {occurredAt}
        </Text>
        {ipAddress ? (
          <Text style={typography.text}>
            <strong>IP:</strong> {ipAddress}
          </Text>
        ) : null}
        {userAgent ? (
          <Text style={typography.text}>
            <strong>Device:</strong> {userAgent}
          </Text>
        ) : null}
      </Section>

      <Hr style={{ margin: '24px 0', borderColor: '#e5e7eb' }} />

      <Text style={typography.text}>
        If that was you, no action needed. If it wasn’t, change your password and revoke any other
        active sessions.
      </Text>

      <TransactionalFooter>
        You&apos;re receiving this because your account signed in from a device or network it
        hasn&apos;t used recently — not on every visit. These security alerts are required and
        can&apos;t be disabled.
      </TransactionalFooter>
    </EmailLayout>
  )
}
