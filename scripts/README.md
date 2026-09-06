# `scripts/` — QA + automation

Shared tooling for the QA team. Every script here is runnable on the local
dev stack (`make dev` first). Output goes under `qa/<YYYY-MM-DD>_<scope>/`
by convention so `qa-aggregate` can roll it up.

## Layout

| Path | What it is |
|------|------------|
| `lib/http.mjs` | `login()`, `api()`, `health()`, `ROLES` — the only place auth + role table live. |
| `lib/ui-driver.mjs` | `withSession()`, `pickCombobox()`, `fillPlain()`, `setAtIndex()`, `writeArtifact()`. Wraps the `puppeteer-spa-auth` pattern (inject JWT via `evaluateOnNewDocument` BEFORE first nav) so no script can regress to the "screenshots the login page" trap. |
| `lib/*.test.mjs` | `node --test` unit tests. Run with `pnpm scripts:test`. |
| `context-for.mjs` | Context manifest resolver (`pnpm context` / `pnpm context:check`). |
| `qa-dev-ready.mjs` | Pre-flight: docker + db + redis + backend + frontend + migrations. Run before any other QA. |
| `qa-api-smoke.mjs` | Fast backend smoke: 3-5 endpoints per role, reports status codes. |
| `qa-seed-factory.mjs` | Builds a regression scenario (customer + shipment) and prints the IDs. |
| `qa-aggregate.mjs` | Walks `qa/`, reads every `report.json`, produces a markdown summary. |
| `test-spa-smoke.mjs` | Per-role SPA smoke (login, home, RBAC blocks). `pnpm qa:smoke` runs every role. |
| `test-cus-create-final.mjs` | CUS create FCL shipment, UI-driven. |
| `test-o2c-happy.mjs` | CUS → Điều vận → Lái xe happy path. |
| `staging-visual-matrix.mjs` | Full RBAC × route × viewport screenshot matrix for staging. |
| `release-source-tag.mjs` | Git-state fingerprint tag for releases. |
| `generate-customer-business-decisions-docx.cjs` | One-off Vietnamese SilverSea proposals docx generator. |
| `githooks/pre-commit` | Mechanical typecheck gate on staged frontend/backend src files. |

## Recommended order on a fresh checkout

```sh
make dev                 # start the stack
pnpm qa:ready            # pre-flight: db/redis/backend/frontend/migrations
pnpm qa:api              # fast backend smoke (no browser)
pnpm qa:scenario         # create a regression shipment, capture the IDs
pnpm qa:smoke            # per-role SPA smoke (browser)
pnpm qa:aggregate        # roll the day's reports into a markdown summary
```

## Conventions

- **Output dirs:** `qa/<YYYY-MM-DD>_<scope>/` (the date prefix is what
  `qa-aggregate` keys on). Every script that produces artifacts MUST
  write its own subdir under that.
- **Reports:** every script that produces a pass/fail MUST write a
  `report.json` containing at least `{ generatedAt, allPassed, total, passed, failed, results }`.
  This is the contract `qa-aggregate` reads.
- **Auth:** scripts never duplicate login logic — `import { login, api } from './lib/http.mjs'`.
- **Browser:** scripts never duplicate the puppeteer launch +
  `evaluateOnNewDocument` token injection — `import { withSession } from './lib/ui-driver.mjs'`.

## Writing a new script

1. Read `lib/http.mjs` and `lib/ui-driver.mjs` first. If the helper you
   need doesn't exist, add it to the lib (with a test) instead of
   duplicating.
2. Use the `qa/<date>_<scope>/` convention for output. Add a `report.json`
   if your script produces a pass/fail.
3. Add the script to `package.json` under a `qa:*` namespace.
4. If the script touches a domain that doesn't have a `testplan/flows/`
   case yet, link to the case ID in the script's header.

## Environment variables

All scripts honour the same env vars (with sensible defaults):

| Var | Default | Used by |
|-----|---------|---------|
| `FRONTEND` | `http://localhost:7174` | every browser script |
| `BACKEND`  | `http://localhost:3001/api` | every API script |
| `ARTIFACTS`| `qa/<date>_<scope>/` | every script that writes files |
| `DB_CONTAINER` | `silversea-db` | `qa-dev-ready.mjs` |
| `REDIS_CONTAINER` | `silversea-redis` | `qa-dev-ready.mjs` |
