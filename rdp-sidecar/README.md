# rdp-sidecar

A tiny HTTP bridge around `xfreerdp` + `Xvfb`. Lets the API delegate RDP
credential tests to a dedicated container instead of bundling the Linux-only
RDP toolchain into its own image.

## When to use it

- The API runs natively on Windows (e.g. to read a UNC workflow share without
  mounting it) but you still want the "RDP In" feature, which needs Linux
  binaries.
- You want a slimmer API image — moving freerdp out shaves ~80 MB.
- You want RDP capability isolated in its own container with its own attack
  surface.

When you don't need any of that, keep the embedded mode (`RDP_BRIDGE_URL`
unset on the API) — it's one fewer moving part and the API image already
includes the binaries.

## Wire contract

`POST /rdp` with JSON:

```json
{
  "host": "worker-03",
  "username": "admin",
  "domain": "CORP",
  "password": "...",
  "holdSeconds": 15
}
```

Headers: `Authorization: Bearer <RDP_BRIDGE_TOKEN>` when the env var is set on
the sidecar.

Response:

```json
{
  "ok": true,
  "exitCode": null,
  "signal": "SIGTERM",
  "durationMs": 15400,
  "stderrTail": "..."
}
```

`signal` is the symbolic name (`SIGTERM` / `SIGKILL` / etc.) — matches the
shape the API's embedded mode returns, so callers don't care which path served
the request.

`GET /healthz` returns plain-text `ok` for container healthchecks.

## Security

The bridge will RDP to **any host with any credentials** it receives. Two
hardening layers:

1. **Bind to localhost (default)** — the compose template maps
   `127.0.0.1:8080:8080`. Override only if you know the network is private.
2. **Shared secret** — set `RDP_BRIDGE_TOKEN` to a long random value; the API
   sends it as `Authorization: Bearer …`. When unset, the sidecar logs a
   warning and accepts unauthenticated requests.

Generate a token:
```bash
openssl rand -hex 32
```

## Configuration

| Env var             | Default | Purpose                                                  |
|---------------------|---------|----------------------------------------------------------|
| `PORT`              | `8080`  | TCP port to listen on inside the container.              |
| `RDP_BRIDGE_TOKEN`  | empty   | If set, required as `Authorization: Bearer <token>`.     |

## Run

Bundled into `docker-compose-templates/postgres-rdp.yml` for the
natively-running-API scenario. To add it alongside the full stack
(`prod.yml`), copy the `rdp-sidecar` service block from `postgres-rdp.yml` and
set `RDP_BRIDGE_URL=http://rdp-sidecar:8080` on the `api` service.

Standalone smoke test (no compose):
```bash
docker build -t rdp-sidecar ./rdp-sidecar
docker run --rm -p 127.0.0.1:8080:8080 -e RDP_BRIDGE_TOKEN=secret rdp-sidecar
curl -s -XPOST http://localhost:8080/rdp \
  -H 'Authorization: Bearer secret' -H 'Content-Type: application/json' \
  -d '{"host":"worker-03","username":"admin","password":"...","holdSeconds":5}'
```

## Implementation notes

- **Stdlib only** — no `go.mod` deps, fast cold builds, ~6 MB static binary.
- **Display allocation** — atomic counter from `:100` to `:999`, mirroring the
  API's embedded mode.
- **xfreerdp behavior** — same flags as the API's embedded mode
  (`/cert:ignore`, `/log-level:WARN`, `+clipboard`, no wallpaper/themes). The
  `holdSeconds` window is capped at 120s server-side.
- **Non-root** — runs as UID 10001. xfreerdp and Xvfb don't need root.
