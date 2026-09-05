# Coolify: app stack + separate PostgreSQL resource

The RECF instance runs on Coolify as a Docker Compose resource built from this
repository (`docker-compose.coolify.yml`: the app and MinIO) plus a **Coolify
PostgreSQL database resource** that lives outside the stack. This document is
the runbook for setting that up and for moving an existing deployment whose
database still sits inside the stack.

Why the database is outside the stack: a redeploy of a compose stack restarts
every service in it, the database included; Coolify's scheduled backups only
exist for database resources; and a database inside the stack is removed with
the stack, so rebuilding or moving the app must not be able to take the data
with it.

## 1. Create the database resource

New Resource → Database → PostgreSQL, in the same project and environment as
the app.

- **Image:** `pgvector/pgvector:pg18`. The app creates the `vector` and
  `pg_trgm` extensions at start; Coolify's default `postgres` image has no
  pgvector and the app refuses to boot without it. `pg_trgm` is part of every
  Postgres image. Nothing else is needed — the old stack's custom image also
  loaded `pg_cron`, which the app never used.
- **Username, password, database name:** your choice; the password is only
  ever pasted into `DATABASE_URL` below, URL-encoded if it has symbols.
- Start it, then open **Backups** and schedule them (local or S3). This is the
  main reason the database moved out of the stack.

Copy the **internal URL** Coolify shows (`postgres://user:pass@<host>:5432/db`).
The host is the resource's internal hostname on the `coolify` network.

## 2. Copy the data across (existing deployment only)

The old database lives in the stack's `quackback-db` container. Copy it into
the new resource with one pipe from **Servers → your server → Terminal**; no
file is written and nothing is installed:

```bash
# find the new resource's container name (postgresql-database-<uuid>)
docker ps --format '{{.Names}}' | grep -i postgres

docker exec quackback-db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  | docker exec -i <new-container> sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges'
```

The restore should finish without errors: the old database carries only the
`vector` extension, which the new image has. (If an error about `pg_cron` does
appear, it is harmless — the app never used it.) Then verify, in the new
resource's terminal:

```bash
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from drizzle.__drizzle_migrations" \
                                            -c "select count(*) from posts" \
                                            -c "select count(*) from \"user\""
```

The migration count is 134 for a database copied before the fork cutover and
257 after it. Compare the other counts with the same queries on `quackback-db`.

Do this while the old stack is stopped or idle, so nothing changes after the
copy. The old volume (`postgres_data`) stays on the server until you delete it
and is your rollback.

## 3. Switch the app stack over

In the app resource:

1. **Environment variables:** add `DATABASE_URL` = the internal URL from
   step 1 (use the `postgresql://` scheme). `POSTGRES_USER`, `POSTGRES_PASSWORD`
   and `POSTGRES_DB` are no longer read; leave or remove them.
2. **Connect To Predefined Network:** on. Without it the stack sits on its own
   network and cannot resolve the database's hostname.
3. If this deploy is the first one of the upstream port, add
   `FORK_CUTOVER=auto` as well — the cutover runs on the new database at start
   (`scripts/cutover/README.md`, "Coolify").
4. Deploy `main`. The compose no longer defines `postgres`, so Coolify removes
   the old container; its volume is untouched.
5. Check the site, then remove `FORK_CUTOVER`.

## Rollback

Point the resource back at the previous commit (tag `fork-pre-upgrade`) whose
compose still contains the `postgres` service; it reattaches the old volume
untouched. Anything written to the new database after the switch is not in it.

## Later

MinIO can move out of the stack the same way, to any S3-compatible store
(uploads are referenced by key, not by host). Nothing in the app needs it to
stay local.
