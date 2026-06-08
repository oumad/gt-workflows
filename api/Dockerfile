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

# ── Runtime image — slim, no devDependencies, no toolchain ────
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

# freerdp + Xvfb power the admin "RDP In" button on Ask Seto. xfreerdp drives
# the actual session; Xvfb provides a virtual X display so xfreerdp doesn't
# refuse to start in this headless container. No scrot — we don't screenshot.
# Alpine package name is plain `xvfb` in 3.19+; older `xorg-server-xvfb` is gone.
# `--no-cache` keeps the image lean (~70MB total for these). procps gives us a
# usable `kill` for clean teardown.
RUN apk add --no-cache freerdp xvfb procps

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
