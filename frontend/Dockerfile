# Simple two-stage frontend image.
#
# Stage 1 — build the SPA with Vite.
# Stage 2 — serve the built dist with nginx, reverse-proxying /api/*.
#
# Trade-offs (deliberate):
#   - `npm install`, not `npm ci`. Tolerates a slightly stale lockfile
#     instead of failing the build. The lockfile is still committed and
#     used; just not enforced as a hard precondition. Strict lockfile
#     enforcement happens in CI (.github/workflows/dev.yml runs `npm ci`).
#   - `vite build` only, no separate `tsc -b` typecheck. Vite uses esbuild
#     to transpile; type errors surface in dev + CI, not at image build
#     time. Keeps the image build short and avoids tsconfig project-
#     reference resolution drama.
#   - Multi-target so docker-compose.dev.yml can build the `dev` target
#     (vite dev server with HMR) and prod compose builds the default
#     `prod` target.

# ─── Build ──────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npx vite build

# ─── Dev target ─────────────────────────────────────────────────
# Used by docker-compose.dev.yml. Vite dev server with HMR.
# --host 0.0.0.0 so the docker-mapped port reaches it.
FROM node:24-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npx", "vite", "--host", "0.0.0.0"]

# ─── Prod target ────────────────────────────────────────────────
# Default target. nginx serves the built /app/dist and proxies /api/*.
FROM nginx:alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
