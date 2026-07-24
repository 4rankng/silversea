# TransTing

TransTing is the fleet management platform operated by Cong ty TNHH NEPO, a Vietnamese container-trucking company. It replaces 7+ Excel files and 300+ sheets with a unified web app managing trips, drivers, customers, fleet, and financials (ledger, P&L, debt tracking, profit distribution).

Built with **Express v5**, **React 18**, **Drizzle ORM**, and **PostgreSQL**. Vietnamese-language UI and audit logs; VND currency throughout.

## Quick Start

```bash
# Prerequisites: pnpm 10.x, Docker (for Postgres + Redis), ImageMagick 7
pnpm install
make setup        # Infra + generate migrations + migrate + seed
make dev          # Backend :3090 + Frontend :7173 (auto-migrates)
```

Open [http://localhost:7173](http://localhost:7173) and log in with `admin` / `admin123`.

## Monorepo Layout

```
backend/     Express v5 + TypeScript API   (port 3090, 179 files)
frontend/    React 18 + Vite + TypeScript  (port 7173, 302 files)
shared/      Types, schemas, calculations   (24 files -- @tingting/shared)
deploy/      nginx, setup scripts
docs/        Specs, flows, ADRs, plans
```

## Ports

| Service     | Port |
|-------------|------|
| Frontend    | 7173 |
| Backend     | 3090 |
| PostgreSQL  | 5440 |
| Redis       | 6390 |

## Key Make Targets

| Target            | Description                                  |
|-------------------|----------------------------------------------|
| `make dev`        | Start everything (db, redis, backend, frontend) |
| `make setup`      | First-time setup (infra + migrate + seed)    |
| `make build`      | Build shared + backend + frontend            |
| `make seed`       | Seed database with sample data                |
| `make push`       | Build & push Docker images to Docker Hub      |
| `make deploy`     | Deploy to production (`nepo.tingting.vip`)     |
| `make demo`       | Deploy to demo (`vantai.tingting.vip`)        |
| `make prod-migrate` | Apply all SQL migrations to production DB   |
| `make backup`     | Dump production DB to local OneDrive          |
| `make restore`    | Restore latest backup to local dev DB         |

## Documentation

### Project Docs (this repo)

| Document | Description |
|----------|-------------|
| [Product Overview & PDR](docs/project-overview-pdr.md) | Executive summary, personas, module map |
| [Codebase Summary](docs/codebase-summary.md) | Repository map, key entry points, "where to find X" index |
| [Code Standards](docs/code-standards.md) | TypeScript conventions, naming, testing, commit format |
| [System Architecture](docs/system-architecture.md) | Request lifecycle, data flow, component diagram |
| [Deployment Guide](docs/deployment-guide.md) | Dev, production, demo environments; Docker; CI/CD |
| [Project Roadmap](docs/project-roadmap.md) | Completed features, in-progress, deferred items |
| [Design Guidelines](docs/design-guidelines.md) | Frontend visual system, component conventions |

### Authoritative Sources

| Document | Description |
|----------|-------------|
| `PRODUCT-SPECS.md` | Full business rules, 11 modules, 24 config tables, trip data fields |
| `CONTEXT.md` | Domain glossary and business rules (authoritative for terminology) |
| `AGENTS.md` | Architecture tables, commands, key patterns |
| `docs/flows/` | 16 Vietnamese user-manual/QA docs (00-OVERVIEW through 15-TIRES) |
| `docs/adr/` | Architecture Decision Records |
| `docs/plans/` | Feature/refactor plans (~22 files) |
| `docs/company-files/` | Original Vietnamese business documents (fuel norms, allowances, vehicle data) |

## Tech Stack

- **Backend:** Express v5, TypeScript, Drizzle ORM + postgres.js, PostgreSQL, Redis (ioredis), JWT + Casbin RBAC, Socket.io, Pino logging, OpenTelemetry
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS v4, TanStack Query + Table, React Router, Radix UI, Recharts
- **Shared:** Zod schemas mirroring TS types, enums + Vietnamese label maps, financial calculations
- **Testing:** Vitest

## RBAC Roles

| Role      | Vietnamese | Scope                                    |
|-----------|------------|------------------------------------------|
| ADMIN     | Quan tri   | Full access                              |
| MANAGER   | Giam doc   | Trips, financials, fleet, reports       |
| ACCOUNTANT| Ke toan    | Financials, debt, P&L                    |
| DRIVER    | Lai xe     | Own trips, earnings (mobile-first)       |
| FORWARDER | Giao nhan  | Own trips, container/seal costs (mobile) |

## Conventions

- TypeScript strict mode, no `any` types
- REST API with `/api/v1` prefix (auth login at `/api/auth/login`)
- Drizzle ORM only -- no raw SQL
- Financial math via `round2dp()` / `computeTripTotals()` from shared
- VND currency, no decimal places in display
- Append-only ledger; ADJUSTMENT for corrections, UNLOCK_REVERSAL for unlocks
- Revenue recorded ex-VAT; costs recorded incl-VAT
- Conventional commit format, no AI references in messages

## License

Private -- Cong ty TNHH NEPO. All rights reserved.
