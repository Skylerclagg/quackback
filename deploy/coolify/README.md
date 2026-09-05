# Coolify: app stack + separate PostgreSQL resource

The RECF instance runs on Coolify as a Docker Compose resource built from this
repository (`docker-compose.coolify.yml`: the app and MinIO) plus a **Coolify
PostgreSQL database resource** that lives outside the stack. This is the
walkthrough for setting that up on the existing deployment, including the
fork → upstream cutover that the first deploy of the port performs.

Why the database is outside the stack: a redeploy of a compose stack restarts
every service in it, the database included; Coolify's scheduled backups only
exist for database resources; and a database inside the stack is removed with
the stack, so rebuilding or moving the app must not be able to take the data
with it.

Names used below: Coolify names containers `<service>-<resource id>`, so the
old stack's database is `postgres-lkw5npvwbel7tq1c9xzrodlg` and the app is
`app-lkw5npvwbel7tq1c9xzrodlg` (the `container_name` lines in the compose are
ignored). Confirm with `docker ps --format '{{.Names}}'` in the server
terminal if in doubt.

## 0. Where you are

Open the app resource in Coolify and look at its state.

- **Crash-looping on the new build** (the deploy log ends in
  `relation "changelog_categories" does not exist` and the container keeps
  restarting): the site is down, the old database is intact and untouched.
  Nothing is writing to it, so there is nothing to stop. Continue with step 1.
- **Rolled back and running the old build**: the site is up and people may be
  writing to the old database. Do step 1 now; you will stop the app right
  before the copy in step 3 so nothing is written after it.

Either way, the end state is the same: the new build, on the new database,
with the cutover done.

## 1. Create the database resource

In the project and environment that hold the app resource, click **+ New**
(Add Resource) → **Databases** → **PostgreSQL**.

On the resource's **General** page:

- **Image:** replace the default with `pgvector/pgvector:pg18`. Production is
  Postgres 18.6 today, and the app creates the `vector` extension at start,
  which the default `postgres` image does not have. Nothing else from the old
  custom image is needed: `pg_trgm` is in every Postgres image and pg_cron was
  never used.
- **Username / Password / Initial database:** your choice. A password without
  symbols saves you URL-encoding it below.
- Leave **Make it publicly available** off. The app reaches it over Coolify's
  internal network; nothing outside the server needs it.

Click **Start**. Once it is running the page shows a **Postgres URL
(internal)** like `postgres://user:pass@postgresql-database-abc123:5432/db`.
Copy it; the hostname is the resource's container name on the `coolify`
network.

Open the **Backups** tab and add a scheduled backup (daily is fine; local
storage on the server, or S3 if you have a bucket). This is the main reason
the database is moving out of the stack, so do it now rather than later.

## 2. Verify the extension is available (30 seconds)

On the database resource, open **Terminal** and run:

```bash
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "create extension if not exists vector" -c "select extversion from pg_extension where extname='vector'"
```

You should see a version in the 0.8 line. If you get "could not open extension
control file", the image field did not take; fix it and restart the resource.

## 3. Copy the data across

If the old app is **running** (rolled back), stop it first so nothing is
written after the copy: app resource → **Stop**. The site is down from here
until step 5 finishes, typically ten to fifteen minutes including the build.

Open **Servers → your server → Terminal** (the host shell Coolify provides;
nothing is installed). Find both database containers:

```bash
docker ps --format '{{.Names}}' | grep -i postgres
```

One is `postgres-lkw5npvwbel7tq1c9xzrodlg` (old, in the stack), the other is
`postgresql-database-<id>` (new resource). Then stream the old database into
the new one; no file is written:

```bash
docker exec postgres-lkw5npvwbel7tq1c9xzrodlg sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  | docker exec -i postgresql-database-<id> sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges'
```

It should finish quietly. The old database carries only the `vector`
extension, which the new image has; an error mentioning `pg_cron`, if one
appears, is harmless because the app never used it.

Verify on the new resource's **Terminal**:

```bash
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select count(*) as migrations from drizzle.__drizzle_migrations" \
  -c "select count(*) as posts from posts" \
  -c "select count(*) as users from \"user\""
```

Expect **134** migrations (the fork tip; the cutover has not run yet) and the
same post and user counts as the old database, which you can check with the
same queries in the old container:

```bash
docker exec postgres-lkw5npvwbel7tq1c9xzrodlg sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from posts" -c "select count(*) from \"user\""'
```

The old volume (`postgres_data`) stays on the server untouched. It is your
rollback until you delete it.

## 4. Point the app stack at the new database

On the app resource:

1. **General:** turn on **Connect To Predefined Network**. Without it the
   stack sits on its own network and cannot resolve the database hostname.
2. **Environment Variables:** add
   - `DATABASE_URL` = the internal URL from step 1, with the scheme written as
     `postgresql://` and the password URL-encoded if it contains symbols
     (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`).
   - `FORK_CUTOVER` = `auto`. This makes the first start of the new build run
     the fork → upstream cutover on the new database before serving
     (`scripts/cutover/README.md`, "Coolify").

   `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` are no longer read;
   leave them or delete them. Keep `SECRET_KEY` exactly as it is.

3. Save.

## 5. Deploy

Push `main` from your laptop, which has the new compose and the cutover
tooling:

```bash
cd ~/Documents/GitHub/quackback && git push origin main
```

If Coolify does not start a deploy on its own, click **Deploy**. Watch the
deployment log, then the app container's log. In order you should see:

1. the image build (several minutes);
2. `FORK_CUTOVER=auto — cutover pre-step (extract + ledger rewind)` and
   `notice: Rewound ledger: 8 rows removed, 126 remain`;
3. `Running database migrations...` and the migrator applying upstream
   `0126` onward through the port's `0279`, ending with lines like
   `every table this build declares exists`;
4. `FORK_CUTOVER=auto — cutover post-step (transform)`, a series of
   `[apply] ...` lines, then `fork-cutover post: transform committed and recorded.`;
5. `Starting Quackback server on port 3000...`.

The compose no longer defines `postgres`, so Coolify removes the old database
container during this deploy. Its volume is not touched.

If a step refuses, the log names the state it found and nothing was changed:
`fork-cutover pre: refusing — ledger has N rows ...` means the new database is
not at the fork tip (most likely the copy in step 3 did not complete);
`fork-cutover post: refusing — migrations are not complete` means the
migrator failed above it, and the migrator's own error is the one to read.

## 6. Check, then tidy

- Open the site, sign in with Entra, open a roadmap, the changelog and a post.
- On the new resource's terminal the migration count is now **257**, and
  `select step, done_at from cutover_state` lists `extract`, `rewind` and
  `transform`.
- Remove `FORK_CUTOVER` from the environment variables. Leaving it is safe,
  both steps are no-ops now, but a variable that reads like an instruction
  should not outlive its purpose.
- Admin → Settings → Authentication → the Entra provider: add
  `User.ReadWrite` and `offline_access` to the scopes, so the portal's name
  prompt can write names back to the directory.
- If the old stack still had a `dragonfly` container from the fork era, remove
  it and its volume; nothing reads it any more.
- After a few days of good behaviour, delete the old `postgres_data` volume.

## Rollback

Point the app resource at the tag `fork-pre-upgrade` (its compose still
contains the `postgres` service and reattaches the old volume untouched),
restore the old `POSTGRES_*` variables if you deleted them, and deploy.
Anything written to the new database after the switch is not in the old one.

## Later

MinIO can move out of the stack the same way, to any S3-compatible store;
uploads are referenced by key, not by host, so nothing in the app needs it to
stay local.
