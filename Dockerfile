# =============================================================================
# RC Tractoparts — Quotation Management System
# Multi-stage Dockerfile for the Node.js 20 + Express + MySQL application
#
# Detected stack:
#   • Runtime     : Node.js >= 18 (image pinned to Node 20 LTS Alpine)
#   • Framework   : Express 4 (REST API + static vanilla-JS SPA)
#   • Database    : MySQL 8 (mysql2 driver) — provided as a separate service
#   • Entry point : src/server.js  (listens on $PORT, default 3000)
#
# Design goals:
#   • Small final image (Alpine base, production-only dependencies)
#   • Reproducible installs (npm ci against the committed lockfile)
#   • Non-root runtime user (principle of least privilege)
#   • Built-in HEALTHCHECK hitting the app's /health endpoint
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — deps: install ONLY production dependencies against the lockfile
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Copy only the manifests first so this layer is cached unless deps change.
COPY package.json package-lock.json* ./

# npm ci gives a clean, reproducible, lockfile-exact install.
# --omit=dev keeps devDependencies (jest, eslint, nodemon, supertest) out of prod.
RUN npm ci --omit=dev

# -----------------------------------------------------------------------------
# Stage 2 — runner: minimal production image
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

# wget is used by the container HEALTHCHECK below (Alpine ships BusyBox wget).
# dumb-init provides correct PID 1 signal forwarding for graceful shutdown.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Bring in the already-installed production node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy the application source. .dockerignore keeps tests, envs and local
# runtime artifacts (uploads/, storage/, node_modules) out of the image.
COPY package.json package-lock.json* ./
COPY src ./src
COPY public ./public
COPY sql ./sql
COPY scripts ./scripts

# Create the runtime file-storage directories and hand ownership to the
# non-root "node" user that ships with the official image. These paths are
# mounted as named volumes in docker-compose for persistence.
RUN mkdir -p uploads/cotizaciones storage/excels \
    && chown -R node:node /app

# Drop root privileges for the running process.
USER node

EXPOSE 3000

# Container-level health probe — mirrors the app's GET /health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/health" || exit 1

# dumb-init forwards SIGTERM/SIGINT to Node so server.js can drain the MySQL
# pool and close the HTTP server gracefully (see src/server.js).
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
