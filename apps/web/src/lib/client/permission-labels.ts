/**
 * Display labels for the 15 permission-catalogue categories. Pinned complete
 * against PERMISSION_CATEGORIES by permission-labels.test.ts, so a new
 * category can't silently render as its raw snake_case key.
 */
import type { PermissionCategory, PermissionKey } from '@/lib/shared/permissions'

export const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  workspace: 'Workspace',
  members: 'Members',
  people: 'People',
  company: 'Companies',
  audience: 'Audience',
  feedback: 'Feedback',
  changelog: 'Changelog',
  help_center: 'Help center',
  survey: 'Surveys',
  conversation: 'Inbox',
  analytics: 'Analytics',
  integration: 'Integrations',
  support: 'Support',
  ai: 'AI',
  status_page: 'Status page',
}

/**
 * Plain-English name and one-line explanation for every permission. Typed
 * over the full key union, so a new permission cannot ship without both.
 * The role editor shows the label and puts the description (with the raw
 * key) on hover.
 */
export const PERMISSION_LABELS: Record<PermissionKey, { label: string; description: string }> = {
  // Workspace
  'settings.manage': {
    label: 'Manage settings',
    description:
      'Change workspace-wide settings: general, portal, and anything without a more specific permission.',
  },
  'billing.manage': {
    label: 'Manage billing',
    description: 'See and change the plan, payment method and invoices.',
  },
  'role.manage': {
    label: 'Manage roles',
    description: 'Create custom roles and decide which permissions each one grants.',
  },
  'api_key.manage': {
    label: 'Manage API keys',
    description: 'Create and revoke API keys for the public API and MCP.',
  },
  'webhook.view': {
    label: 'View webhooks',
    description: 'See configured webhooks and their delivery history.',
  },
  'webhook.manage': { label: 'Manage webhooks', description: 'Add, edit and remove webhooks.' },
  'auth.manage': {
    label: 'Manage sign-in',
    description: 'Configure sign-in methods, SSO providers and authentication rules.',
  },
  'audit.view': {
    label: 'View audit log',
    description: 'Read the audit trail of who changed what.',
  },
  'settings.branding': {
    label: 'Manage branding',
    description: 'Change the workspace logo, colours and portal appearance.',
  },
  'settings.moderation': {
    label: 'Manage moderation settings',
    description: 'Set moderation defaults, such as whether new posts need approval.',
  },
  'settings.notifications': {
    label: 'Manage notification settings',
    description: 'Configure workspace notification and email settings.',
  },
  'settings.custom_domain': {
    label: 'Manage custom domain',
    description: "Set up or change the portal's custom domain.",
  },
  'custom_field.manage': {
    label: 'Manage custom fields',
    description: 'Define the custom fields that boards and tickets collect.',
  },
  // Members
  'member.view': {
    label: 'View team members',
    description: 'See who is on the team and their roles.',
  },
  'member.manage': {
    label: 'Manage team members',
    description: 'Invite and remove team members and change their roles.',
  },
  // People
  'people.view': { label: 'View people', description: 'See portal users and their profiles.' },
  'people.manage': {
    label: 'Manage people',
    description: 'Create and edit portal users and their details.',
  },
  // Companies
  'company.view': {
    label: 'View companies',
    description: 'See companies and which people belong to them.',
  },
  'company.manage': {
    label: 'Manage companies',
    description: 'Create and edit companies and their memberships.',
  },
  // Audience
  'segment.view': {
    label: 'View segments',
    description: 'See customer segments and their members.',
  },
  'segment.manage': {
    label: 'Manage segments',
    description: 'Create and edit segments and the rules that fill them.',
  },
  'user_attribute.view': {
    label: 'View user attributes',
    description: 'See the custom attributes defined for people.',
  },
  'user_attribute.manage': {
    label: 'Manage user attributes',
    description: 'Define and edit the custom attributes kept on people.',
  },
  // Feedback
  'post.view_private': {
    label: 'View private posts',
    description: 'See posts on private boards and posts hidden from the portal.',
  },
  'post.create': {
    label: 'Create posts',
    description: 'Create posts from the admin on behalf of the team.',
  },
  'post.edit': { label: 'Edit posts', description: "Change any post's title and content." },
  'post.delete': { label: 'Delete posts', description: 'Delete posts and restore deleted ones.' },
  'post.set_status': { label: 'Change status', description: 'Move posts between statuses.' },
  'post.set_board': {
    label: 'Move between boards',
    description: 'Move a post to a different board.',
  },
  'post.set_tags': { label: 'Tag posts', description: 'Add and remove tags on posts.' },
  'post.set_owner': { label: 'Assign owner', description: 'Set which teammate owns a post.' },
  'post.set_author': {
    label: 'Change author',
    description: "Set a post's author to a different person.",
  },
  'post.merge': { label: 'Merge posts', description: 'Merge duplicate posts and undo merges.' },
  'post.export': { label: 'Export posts', description: 'Export feedback data.' },
  'post.set_pinned': { label: 'Pin posts', description: 'Pin posts to the top of a board.' },
  'post.set_eta': {
    label: 'Set ETA',
    description: "Set or clear a post's estimated delivery date.",
  },
  'post.approve': {
    label: 'Moderate posts',
    description: 'Review the moderation queue and approve or reject pending posts and comments.',
  },
  'post.vote_on_behalf': {
    label: 'Vote on behalf',
    description: 'Add or remove votes for a person, and see who voted.',
  },
  'comment.moderate': {
    label: 'Moderate comments',
    description: "Delete, restore and moderate anyone's comments.",
  },
  'comment.edit': { label: 'Edit comments', description: 'Edit comments written by others.' },
  'comment.pin': { label: 'Pin comments', description: 'Pin a comment to the top of a post.' },
  'comment.view_private': {
    label: 'View private comments',
    description: 'See internal, team-only comments.',
  },
  'board.manage': {
    label: 'Manage boards',
    description: 'Create boards and change their settings and access.',
  },
  'roadmap.manage': {
    label: 'Manage roadmaps',
    description: 'Create roadmaps and decide what they show.',
  },
  'status.view': { label: 'View statuses', description: 'See the list of post statuses.' },
  'status.manage': {
    label: 'Manage statuses',
    description: 'Create, rename, reorder and delete post statuses.',
  },
  'tag.view': { label: 'View tags', description: 'See the list of tags.' },
  'tag.manage': { label: 'Manage tags', description: 'Create, edit, delete and restore tags.' },
  'suggestion.view': {
    label: 'View AI suggestions',
    description: 'See AI-generated suggestions such as likely duplicates.',
  },
  'suggestion.manage': {
    label: 'Act on AI suggestions',
    description: 'Accept or dismiss AI suggestions.',
  },
  'prioritization.manage': {
    label: 'Manage prioritization',
    description: 'Configure prioritization scoring and frameworks.',
  },
  // Changelog
  'changelog.view_draft': {
    label: 'View draft changelog',
    description: 'See changelog entries before they are published.',
  },
  'changelog.manage': {
    label: 'Manage changelog',
    description: 'Write, publish, unpublish and delete changelog entries and collections.',
  },
  // Help center
  'help_center.manage': {
    label: 'Manage help center',
    description: 'Write and organise help center articles.',
  },
  // Surveys
  'survey.view': { label: 'View surveys', description: 'See surveys and their responses.' },
  'survey.manage': { label: 'Manage surveys', description: 'Create, edit and close surveys.' },
  // Inbox
  'conversation.view': {
    label: 'View conversations',
    description: 'Open conversations assigned to you or your teams.',
  },
  'conversation.view_all': {
    label: 'View all conversations',
    description: 'Open every conversation, whoever it is assigned to.',
  },
  'conversation.reply': {
    label: 'Reply',
    description: 'Send replies to customers in conversations.',
  },
  'conversation.note': {
    label: 'Add internal notes',
    description: 'Leave notes on conversations that customers cannot see.',
  },
  'conversation.assign': {
    label: 'Assign conversations',
    description: 'Assign conversations to teammates or teams.',
  },
  'conversation.manage': {
    label: 'Manage conversations',
    description: 'Close, reopen, snooze and delete conversations.',
  },
  'conversation.set_status': {
    label: 'Change conversation status',
    description: 'Open, close or snooze a conversation.',
  },
  'conversation.set_tags': {
    label: 'Tag conversations',
    description: 'Add and remove tags on conversations.',
  },
  'conversation.manage_tags': {
    label: 'Manage conversation tags',
    description: 'Create and edit the tags available for conversations.',
  },
  'conversation.manage_views': {
    label: 'Manage inbox views',
    description: 'Create and edit saved inbox views.',
  },
  'conversation.set_attributes': {
    label: 'Set conversation attributes',
    description: "Change a conversation's attributes, including approving changes the AI proposes.",
  },
  // Analytics
  'analytics.view': { label: 'View analytics', description: 'See dashboards and reports.' },
  // Integrations
  'integration.view': {
    label: 'View integrations',
    description: 'See which integrations are connected and how they are set up.',
  },
  'integration.manage': {
    label: 'Manage integrations',
    description: 'Connect, configure and disconnect integrations.',
  },
  // Support
  'ticket.view': {
    label: 'View tickets',
    description: 'Open tickets assigned to you or your teams.',
  },
  'ticket.view_all': {
    label: 'View all tickets',
    description: 'Open every ticket, whoever it is assigned to.',
  },
  'ticket.reply': { label: 'Reply to tickets', description: 'Send replies on tickets.' },
  'ticket.note': { label: 'Add ticket notes', description: 'Leave internal notes on tickets.' },
  'ticket.assign': {
    label: 'Assign tickets',
    description: 'Assign tickets to teammates or teams.',
  },
  'ticket.set_status': {
    label: 'Change ticket status',
    description: 'Open, resolve or close tickets.',
  },
  'ticket.create': {
    label: 'Create tickets',
    description: "Create tickets on a customer's behalf.",
  },
  'ticket.manage_types': {
    label: 'Manage ticket types',
    description: 'Define ticket types and their intake forms.',
  },
  'sla.manage': { label: 'Manage SLAs', description: 'Define response and resolution targets.' },
  'office_hours.manage': {
    label: 'Manage office hours',
    description: 'Set the hours that SLAs and auto-replies count as working time.',
  },
  'routing.manage': {
    label: 'Manage routing',
    description: 'Configure routing rules and review how automations are performing.',
  },
  'team.manage': {
    label: 'Manage support teams',
    description: 'Create teams and decide who is on them.',
  },
  'workflow.manage': {
    label: 'Manage workflows',
    description: 'Create and edit automation workflows, including auto-close and spam rules.',
  },
  'channel_account.manage': {
    label: 'Manage channels',
    description: 'Connect and configure inbound channels such as email and GitHub.',
  },
  // AI
  'assistant.manage': {
    label: 'Manage AI assistant',
    description: 'Configure the AI assistant and its connectors.',
  },
  'copilot.use': {
    label: 'Use AI copilot',
    description: 'Use AI drafting and assistance in the inbox.',
  },
  // Status page
  'status_page.manage': {
    label: 'Manage status page',
    description: 'Configure the status page and its components.',
  },
  'status_page.publish': {
    label: 'Publish incidents',
    description: 'Create and update incidents on the status page.',
  },
}
