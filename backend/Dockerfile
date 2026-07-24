# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

ARG NODE_OPTIONS=--max-old-space-size=768
ENV NODE_OPTIONS=${NODE_OPTIONS}

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy manifests first — pnpm install layer is cached until lock file changes
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json

# Install ALL dependencies (including devDependencies for tsc)
RUN pnpm install --frozen-lockfile

# Copy source after install — code changes don't bust the install cache
COPY tsconfig.base.json tsconfig.base.json
COPY shared/tsconfig.json shared/tsconfig.json
COPY shared/src shared/src
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src
COPY backend/fix-esm-imports.js backend/fix-esm-imports.js
COPY shared/fix-esm-imports.js shared/fix-esm-imports.js
COPY backend/drizzle backend/drizzle
COPY backend/drizzle.config.ts backend/drizzle.config.ts

# Compile TypeScript — fails fast if type errors exist
# Then rewrite bare imports for Node.js ESM compatibility
RUN pnpm --filter @tingting/shared build && pnpm --filter backend build

# ── Production ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy only manifests — install production deps only
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json

RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/shared/dist shared/dist
COPY --from=builder /app/backend/dist backend/dist
# Copy static files that tsc doesn't emit
COPY backend/src/casbin/model.conf backend/dist/casbin/model.conf
COPY backend/src/casbin/policy.csv backend/dist/casbin/policy.csv
COPY backend/drizzle backend/drizzle
COPY backend/drizzle.config.ts backend/drizzle.config.ts

# Create uploads directory
RUN mkdir -p /app/backend/uploads

WORKDIR /app/backend

ENV NODE_ENV=production
EXPOSE 3090

CMD ["node", "dist/index.js"]
