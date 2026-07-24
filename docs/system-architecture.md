# System Architecture

> **Audience:** Developers needing to understand request flow, data flow, and subsystem interactions. For "where to find X", see [Codebase Summary](codebase-summary.md).

## High-Level Diagram

```
                    +-------------------+
                    |    Nginx (80)     |
                    |  Reverse Proxy    |
                    +--------+----------+
                             |
               +-------------+-------------+
               |                           |
      +--------+--------+       +--------+--------+
      |   Frontend :7173 |       |  Backend :3090   |
      |   React SPA      |<---->|  Express v5      |
      |   Vite dev serve | API  |  TypeScript      |
      +--------+---------+      +---+-----+--------+
               |                     |     |
               |              +------+------+------+
               |              |      |      |      |
               |         +----+--+ +-+---+ +--+--+ +----+
               |         |Pg :5440| |Redis | | FS | |LLM |
               |         |Postgres| |:6390 | |UP  | |Mini|
               |         +--------+ +------+ +----+ +Max|
               |              |                   +------+
               +-------------+                  (MiniMax-M3 API)
               Static files (Vite build)
```

## Monorepo Structure

Three packages managed by pnpm:

```
tingting/
  shared/     @tingting/shared   Types, Zod schemas, calculations
  backend/    @tingting/backend  Express API + Drizzle ORM
  frontend/   @tingting/frontend React SPA + Vite
  deploy/     nginx + setup
```

Build order matters: `shared` must compile first (backend reads from `shared/dist/`).

## Request Lifecycle (Backend)

```
Client Request
    |
    v
[trust proxy] -- honor X-Forwarded-For from nginx
    |
    v
[CORS] -- origin whitelist from env
    |
    v
[JSON parser] -- express.json()
    |
    v
[Static files] -- serve frontend build (production)
    |
    v
[Request logger] -- Pino (method, path, duration, status)
    |
    v
[Audit middleware] -- auto-log mutations (POST/PUT/PATCH/DELETE)
    |
    v
[Auth middleware] -- JWT verification (extract user + role)
    |                  (skipped for /api/auth/login, /api/health)
    v
[Casbin middleware] -- casbinAuthz(resource) per route
    |
    v
[Route handler] -- business logic via services
    |
    v
[Error handler] -- Zod 400 | ApiError custom | PG 23505 409 | 500
    |
    v
[Serializer] -- convert camelCase to snake_case
    |
    v
Response
```

Source: `backend/src/index.ts` (middleware stack order), `backend/src/middleware/`.

## Data Flow: Trip -> Ledger -> P&L

```
Trip Created (status: CREATED)
    |
    v
Accountant fills data (km, fuel, road allowance)
    |
    v
Trip Completed (status: COMPLETED)
    |
    v
Trip Locked (status: LOCKED)
    |
    +---> Ledger entries created (append-only):
    |      TRIP_REVENUE   -> customer debit  (+revenue)
    |      TRIP_FUEL_COST -> vendor credit   (+fuel cost)
    |      TRIP_ROAD_ALLOW -> driver credit (+road money)
    |      TRIP_INCOME    -> driver credit  (+trip wage)
    |
    v
P&L Report (computed on read)
    |
    +---> Revenue = SUM(TRIP_REVENUE.credit) by period
    +---> Cost = SUM(fuel + road + labor + expenses) by period
    +---> Gross Profit = Revenue - Cost (per truck)
    +---> Net Profit = SUM(Gross) - Mgmt Fee - Company Expenses + Other Income
```

The ledger is the **single source of truth** for all financial balances. Running balance = latest row's `balance` field for any entity.

Services: `trip.service.ts` (lifecycle), `ledger.service.ts` (posting), `reporting.service.ts` (P&L computation).

## RBAC Subsystem

```
Request
  -> authMiddleware (JWT -> user, role)
  -> casbinAuthz(resource)  -- checks policy.csv
     |
     +---> role=ADMIN: wildcard, always pass
     +---> role=MANAGER: trips:read, trips:write, financial:read, ...
     +---> role=ACCOUNTANT: financial:read, financial:write, ...
     +---> role=DRIVER: trips:read (own only), ...
     +---> role=FORWARDER: trips:read (own only), ...
     |
  -> requireRoles([ADMIN, MANAGER])  -- optional tight check
```

