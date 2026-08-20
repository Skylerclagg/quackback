-- given_name / family_name OIDC claims on the user row. Captured at
-- signup via mapProfileToUser and refreshed from the stored ID token on
-- every SSO sign-in. Surfaced only on team-side views (admin user
-- detail); every public surface keeps rendering `name` — the IdP's
-- display name — so a person's legal name never appears on the portal.
-- Nullable backfill: password/magic-link accounts and pre-existing rows
-- simply have no value until their next OIDC sign-in.
ALTER TABLE "user" ADD COLUMN "given_name" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "family_name" text;
