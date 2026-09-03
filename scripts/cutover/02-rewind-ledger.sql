-- CUTOVER PHASE 2 — run after Phase 1, before the upstream migrator.
--
-- The fork and upstream share migration history through idx 125
-- (0125_conversation_channel_drop_default, when=1783641600000) and diverge
-- after it: the fork's 0126-0133 are entirely different migrations from
-- upstream's 0126+.
--
-- Drizzle decides what to apply by comparing each journal entry's `when`
-- against the newest `created_at` in this table. Left as-is, that newest value
-- is the fork's 0133 (2026-08-20), which is LATER than upstream's 0126
-- (2026-07-11) and 0127 (2026-07-12) — so the migrator would silently skip
-- upstream's RBAC and tag-rename migrations and then run 146 more that assume
-- the tables those two create. No error; just a wrong schema.
--
-- Deleting the 8 fork rows puts the high-water mark back to the last shared
-- migration, after which every upstream entry is newer and applies in order.
--
-- The fork's TABLES and COLUMNS are deliberately left in place. They collide
-- with nothing upstream creates, so they ride through the migration and
-- Phase 4 reads them.
DO $$
DECLARE
  shared_cutoff bigint := 1783641600000;  -- 0125_conversation_channel_drop_default
  before_count  int;
  deleted_count int;
BEGIN
  SELECT count(*) INTO before_count FROM drizzle.__drizzle_migrations;

  IF before_count <> 134 THEN
    RAISE EXCEPTION
      'Refusing to rewind: expected 134 applied migrations (fork at 0133), found %. '
      'This database is not at the fork tip this script was written for.', before_count;
  END IF;

  DELETE FROM drizzle.__drizzle_migrations WHERE created_at > shared_cutoff;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count <> 8 THEN
    RAISE EXCEPTION 'Refusing to continue: expected to remove 8 fork rows, removed %.', deleted_count;
  END IF;

  RAISE NOTICE 'Rewound ledger: % rows removed, % remain (high-water mark = idx 125).',
    deleted_count, before_count - deleted_count;
END $$;
