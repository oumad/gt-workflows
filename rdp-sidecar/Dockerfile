# ─── rdp-sidecar ────────────────────────────────────────────────
# Tiny HTTP bridge around xfreerdp + Xvfb. Lets the API run RDP credential
# tests via HTTP instead of spawning the binaries in its own image — useful
# when the API runs natively on Windows, or you just want a slimmer API image.
#
# Final image size: ~100 MB (freerdp + its deps are the bulk; the Go binary
# itself is ~6 MB statically linked).

# ── Build stage ─────────────────────────────────────────────────
# Pinning the toolchain version keeps the image reproducible. The bridge
# uses stdlib only — no module downloads, fast cold builds.
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
# Static binary so it runs in the minimal alpine final stage without libc
# version friction. -s -w strips debug info for a smaller binary. The output
# path is a sibling file inside /src — `go build -o` doesn't create dirs.
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o rdp-bridge .

# ── Runtime stage ───────────────────────────────────────────────
FROM alpine:3.20
# freerdp provides xfreerdp; xvfb provides the virtual X display the binary
# needs to start. procps gives us a usable `kill` for shutdown.
# Pinning is loose by design — security fixes from alpine roll forward.
RUN apk add --no-cache freerdp xvfb procps
COPY --from=build /src/rdp-bridge /usr/local/bin/rdp-bridge

# Run as a non-root user. xfreerdp and Xvfb don't need root, and the bridge
# itself binds to a non-privileged port. A compromised container is then
# only as dangerous as the unprivileged user inside it.
RUN adduser -D -H -u 10001 bridge
USER bridge

EXPOSE 8080
ENV PORT=8080
# RDP_BRIDGE_TOKEN should be set at runtime via compose env_file or -e flag.
# When unset the bridge logs a warning and runs unauthenticated — only OK
# on a fully-private network.
CMD ["/usr/local/bin/rdp-bridge"]
