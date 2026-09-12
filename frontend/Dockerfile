# ── Stage 1: Build ────────────────────────────────────────────────────────────
# $BUILDPLATFORM keeps the toolchain native when cross-building for the amd64
# servers from an arm64 Mac: node/tsc/vite run without emulation. Go-based
# esbuild crashes under amd64 emulation (Go runtime `lfstack.push` fault, seen
# 2026-09-12), so emulating this stage is not an option. The dist output is
# architecture-independent JS/CSS, so the native-built artifacts stay valid
# for the amd64 nginx runtime stage below.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

ARG NODE_OPTIONS=--max-old-space-size=8192
ENV NODE_OPTIONS=${NODE_OPTIONS}
# Root-level Puppeteer is for local visual QA; Vite does not require Chromium.
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy only manifests first — pnpm install layer is cached until lock file changes
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json shared/package.json
COPY frontend/package.json frontend/package.json

# Resolve frontend + transitive workspace dependencies. The shared root store
# exists only in this disposable builder; Chromium download is disabled and no
# Node workspace is copied into the nginx runtime image.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    --mount=type=cache,target=/tmp/pnpm-verify,id=pnpm-verify-frontend \
    pnpm install --frozen-lockfile --filter @tingting/frontend...

# Copy source after install — code changes don't bust the install cache
COPY tsconfig.base.json tsconfig.base.json
COPY shared/tsconfig.json shared/tsconfig.json
COPY shared/src shared/src
COPY shared/fix-esm-imports.js shared/fix-esm-imports.js

# Build shared first (Vite resolves @tingting/shared via alias to ../shared/src)
RUN --mount=type=cache,target=/tmp/.tscache-frontend,id=shared-tsbuild-frontend \
    cd shared && pnpm build

# Copy frontend source
COPY frontend/index.html frontend/index.html
COPY frontend/vite.config.ts frontend/vite.config.ts
COPY frontend/tsconfig.json frontend/tsconfig.json
COPY frontend/public frontend/public
COPY frontend/src frontend/src

# Build frontend (vite build → frontend/dist)
# pnpm build = vite build only (type-check runs in CI via build:check)
RUN --mount=type=cache,target=/tmp/.vite-cache,id=frontend-vite \
    --mount=type=cache,target=/app/frontend/node_modules/.cache,id=frontend-nm-cache \
    cd frontend && NODE_OPTIONS="--max-old-space-size=8192" pnpm build

# ── Stage 2: Serve ───────────────────────────────────────────────────────────
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
