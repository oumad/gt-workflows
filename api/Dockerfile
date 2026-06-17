# ── Dependencies ──────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` over `npm install` because lock-file determinism matters for
# reproducible images. devDependencies are needed by the builder stage
# (tsc, drizzle-kit for generate during dev — NOT for runtime). The prod
# image drops them by re-installing in the runtime stage below.
RUN npm ci

# ── Build the API + (optionally) regenerate migrations ────────
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Compiles TypeScript to dist/. Type errors fail the build.
RUN npm run build

# ── Runtime image — slim, no devDependencies ─────────────────
# Debian (glibc), NOT Alpine: the RDP probe needs FreeRDP **2**, and current
# Alpine only ships FreeRDP 3 — whose reworked security negotiation fails our
# domain hosts (ERRCONNECT_SECURITY_NEGO_CONNECT_FAILED) and whose NLA defaults
# to Kerberos (stalls on "Cannot find KDC", and the NTLM fallback is broken in
# that build too). Debian bookworm packages freerdp2-x11. The runtime re-installs
# deps below (npm ci), so nothing musl-built leaks in from the Alpine
# deps/builder stages — only the pure-JS dist/ is copied across.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# freerdp2-x11 + Xvfb power the admin "RDP In" button on Ask Seto. FreeRDP 2 is
# deliberate (see above): it negotiates cleanly and authenticates NLA with NTLM
# (just the password — no KDC), exactly like the operator's connect.sh. xfreerdp
# drives the session; Xvfb gives it a virtual display so it starts headless. No
# scrot — we don't screenshot. procps for a usable kill on teardown; iputils-ping
# provides `ping` for the tier-1 ICMP host check in serverHealth.ts (NET_RAW is
# in Docker's default cap set; if dropped or ICMP is firewalled, the probe falls
# back to a TCP connect).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       freerdp2-x11 xvfb procps iputils-ping \
    && rm -rf /var/lib/apt/lists/*
# Fail the BUILD if the RDP toolchain didn't land (apt mirror drift, stale
# cache) instead of a cryptic `spawn xfreerdp ENOENT` on the first "RDP In"
# click. FreeRDP 2 installs the client as plain `xfreerdp`.
RUN command -v xfreerdp && command -v Xvfb

# Re-install only production deps. Skips drizzle-kit / tsc / eslint / tsx /
# typescript-eslint etc., which the runtime never touches — the in-process
# migrator uses drizzle-orm (a runtime dep), no CLI needed.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Built JS only — no TypeScript sources in the runtime image.
COPY --from=builder /app/dist ./dist

# Migrations folder. The in-process migrator (src/db/migrate.ts) reads
# .sql files from here at startup, applies pending ones, and records them
# in a __drizzle_migrations table. This folder is generated locally by
# `npm run db:generate` whenever schema.ts changes, then committed.
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 3001
CMD ["node", "dist/index.js"]
