# Restricting SSO sign-up to a group (Entra ID and other OIDC providers)

An identity provider can be told to create accounts only for people who are in
a particular group. This is the **Restrict new accounts to a group** section of
the provider's **Claim mapping** card under _Settings → Security → Sign-in_.

## What it does

- When someone signs in through the provider for the first time, Quackback
  creates their account only if they are in one of the listed groups. Two
  sources are consulted, in order:
  1. the configured claim (`groups` by default) in the ID token / userinfo;
  2. **for Entra ID providers, the directory**: Quackback asks Microsoft Graph
     whether the address is a member of one of the listed groups, using the
     same app-only credentials and the same cached group-member lookup the
     `Entra ID group` segment rules use. Direct members only, like segments.
- A person the rule admits gets the provider's **Default role** (Accounts card),
  or whatever the **Map roles from claims** rules resolve — exactly as a person
  at a verified domain would. They do not need to be at a verified domain.
- People who already have an account are **not** affected: the rule decides who
  gets an account, never who keeps one. Remove team access from _Team_ as
  before.
- An invitation an admin sent still admits its recipient even outside the group.
- With the rule set, someone not in the group sees
  _"Your account isn't in a group that's allowed to sign up here."_ on the
  sign-in page (`?error=sso_group_required`).

Stored on the provider row as `claim_mapping.access = { claimPath, anyOf }`.
An empty `anyOf` is treated as "not configured", never as "refuse everyone".

## Entra ID setup

If your segment rules already follow Entra groups, nothing more is needed in
Entra: the app registration behind the provider already has the application
permissions the directory lookup uses (`GroupMember.Read.All` plus
`User.Read.All` or `Directory.Read.All`, admin-consented). In Quackback, open
the provider → **Claim mapping** → **Restrict new accounts to a group** and
pick the groups by name — it is the same picker as the segment rule builder.
If Graph cannot be reached at sign-in time, the person sees _"couldn't confirm
your group membership"_ (`?error=sso_group_check_failed`) and can retry; they
are never silently treated as a non-member.

To avoid the Graph call entirely (or for a tenant without those permissions),
put the groups in the token instead:

1. In the Entra admin center open your app registration → **Token
   configuration** → **Add groups claim**.
2. Choose **Groups assigned to the application** (not _Security groups_). This
   keeps the claim in the ID token even for people in hundreds of groups —
   with _Security groups_, Entra stops emitting the claim past roughly 200
   groups and replaces it with an overage marker (`?error=sso_groups_overage`
   when no directory lookup is available either).
3. Under **Enterprise applications → your app → Users and groups**, assign the
   group(s) that may sign up.
4. Run **Test sign-in** on the provider; the group object IDs then appear as
   suggestions in the rule editor.

Values are matched case-insensitively, the same way the role-mapping rules
match, so a group ID that already grants a role can be reused as-is.
