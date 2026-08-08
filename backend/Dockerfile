# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

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

# Resolve the backend and its transitive workspace dependencies. pnpm still
# materializes the shared root store in this disposable stage, but Chromium
# download is disabled above and the runtime is assembled from `pnpm deploy`.
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

# Compile TypeScript — fails fast if type errors exist
# Then rewrite bare imports for Node.js ESM compatibility
RUN --mount=type=cache,target=/tmp/.tscache,id=backend-tsbuild \
    pnpm --filter @tingting/shared build && pnpm --filter backend build

# Produce a self-contained production dependency tree for the backend package.
# This excludes root-only QA tooling even though the monorepo shares a lockfile.
RUN pnpm --config.inject-workspace-packages=true \
    --filter @tingting/backend \
    --prod deploy /prod/backend

# ── Production ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Copy the pruned backend package and its injected workspace dependencies.
COPY --from=builder /prod/backend/node_modules backend/node_modules
COPY --from=builder /prod/backend/package.json backend/package.json
COPY --from=builder /app/backend/dist backend/dist
# Copy static files that tsc doesn't emit
COPY backend/src/casbin/model.conf backend/dist/casbin/model.conf
COPY backend/src/casbin/policy.csv backend/dist/casbin/policy.csv
# Drizzle migrate reads only migration SQL plus meta/_journal.json. Generation
# snapshots are development artifacts and do not belong in the runtime image.
COPY backend/drizzle/*.sql backend/drizzle/
COPY backend/drizzle/meta/_journal.json backend/drizzle/meta/_journal.json
COPY backend/drizzle.config.ts backend/drizzle.config.ts
COPY frontend/public/fonts/BeVietnamPro-Regular.ttf backend/dist/assets/BeVietnamPro-Regular.ttf
COPY frontend/public/fonts/BeVietnamPro-SemiBold.ttf backend/dist/assets/BeVietnamPro-SemiBold.ttf

# Create uploads directory
RUN mkdir -p /app/backend/uploads

WORKDIR /app/backend

ENV NODE_ENV=production
EXPOSE 3090

CMD ["node", "dist/index.js"]
