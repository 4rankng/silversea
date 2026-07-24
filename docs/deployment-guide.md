# Deployment Guide

> **Audience:** Developers deploying TingTing to dev, production, or demo environments.

## Environments

| Environment | Domain | Path | CI/CD |
|-------------|--------|------|-------|
| **Local dev** | `localhost` | Local machine | Manual (`make dev`) |
| **Production** | `nepo.tingting.vip` | `/opt/nepocorp/` | GitHub Actions (auto-deploy on main push) |
| **Demo** | `vantai.tingting.vip` | `/opt/vantai/` | GitHub Actions matrix (same pipeline, same trigger) |

All three environments use Docker containers for backend and frontend, with PostgreSQL and Redis.

## Local Development

### Prerequisites

- pnpm 10.x
- Docker (for PostgreSQL and Redis containers)
- Node.js 20+

### First-Time Setup

```bash
pnpm install
make setup    # Starts infra (Postgres :5440, Redis :6390)
              # Generates Drizzle migrations
              # Applies migrations
              # Seeds sample data
```

Default dev login: `admin` / `admin123`

### Running

```bash
make dev      # Starts backend (:3090) + frontend (:7173) in parallel
              # Auto-generates and applies migrations on startup
```

Frontend dev server at `:7173` proxies `/api` requests to `http://localhost:3090`.

### Individual Services

```bash
make infra          # Start only Postgres + Redis
cd backend && pnpm dev    # Backend only (tsx watch, port 3090)
cd frontend && npx vite --port 7173  # Frontend only
```

### Database Tools

```bash
make studio         # Drizzle Studio GUI (database browser)
make migrate        # Apply pending migrations
make generate       # Generate migration from schema changes
make seed           # Seed sample data
make backup         # Dump production DB to OneDrive
make restore        # Restore latest backup to local dev DB
```

### Production DB Admin

```bash
make adminer       # Opens Adminer over private SSH tunnel -> localhost:8082
                    # Server: postgres | DB: nepocorp | User: nepocorp
                    # Never publicly exposed (loopback-only container)
```

## Production Deployment

### Overview

Production uses Docker containers deployed on a single DigitalOcean droplet at `nepo.tingting.vip`.

- **Postgres** user: `nepocorp`, database: `nepocorp`
- **Docker images:** `tingting-backend`, `tingting-frontend` (Docker Hub)
- **Reverse proxy:** Nginx on the host, configured via `deploy/nginx-host.conf`

### Normal Deploy (GitHub Actions)

On push to `main`, GitHub Actions automatically:

1. Builds Docker images for backend and frontend
2. Pushes to Docker Hub (`tingting-backend`, `tingting-frontend`)
3. SSHs to droplet, pulls images, restarts containers
4. Runs Drizzle migrations

### Manual Deploy (when CI is blocked)

If GitHub Actions is billing-blocked (happened ~2026-06-16), use:

```bash
make deploy         # Builds + pushes images + deploys to prod
                    # Equivalent to: make push && make deploy-backend && make deploy-frontend
```

Or step by step:

```bash
make push-backend   # Build & push backend image to Docker Hub
make push-frontend  # Build & push frontend image to Docker Hub
# Then SSH to deploy:
make deploy-backend # Pull & restart backend + run migrations
make deploy-frontend # Pull & restart frontend
```

### Applying Migrations to Production

```bash
# Apply ALL pending SQL migrations:
make prod-migrate

# Apply a SINGLE migration file:
make prod-migrate-file FILE=0085_your_migration.sql
```

This SCPs the SQL file into the Postgres container and runs it in a single transaction.

### Verification After Deploy

1. SSH into server: `ssh root@nepo.tingting.vip`
2. Check container health: `docker ps`
3. Check backend logs: `docker logs nepocorp-backend-1 --tail 50`
4. Check frontend: `curl -s -o /dev/null -w "%{http_code}" https://nepo.tingting.vip`
5. Check API health: `curl -s https://nepo.tingting.vip/api/health`

## Demo Deployment

The demo server (`vantai.tingting.vip`) uses the same Docker Hub images but deploys to `/opt/vantai/` with its own database.

```bash
make demo           # Build + push + deploy backend + frontend to vantai
```

### Demo Details

