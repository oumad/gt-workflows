# ── Frontend image — multi-stage, two final targets ─────────────
#
# Targets:
#   deps     → npm ci into /app/node_modules (shared by build + dev)
#   builder  → npm run build → /app/dist (used only by `prod` target)
#   dev      → final image for docker-compose.dev.yml — runs Vite with
#              --host 0.0.0.0 so the compose port mapping reaches it. HMR
#              works because the dev compose mounts ./frontend/src over
#              the image's copy, so file edits land inside the container.
#   prod     → final image for docker-compose.yml — nginx:alpine serving
#              the built /app/dist as static files plus reverse-proxying
#              /api/* to the api service. Single ingress port; the api
#              container doesn't need to be exposed externally.
#
# Build:
#   docker build --target dev  -t cm-frontend:dev  frontend
#   docker build --target prod -t cm-frontend:prod frontend
#
# docker compose picks the right one via `target:` in its build block.

# ── Dependencies (shared between dev + build) ──────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` over `npm install` because lock-file determinism matters for
# reproducible images. `--include=dev` so we get tsc + vite + plugins;
# they're stripped from the prod image anyway by the later stage swap.
RUN npm ci --include=dev

# ── Builder (produces /app/dist, used by `prod` only) ──────────
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build` runs `tsc -b && vite build`. The tsc pass catches type
# errors at build time so a typo can't ship to prod.
RUN npm run build

# ── Dev target — Vite dev server with HMR ──────────────────────
FROM node:24-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Copy source so a `docker compose up` with no volume mount still has a
# valid initial state. The dev compose overlays ./frontend/src on top of
# /app/src so live edits work — the COPY here is only for cold start.
COPY . .
EXPOSE 5173
# --host 0.0.0.0 binds to every interface (necessary for the compose port
# mapping to reach Vite). Without it Vite defaults to localhost-only and
# the dev port from the host stays mysteriously empty.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ── Prod target — nginx serving static dist + /api proxy ───────
FROM nginx:alpine AS prod
# Custom config replaces nginx's default; it sets up SPA fallback,
# /api → api:3001 reverse proxy, and SSE-friendly buffering settings
# for the workflow-test streaming endpoint.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
# `daemon off` keeps nginx in the foreground so docker can supervise it.
CMD ["nginx", "-g", "daemon off;"]