HTTP method mapping: GET=read, POST/PUT/PATCH=write, DELETE=delete.

Policy: `backend/src/casbin/policy.csv`. Enforcement: `backend/src/middleware/casbin.ts`.

## Agent / Chatbot Subsystem

```
Frontend Chat Drawer
    |
    v  (socket.io)
AgentSocket (backend/src/agentSocket.ts)
    |
    v
Orchestrator (services/agent/orchestrator.ts)
    |
    +---> MiniMax-M3 LLM API  (prompt + tools)
    |
    +---> Tool Dispatch:
    |      - Semantic data tools (6): trips, ledger, P&L, receivables, etc.
    |      - GPS tools (live tracking via Bach Khoa)
    |      - Config read tools
    |      - Tour engine (curated walkthroughs)
    |      - Navigate + highlight (SPA navigation, element spotlight)
    |
    v
Response Synthesis
    |
    v
Response Normalization + Shared Zod Validation
    |
    v  (socket.io emit)
Frontend renders text/structured cards + executes directives (navigate, highlight, start_tour)
```

Semantic data gateway: `services/agent/semantic-data.service.ts` (11 entity lookups, 6 tool definitions).

Structured `insight_card` responses use the shared contract in `shared/src/schemas/agent.ts`. Before validation, the orchestrator normalizes common model formatting (for example VND/percent strings and chart `label` fields). A card may also carry optional Markdown `details`; analysis appended after the JSON card is preserved there and rendered after the titled widgets, so it augments rather than replaces the structured result.

## Redis Usage

| Purpose | Key Pattern | TTL |
|---------|------------|-----|
| GPS data cache | `gps:vehicle:{id}` | 60s (pull-through from Bach Khoa) |
| GPS session auth | `gps:session:*` | Session-scoped |
| (Reserved) | -- | -- |

Client: `backend/src/lib/redis.ts` (ioredis). No Redis usage in frontend.

## Socket.io

- **Server:** `backend/src/agentSocket.ts` (attached to Express HTTP server)
- **Client:** `frontend/src/lib/agentSocket.ts`
- **Namespace:** default (`/`)
- **Nginx:** requires `location /socket.io/` with `Upgrade` + `Connection: upgrade` headers + 300s timeout
- See [deployment-guide.md](deployment-guide.md) for nginx config details.

## File Storage

- Local disk at `UPLOAD_DIR` env var.
- Multer handles upload; Sharp strips EXIF from images.
- Photo authorization: exact storage-key matching (see [ADR 0042](adr/0042-photo-authz-exact-storagekey.md)).
- Max upload: 15MB; supports HEIC via Sharp conversion.

## Observability

- **Logging:** Pino (structured JSON logs, request logger middleware)
- **Tracing:** OpenTelemetry auto-instrumentation (`backend/src/lib/telemetry.ts`, imported as first line of `index.ts`)
- **Metrics:** Custom `agent_turn_metrics` table for chatbot performance (p95 latency, turn counts)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Yes | Backend port (default 3090) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | JWT signing secret |
| `JWT_EXPIRES_IN` | No | Token expiry (default: 24h) |
| `UPLOAD_DIR` | Yes | File upload directory path |
| `NODE_ENV` | No | `development` / `production` |
| `CORS_ORIGIN` | No | Comma-separated allowed origins |
| `TRUST_PROXY` | No | Proxy hops (default: 1 in prod, false in dev) |
| `GEMINI_API_KEY` | No | Gemini API key for OCR fallback |
| `OPENROUTER_API_KEY` | No | OpenRouter key for OCR primary |
| `MINIMAX_API_KEY` | No | MiniMax API key for chatbot LLM |
| `VAPID_*` | No | Web Push notification keys |

See `backend/.env.example` for the full list.

## Related Documents

| Document | Purpose |
|----------|---------|
| [Architecture Diagrams](architecture-diagrams.md) | Renderable Mermaid v11 diagrams of the flows below |
| [Codebase Summary](codebase-summary.md) | Package-by-package file map |
| [Code Standards](code-standards.md) | Conventions and patterns |
| [Deployment Guide](deployment-guide.md) | Dev/prod/demo environments |
| [Project Overview](project-overview-pdr.md) | Business scope and personas |
| [AGENTS.md](../AGENTS.md) | Architecture tables and key patterns |