| Property | Value |
|----------|-------|
| Domain | `vantai.tingting.vip` |
| Path | `/opt/vantai/` |
| DB user | `vantai` (not `postgres`) |
| DB container | `vantai-postgres-1` |
| Seed data | `deploy/seed-vantai.sql` (30 trips, 10 customers, 12 routes) |
| Users | 9 accounts: admin, giamdoc, ketoan, laixe, giaonhan, thu, nam, tuan, duc |
| Password | `123456` (all accounts) |
| Nginx config | `deploy/nginx-host-vantai.conf` |

## Nginx Configuration

### Required Blocks

```nginx
# Frontend (SPA)
location / {
    proxy_pass http://localhost:7173;  # or Docker internal port
}

# API
location /api/ {
    proxy_pass http://backend:3090;    # or localhost:3090
}

# Socket.io (REQUIRED for agent chatbot)
location /socket.io/ {
    proxy_pass http://backend:3090;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
}
```

The socket.io block was missing from the vantai server initially (see memory: `socketio-nginx-routing-vantai.md`). Without it, `/socket.io/` returns the SPA HTML and the chatbot cannot connect.

Production nginx config: `deploy/nginx-host.conf`. Demo: `deploy/nginx-host-vantai.conf`.

## Drizzle Migration Behavior

### How It Works

Drizzle-kit uses a **journal-based** migration system:

1. Each migration has a SQL file in `backend/drizzle/*.sql`
2. A `__drizzle_migrations` journal table tracks applied migrations via `created_at` timestamps
3. The migrator decides pending by: `journal.when >= max(created_at)` (inclusive)

### Common Gotchas

**Journal desync:** If the journal's `when` timestamp is non-monotonic or future-dated, migrations silently skip. This can happen when migrations are manually edited or restored from backup.

**Diagnostic:** Compare `SELECT * FROM __drizzle_migrations ORDER BY created_at;` with `ls backend/drizzle/*.sql`.

**Fix pattern:** Delete the newest journal row, ensure migration SQL is idempotent, re-apply in a single transaction. See memory: `drizzle-migrate-timestamp-not-hash.md` for the full diagnostic recipe.

**Idempotent migrations:** Always write migration SQL with `IF NOT EXISTS` / `IF EXISTS` guards. `ALTER TYPE ADD VALUE` is NOT idempotent (Postgres limitation).

## Docker Images

| Image | Source | Registry |
|-------|--------|----------|
| `tingting-backend` | `backend/Dockerfile` | Docker Hub |
| `tingting-frontend` | `frontend/Dockerfile` | Docker Hub |
| `postgres` | Official image | Docker Hub |
| `redis` | Official image | Docker Hub |

Build targets: `make push-backend` (backend/Makefile), `make push-frontend` (frontend/Makefile).

## Build Order

```
shared (tsc) -> backend (tsc) -> frontend (vite build)
```

Backend reads shared from `shared/dist/`. Frontend reads shared from `shared/src/`. This asymmetry matters: after editing shared, rebuild it before backend tests or Docker build.

```bash
make build         # Builds all three in correct order
```

## Environment Variables

See `backend/.env.example` for the full list. Key variables:

| Variable | Dev | Production | Description |
|----------|-----|------------|-------------|
| `PORT` | 3090 | 3090 | Backend port |
| `DATABASE_URL` | `postgres://postgres@localhost:5440/tingting` | Set via deploy `.env` | Postgres connection |
| `JWT_SECRET` | Any string | Strong random string | Token signing |
| `JWT_EXPIRES_IN` | `24h` | `24h` | Token expiry |
| `UPLOAD_DIR` | `./uploads` | Container-mounted path | File storage |
| `NODE_ENV` | `development` | `production` | Environment |
| `CORS_ORIGIN` | `http://localhost:7173` | `https://nepo.tingting.vip` | Allowed origins |
| `TRUST_PROXY` | `false` | `1` | Proxy trust (for X-Forwarded-For) |

## Related Documents

| Document | Purpose |
|----------|---------|
| [System Architecture](system-architecture.md) | Component diagram, request lifecycle |
| [Codebase Summary](codebase-summary.md) | Repository structure |
| [Code Standards](code-standards.md) | Build and test commands |
