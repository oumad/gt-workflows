# Docker Compose templates

All compose variants live in this folder. Pick the one that fits your
deployment, then **run it from the repo root** with `--project-directory .`
so relative paths (`./api`, `./redis`, `.env`) resolve correctly:

```bash
docker compose -f docker-compose-templates/<file>.yml --project-directory . up -d --build
```

## Templates

| File              | Stack                                                | When to use                                                                             |
|-------------------|------------------------------------------------------|-----------------------------------------------------------------------------------------|
| `prod.yml`        | postgres + redis + api + frontend                    | Default production deploy. Frontend nginx is the only ingress; api is internal-only.    |
| `dev.yml`         | postgres + redis + api + frontend + test-server      | Local development with HMR + the throwaway nginx test-server for alert-cycle testing.   |
| `standalone.yml`  | postgres + api + frontend (external Redis)           | Production-ish deploy where Redis is owned by another stack (e.g. real gt-workflows).   |
| `postgres.yml`    | postgres only                                        | API runs natively (Windows + UNC share); this provides just the database.               |

## RDP execution

RDP credential testing (the "RDP In" button) uses the `freerdp` + `Xvfb`
toolchain the api image bundles, spawned inside the api container. There is no
separate service to run. It is therefore only available when the api runs in
its Docker image — a natively-run Windows api can't use it (the toolchain is
Linux-only).

## Env vars

All templates read from `.env` at the **repo root** (so a single `.env` works
across templates). The `${VAR:?...}` form fails fast when a required var is
missing; the `${VAR:-default}` form supplies a sensible default for the rest.

| Required in prod / standalone     | Purpose                                                |
|-----------------------------------|--------------------------------------------------------|
| `JWT_SECRET`                      | API token signing key.                                 |
| `CREDENTIALS_MASTER_KEY`          | AES key for stored RDP credentials.                    |
| `REDIS_URL` (`standalone.yml` only)| External Redis to read job state from.                |

| Optional, tunable in `.env`            | Default                          |
|----------------------------------------|----------------------------------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD`  | `postgres` / `devpassword`       |
| `FRONTEND_PORT`                        | `80`                             |
| `WORKFLOWS_DIR`                        | `./workflows`                    |
| `CORS_ORIGIN`                          | `*` (prod) / `http://localhost:5173` (dev) |
| `DISCORD_WEBHOOK_URL`                  | empty (no alerts)                |
| `MONITOR_INTERVAL_MS` / `MONITOR_TIMEOUT_MS` / `MONITOR_STAGGER_MS` | `30000` / `5000` / `1000` |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | empty (direct)                |
| `POSTGRES_BIND` (postgres.yml)         | `127.0.0.1`                      |
