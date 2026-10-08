ARG BUILDPLATFORM
# ── Stage 1: Build TS natively on the host architecture (no QEMU emulation) ───
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

ARG NODE_OPTIONS=--max-old-space-size=4096
ENV NODE_OPTIONS=${NODE_OPTIONS}
# Puppeteer belongs to root-level visual QA tooling, not the backend build.
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy manifests first — pnpm install layer is cached until lock file changes
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json

# Resolve the backend and its transitive workspace dependencies natively.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    --mount=type=cache,target=/tmp/pnpm-verify,id=pnpm-verify \
    pnpm install --frozen-lockfile --filter @tingting/backend...

# Copy source after install — code changes don't bust the install cache
COPY tsconfig.base.json tsconfig.base.json
COPY shared/tsconfig.json shared/tsconfig.json
COPY shared/src shared/src
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/tsconfig.build.json backend/tsconfig.build.json
COPY backend/src backend/src
COPY backend/fix-esm-imports.js backend/fix-esm-imports.js
COPY shared/fix-esm-imports.js shared/fix-esm-imports.js

# Compile TypeScript natively with incremental caching and failure guard
RUN --mount=type=cache,target=/tmp/.tscache,id=backend-tsbuild \
    mkdir -p /tmp/.tscache/backend-tsbuildinfo /tmp/.tscache/backend-dist backend/dist && \
    cp -a /tmp/.tscache/backend-dist/. backend/dist/ && \
    ( pnpm --filter @tingting/shared build && pnpm --filter @tingting/backend build && \
      rm -rf /tmp/.tscache/backend-dist && mkdir -p /tmp/.tscache/backend-dist && \
      cp -a backend/dist/. /tmp/.tscache/backend-dist/ ) || \
    ( rm -rf /tmp/.tscache/backend-tsbuildinfo /tmp/.tscache/backend-dist && exit 1 )

# ── Stage 2: Production runtime (linux/amd64) ─────────────────────────────────
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json

# Copy compiled shared dist from builder so workspace package injection succeeds
COPY --from=builder /app/shared/dist shared/dist

# Deploy production dependencies for target platform (linux/amd64) directly into /prod/backend
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm --config.inject-workspace-packages=true \
        --filter @tingting/backend \
        --prod deploy /prod/backend

WORKDIR /prod/backend

# Copy compiled backend dist from builder
COPY --from=builder /app/backend/dist dist
# Copy static files that tsc doesn't emit
COPY backend/src/casbin/model.conf dist/casbin/model.conf
COPY backend/src/casbin/policy.csv dist/casbin/policy.csv
# Drizzle migrate reads only migration SQL plus meta/_journal.json. Generation
# snapshots are development artifacts and do not belong in the runtime image.
COPY backend/drizzle/*.sql drizzle/
COPY backend/drizzle/meta/_journal.json drizzle/meta/_journal.json
COPY backend/drizzle.config.ts drizzle.config.ts
COPY frontend/public/fonts/BeVietnamPro-Regular.ttf dist/assets/BeVietnamPro-Regular.ttf
COPY frontend/public/fonts/BeVietnamPro-SemiBold.ttf dist/assets/BeVietnamPro-SemiBold.ttf

# Create uploads directory and symlink /app/backend -> /prod/backend for compose compatibility
RUN mkdir -p uploads && rm -rf /app/backend && ln -s /prod/backend /app/backend

WORKDIR /app/backend

ENV NODE_ENV=production
EXPOSE 3090

CMD ["node", "dist/index.js"]
