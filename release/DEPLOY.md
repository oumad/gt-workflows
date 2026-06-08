# Deploying coffee-maker

Every tagged release publishes a small config-only tarball:

    coffee-maker-<version>-deploy.tar.gz

Inside: the compose files, `.env` template, the frontend's nginx config
(for reference if you front the stack with Caddy/nginx/Traefik), and this
guide. The bundle does **not** ship Docker images — you build them on the
target host from a matching source checkout.

## Install

```bash
# 1. Extract the bundle
tar -xzf coffee-maker-<version>-deploy.tar.gz
cd coffee-maker-<version>

# 2. Get the sources matching this tag. Pick one:
#    a) Clone the repo at the tag:
git clone https://github.com/<owner>/coffee-maker.git --branch <version> src
#    b) Copy your existing api/ + frontend/ folders next to the compose files.
#    The compose files reference `./api` and `./frontend` build contexts —
#    they must live alongside docker-compose.yml.

# 3. Fill in required env vars (see table below).
cp .env.example .env
$EDITOR .env

# 4. Build images + start the stack
docker compose build
docker compose up -d
docker compose logs -f api frontend

# 5. Browse to http://<this-host>:${FRONTEND_PORT:-80}
```

First boot does two things automatically: applies the bundled Drizzle
migrations (creates the schema) and seeds the default admin user. Watch
the logs — the admin's auto-generated password is printed once.

## Required env vars

| Variable                  | What                                                                 |
|---------------------------|----------------------------------------------------------------------|
| `JWT_SECRET`              | Signing key for browser sessions. `openssl rand -hex 32`             |
| `CREDENTIALS_MASTER_KEY`  | AES-256-GCM key for credential encryption. `openssl rand -base64 32` |
| `POSTGRES_PASSWORD`       | Strong password for the bundled Postgres.                            |

The prod compose refuses to start without `JWT_SECRET` and
`CREDENTIALS_MASTER_KEY` (`${VAR:?...}` syntax fails fast).

## Optional env vars

| Variable               | Default                                          | Purpose                                                                         |
|------------------------|--------------------------------------------------|---------------------------------------------------------------------------------|
| `FRONTEND_PORT`        | `80`                                             | Public port the frontend binds. Set to 8080 if Caddy/nginx terminates TLS.      |
| `CORS_ORIGIN`          | `*`                                              | Allow-list for direct API consumers (CI / MCP). Browser is same-origin in prod. |
| `DISCORD_WEBHOOK_URL`  | _(unset)_                                        | Discord webhook for alerts + reminders. Rotate periodically.                    |
| `REDIS_BULLMQ_QUEUE`   | `workflow-studio-comfyui-process-queue`          | Must match gt-workflows' producer.                                              |
| `REDIS_BULLMQ_PREFIX`  | `bull`                                           | BullMQ Redis key prefix. Match the producer.                                    |
| `WORKFLOWS_DIR`        | `./workflows`                                    | Host path bind-mounted into the API container. Back this up.                    |

## Putting TLS in front

The bundled frontend container speaks plain HTTP on its bound port. To
terminate TLS:

1. Set `FRONTEND_PORT=8080` (or any internal port) so it isn't on 80/443.
2. Stand up Caddy / nginx / Traefik on the host bound to 443.
3. Reverse-proxy `https://<host>/` → `http://localhost:8080`.

Caddyfile example (auto-Let's Encrypt):

```caddy
coffee-maker.example.com {
  reverse_proxy localhost:8080
}
```

## Backups

Two things need backing up on a real production deploy:

1. **Postgres data volume** (`postgres_data` in the prod compose). Daily
   `pg_dump` is the simple path:

   ```bash
   docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" coffee_maker \
     | gzip > "backups/$(date +%Y-%m-%d).sql.gz"
   ```

2. **Workflows folder** (`WORKFLOWS_DIR`). Holds every workflow's
   `.history/` snapshots — the persistent state for the in-app versioning
   story. Daily `tar` recommended.

Both should be shipped off-host (S3, B2, or even an rsync to a second box)
so a single-machine failure doesn't take everything.

## Upgrading

```bash
# 1. Download + extract the new bundle.
tar -xzf coffee-maker-<new-version>-deploy.tar.gz
cd coffee-maker-<new-version>

# 2. Diff .env.example against your current .env and fill any new keys.

# 3. Replace the api/ + frontend/ sources with the new tag's.
git -C src fetch origin <new-version>
git -C src checkout <new-version>

# 4. Rebuild + restart. Compose recreates only the changed containers.
docker compose build
docker compose up -d

# 5. Migrations run automatically on next API boot.

# 6. Once you've confirmed the new version is healthy, prune old images.
docker image prune
```

## Rolling back

Keep the previous bundle directory (with its `src/` checkout) around. To
revert: `cd` into it and `docker compose up -d` — older containers come
back online. The Postgres volume is shared between versions; Drizzle
migrations are forward-only, so a schema-incompatible rollback also needs
a `pg_restore` from the most recent dump.

## Re-enabling pre-built images later

If you'd rather ship image tarballs in the release bundle instead of
building on the target host:

1. Reinstate the docker-buildx + `docker save | gzip` steps in
   `.github/workflows/release.yml` (git history of the workflow has the
   full version).
2. Bundle `images/api.tar.gz` + `images/frontend.tar.gz` alongside the
   compose files.
3. Add an `install.sh` that `docker load`s them.
4. Generate a `docker-compose.release.yml` overlay swapping each service's
   `build:` → `image:` for the pinned tags.
5. The operator then runs `./install.sh` + `docker compose -f ... -f
   docker-compose.release.yml up -d` — no source checkout required.
