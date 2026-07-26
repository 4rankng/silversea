# Silversea Development Context

This is the compact entrypoint for software-development agents. It describes
stable repository facts and how to retrieve task-specific context. It does not
replace product requirements, code, plans, or the current handoff.

## Authority order

When sources disagree, use this order:

1. Explicit user decisions and accepted scope for the current task.
2. `AGENTS.md` workflow, safety, and Definition of Done.
3. Accepted/modified SilverSea decisions in
   `docs/prd/business-logic-qa-proposals.md`.
4. Current code, schemas, tests, and migrations for implemented behavior.
5. `ROADMAP.md` and active phase plans for intended future work.
6. `HANDOFF.md` for continuity only; verify drift-prone claims before acting.

PRD proposals with `pending` status are not approved requirements. Plans
describe intent, while code and green QA establish implemented behavior.

## Repository shape

- `shared/`: cross-package Zod contracts, types, navigation catalog, and
  financial calculations.
- `backend/`: Express 5, Drizzle/Postgres, Casbin, services, routes, jobs, and
  backend tests.
- `frontend/`: React/Vite application, feature modules, design system, API
  clients, and frontend tests.
- `e2e/`: authenticated product-flow checks.
- `docs/prd/`: SilverSea source documents and decision/status index.
- `plans/`: durable implementation plans. A plan is not proof of completion.
- `qa/`: required evidence for every verification run.
- `deploy/` and package Makefiles: deployment mechanics.

Core invariants:

- Drizzle ORM only; no raw SQL in application behavior.
- Financial calculations use `round2dp()` and shared calculation authorities.
- API access is JWT-authenticated and Casbin/role-gated.
- Vietnamese user-facing copy follows approved domain terminology.
- Shared/schema/RBAC/financial changes require the broadest QA, including E2E.
- Existing worktree changes belong to the user unless ownership is explicit.

## Progressive loading protocol

1. Read `AGENTS.md` (normally injected), this file, and `HANDOFF.md` when it
   exists.
2. Run the resolver with the path or task language you actually have:

   ```sh
   pnpm context -- backend/src/routes/shipments.ts
   pnpm context -- "salary close"
   pnpm context -- --profile frontend
   pnpm context -- --json backend/src/db/schema.ts
   ```

3. Read the returned `context` files. Then inspect the target and its callers,
   tests, and public contracts with code intelligence.
4. Add context only when a concrete unknown blocks progress. Prefer summaries
   and exact symbols over whole directories.
5. Re-run the resolver if scope moves to a different layer.

The resolver reads `.codex/context-manifest.json`. Validate it after changing
paths, profiles, or commands:

```sh
pnpm context:check
pnpm context:test
```

## Context hygiene

- Keep stable rules near the beginning; keep task-specific state in `HANDOFF.md`.
- Do not paste logs, tool dumps, secrets, personal data, or generated output
  into context files.
- Do not load all twelve PRD documents for a narrow implementation task.
- Do not trust completion claims without the matching `qa/` artifacts.
- Treat dates, branch state, active plans, and deployed versions as dynamic;
  verify them live.
- Preserve exact user decisions. Record unresolved business choices rather than
  silently selecting a default.

## Task state and handoff

`HANDOFF.md` is the single bounded state snapshot for the next agent. It is
intentionally git-ignored so transient task state does not make every checkout
dirty. Start from tracked `HANDOFF.example.md`, keep the local file short, and
overwrite stale task details. It must include:

- controller/session owner and last-updated time;
- goal and status;
- scope and explicit non-goals;
- decisions and authoritative sources;
- files owned by the task;
- unrelated/concurrent changes that were preserved;
- QA artifacts and results;
- blockers or next step.

Only the controller for the active task writes `HANDOFF.md`. Subagents and
parallel sessions write their assigned `plans/.../reports/` artifacts instead.
Before replacing a handoff owned by another active task, coordinate with its
owner or preserve its state in that task's report directory. A stale or
completed handoff may be replaced after its claims are verified.

The handoff is not a changelog. Durable product decisions belong in the PRD
status index, architecture docs, or an accepted plan.

## Development endpoints

- Frontend: `http://localhost:7174`
- Backend health: `http://localhost:3001/api/health`
- Postgres: `localhost:5441`
- Redis: `localhost:6391`
- Adminer: `http://localhost:8083`

Use `make dev` for the local stack. Use the task profile's QA recommendations
and the mandatory gates in `AGENTS.md`; never infer deployment authorization
from implementation authorization.
