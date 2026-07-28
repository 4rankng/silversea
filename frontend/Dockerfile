# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

ARG NODE_OPTIONS=--max-old-space-size=2048
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
RUN pnpm install --frozen-lockfile --filter @tingting/frontend...

# Copy source after install — code changes don't bust the install cache
COPY tsconfig.base.json tsconfig.base.json
COPY shared/tsconfig.json shared/tsconfig.json
COPY shared/src shared/src
COPY shared/fix-esm-imports.js shared/fix-esm-imports.js

# Build shared first (Vite resolves @tingting/shared via alias to ../shared/src)
RUN cd shared && pnpm build

# Copy frontend source
COPY frontend/index.html frontend/index.html
COPY frontend/vite.config.ts frontend/vite.config.ts
COPY frontend/tsconfig.json frontend/tsconfig.json
COPY frontend/public frontend/public
COPY frontend/src frontend/src

# Build frontend (vite build → frontend/dist)
RUN cd frontend && pnpm build

# ── Stage 2: Serve ───────────────────────────────────────────────────────────
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
