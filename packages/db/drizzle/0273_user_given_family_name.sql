-- given_name / family_name OIDC claims on the user row. Captured at sign-in
-- through the identity resolver's claim mapping, and refreshed from the
-- directory by the Entra profile sync. Surfaced only on team-side views
-- (admin user detail); every public surface keeps rendering `name` — the
-- IdP's display name — so a person's legal name never appears on the portal.
--
-- Nullable backfill: password/magic-link accounts and pre-existing rows simply
-- have no value until their next OIDC sign-in.
--
-- Guarded with IF NOT EXISTS so the migration replays as a no-op: a fleet
-- ledger heal re-runs the whole span, and an unguarded ADD COLUMN would
-- fail the second time and collapse the healable window.
--
-- Re-added on top of upstream as 0273. The fork carried this as 0126-era
-- migration 0133, whose index collided with upstream's own lineage.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "given_name" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "family_name" text;
