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
| `postgres-rdp.yml`| postgres + rdp-sidecar only                          | API runs natively (Windows + UNC share); this provides just Postgres + Linux RDP.       |

## RDP execution

The API has two RDP modes, toggled by `RDP_BRIDGE_URL`:

- **Embedded** (`RDP_BRIDGE_URL` unset, default in `prod.yml` / `dev.yml` /
  `standalone.yml`): the api image bundles `freerdp` + `Xvfb` and spawns them
  itself.
- **Sidecar** (`RDP_BRIDGE_URL` set): the api forwards `/api/servers/:id/rdp`
  to the rdp-sidecar container over HTTP. Used by `postgres-rdp.yml`. To add
  the sidecar to `prod.yml` or `standalone.yml`, copy the `rdp-sidecar`
  service block from `postgres-rdp.yml` and set:
  ```env
  RDP_BRIDGE_URL=http://rdp-sidecar:8080
  RDP_BRIDGE_TOKEN=<openssl rand -hex 32>
  ```
  in your `.env` (the api and sidecar must share the token).

See `rdp-sidecar/README.md` for the wire contract and security notes.

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
| `RDP_BRIDGE_URL` / `RDP_BRIDGE_TOKEN`  | empty (embedded mode)            |
| `BRIDGE_BIND` (postgres-rdp.yml)       | `127.0.0.1`                      |
| `POSTGRES_BIND` (postgres-rdp.yml)     | `127.0.0.1`                      |
