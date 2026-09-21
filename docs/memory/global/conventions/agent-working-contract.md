---
name: "agent-working-contract"
description: "The migrated AGENTS.md/CONTEXT.md working contract: trunk-based git, closed-loop SDLC, QA gates table, pre-commit compile gate, qa/ artifacts, testplan regression rule, DoD, authority order, repo shape, core invariants"
folder: "global / conventions"
tags: ["agents-contract", "qa-gates", "sdlc", "git-workflow", "conventions"]
updatedAt: "2026-09-11T01:51:41.751Z"
author: "Project Manager (pm)"
---

# Silversea agent working contract (migrated from AGENTS.md + CONTEXT.md, 2026-09-10)

This is the repo's working contract for every agent. Originally `AGENTS.md` (how to work) + `CONTEXT.md` (what to load); migrated into AgentsRoom so every agent inherits it.

## Git workflow: trunk-based on `main` only

- Strict trunk-based development — **all work on `main`**. The closed-loop SDLC is the safety model, not branches.
- **No branches.** Never `git checkout -b`, `git switch -c`, `git branch`, `git worktree add`. Applies to skills and subagents too. (Exception per [[testing-and-deploy-environments]]: the `prod` deploy branch in the silversea-prod checkout.)
- **Commit directly to `main`.** Implement → QA gates → commit. If tooling refuses, commit anyway rather than branching.
- **No PRs against yourself.** Code review through the fix-loop rules and reviewer/verifier agents.
- **Remotes untouched unless asked.** No push, force-push, or remote branch deletion without explicit instruction.
- **Commit in logical chunks, not one monolithic commit** (user directive 2026-09-07).

## Closed-loop SDLC

Every task runs: **Understand → Plan → Implement → QA → Fix → Re-QA → DONE**. "Done" means all gates green — not that code was written.

**Non-negotiables:**
- No stubs, mocks, `test.skip`, `TODO` placeholders, or fake data.
- If a gate is red, fix the **root cause** — never weaken tests, `eslint-disable`, broaden types, or skip/delete failing tests.
- Never self-approve: authoring and review are separate passes.
- Never claim "tested"/"verified" without browser interaction evidence — see the `ui-verification-contract` skill ([[agent-tooling-pitfalls]]).

## QA gates (run after every implementation, from repo root)

| Gate | Command | Bar |
|------|---------|-----|
| Lint (root) | `pnpm lint` | 0 errors |
| Backend typecheck | `cd backend && npx tsc --noEmit` | 0 errors |
| Backend tests | `cd backend && pnpm test` | all pass |
| Frontend typecheck | `cd frontend && npx tsc -b` | 0 errors |
| Frontend tests | `cd frontend && pnpm test` | all pass |
| Build | `make build` | succeeds |
| E2E (API / flow / RBAC / schema changes) | `cd e2e && ./run_all.sh` | all pass |

Scope to what the change touches — never skip a gate it could affect. Shared contracts, Drizzle schemas, financial calculations (`shared/src/calculations/`), or RBAC changes → full set including E2E.

**Mechanical compile gate:** versioned pre-commit hook (`scripts/githooks/pre-commit`, wired via `git config core.hooksPath scripts/githooks`, auto-wired on `pnpm install`) runs the typecheck table + the frontend `structure.guard.test.ts` LOC-ratchet whenever staged files touch a project, refusing the commit on failure. Escape hatch: `git commit --no-verify` (justify in the commit body — a red `main` is worse than a delayed commit). Origin incidents: 2026-09-05 corrupted-JSX sweep commit; 2026-09-08 LOC-ceiling breach.

## QA artifacts (`qa/` — mandatory)

Every QA run → one artifact under `qa/`, pass or fail. Naming: `qa/<YYYY-MM-DD>_<scope>_<gate>.<ext>`. Content: exact command, exit status, full output; failures must include the fix-and-re-run that turned green. A task is not done without its QA artifacts.

## Testplan regression rule

Every bugfix/feature: update `testplan/` first, re-test before marking done. **Every user-reported bug must also land a regression case in `testplan/`** (repro steps + expected behavior + case ID) before its fix is reported done — cite the case ID in the fix report and re-run it before any deploy. Structure: `testplan/roles/` (7 per-role walkthroughs: cus, dieuvan, laixe, ketoan, quanly-admin, vanhanh, khachhang), `testplan/flows/` (10 flow specs incl. e2e-regression + qa-matrix-v2), `testplan/qa/` (runnable harness: `run-all.mjs`, `run-case.mjs`, `smoke.mjs`), `testplan/testaccounts.txt` (all local+staging passwords are `Abc123` — see [[testing-and-deploy-environments]]).

## Definition of Done

1. Code implements the requested behavior — verified by running it.
2. Every affected QA gate is green.
3. Diff reviewed for correctness and scope creep.
4. No `TODO`/`skip`/stub/placeholder in the changed surface.
5. Docs updated if user-visible behavior, commands, or architecture changed.
6. All QA artifacts saved under `qa/`.
7. `.ua/` knowledge base current (see below).
8. UI-facing bugs/features satisfy the UI verification contract per claim (skill `ui-verification-contract`).

## Authority order (when sources disagree)

1. Explicit user decisions and accepted scope for the current task.
2. This contract (workflow, safety, DoD).
3. Accepted/modified SilverSea decisions in the PRD business-logic Q&A index (all 23 proposals accepted 2026-07-27 — see [[prd-roadmap-and-decisions]]).
4. Current code, schemas, tests, and migrations for implemented behavior.
5. Roadmap/phase plans for intended future work ([[prd-roadmap-and-decisions]]).
6. Session/handoff state for continuity only; verify drift-prone claims before acting.

## Repository shape

- `shared/`: cross-package Zod contracts, types, navigation catalog, financial calculations.
- `backend/`: Express 5, Drizzle/Postgres, Casbin, services, routes, jobs, tests.
- `frontend/`: React/Vite app, feature modules, design system, API clients, tests — see [[frontend-architecture]] and [[design-system-contracts]].
- `e2e/`: authenticated product-flow checks. `plans/`: durable implementation plans (a plan is not proof of completion). `qa/`: verification evidence. `deploy/` + Makefiles: deployment mechanics.

**Core invariants:**
- Drizzle ORM only; **no raw SQL** in application behavior.
- Financial calculations use `round2dp()` / `computeTripTotals()` from shared calculation authorities.
- API access is JWT-authenticated and Casbin/role-gated.
- Vietnamese user-facing copy follows approved domain terminology (`*_LABELS` maps from `@tingting/shared`).
- Shared/schema/RBAC/financial changes require the broadest QA, including E2E.
- Existing worktree changes belong to the user unless ownership is explicit (two sessions share the prod checkout — coordinate via AgentsRoom messages).

## Context resolution (optional helper)

`pnpm context -- <changed-path-or-task-keyword>` resolves task-specific context via `.codex/context-manifest.json` (profiles: product-planning, backend-api, database, shared-contracts, financial, frontend, deployment, documentation — each carrying its own QA list). `pnpm context:check` / `pnpm context:test` validate it. NOTE (2026-09-10): the manifest is stale — it references removed agent-runtime files (`backend/src/agentSocket.ts`, `services/agent/*`, `shared/src/schemas/agent.ts`), a missing `qa/README.md`, and the old roadmap plan; check was already red before migration. Scout with code intelligence instead of trusting it blindly.

## Skill routing

- PostgreSQL / Drizzle ORM work → `postgres-drizzle` skill (global); match installed Drizzle version + existing patterns. Data backfills, constraint tightening, deployment ordering, or rollback → also `drizzle-safe-migrations` (replace generic examples with this repo's `pnpm` commands).
- UI verification → `ui-verification-contract` (project skill). Untitled UI retrieval → `untitled-ui-component-workflow` (project skill). Headless browser auth → `puppeteer-spa-auth` (project skill).

## Knowledge base (Understand-Anything, `.ua/`)

Structured knowledge graph in `.ua/`, committed to git. Keep current — part of the closed loop. A `Stop` hook (`.zcode/hooks/understand-staleness.sh`, registered in `.zcode/config.json`) compares `meta.json.gitCommitHash` vs `HEAD`; when stale it injects an update instruction — **treat like a red QA gate**. Update via `/understand` skills (phase-1 fingerprints are zero-LLM-cost). Never hand-edit `knowledge-graph.json`/`fingerprints.json`; corrupt/stale → `/understand --full`.

## Dev quick reference

- Start: `make dev` → Postgres `:5441` · Redis `:6391` · Backend `:3002` · Frontend `:7175` · Adminer `:8083`. First-time: `make setup`. Backend health: `http://localhost:3002/api/health`.
- Demo/local accounts (password `Abc123`): admin(ADMIN), giamdoc(MANAGER), cus(CLERK), ketoan(ACCOUNTANT), laixe(DRIVER), giaonhan(FORWARDER), thu/pho/quyet(DRIVER). Local: http://localhost:7175.
- Staging accounts (password `Abc123`): admin, giamdoc, ketoan, laixe, giaonhan(FORWARDER), khachhang(CUSTOMER). Staging: https://vantai.tingting.vip/.
- Deploy mechanics + prod rules: [[testing-and-deploy-environments]].

## Handoff protocol (legacy, now superseded)

The repo formerly ran a `HANDOFF.md` single-snapshot protocol (controller-owned, template `HANDOFF.example.md`, subagents reported to `plans/.../reports/`). With AgentsRoom, continuity lives in session state + the kanban board ([[kanban-task-tracking]]); the handoff files were removed 2026-09-10. `plans/` and `plans/reports/` remain the durable plan/report locations.

## Architect plan-approval gate (user directive 2026-09-10, binding)

No agent may write, commit, or push code changes without an architect-APPROVED plan for that change. Diagnosis, reproduction, and read-only investigation proceed freely. The moment an implementing agent knows WHAT it intends to change, it posts the plan — root cause/requirement, exact files, approach (incl. alternatives rejected), test strategy, rollback — to the run NOTES + architect, and WAITS for an explicit APPROVED before editing code. Silence is never approval; rejections must carry actionable reasons. Already-coded-but-unapproved work holds its commit until approved. The architect treats plan approvals as wave-critical (fast, reasoned turnaround). Retrospective carve-out: everything shipped before 2026-09-10 ~23:27 +07 went out under pm rulings; from this directive forward the gate belongs to the architect role. Complements the QA gates table above, does not replace it.

## Team utilization & architect gate (user directive 2026-09-11, BINDING)

- **Full team utilization:** no idle agents while work is open. The orchestrator (pm) must continuously load every lane — split defects/epics into parallel sub-lanes with clear file/domain ownership, assign sweeps/verifications to parked lanes, and pull parked lanes back in for independent work. "Waiting" must be a deliberate dependency, never a default.
- **Software architect standing roles (three):** (1) **review** — architecture/design review of changes and evidence; (2) **approve coding plans** — Amendment 5 gate: no agent writes/commits code without an explicit architect-APPROVED plan (root cause/requirement, files, approach + rejected alternatives, tests w/ case IDs, rollback; silence ≠ approval); (3) **code review** — reviews implemented diffs before ship (first-hand test runs encouraged; non-blocking nits recorded, blocking findings halt).
- Working rhythm that satisfies both: pm keeps all build lanes loaded in parallel; every code change funnels through the architect's plan gate and code review; verification and deploy duties stay separate (local-first → staging → empty-board prod gate per the 2026-09-10/11 directives).

## Clarification routing (user directive 2026-09-11, BINDING — extends the architect gate above)

- **Code-related clarifications** (how something works, why a query/component behaves a way, technical approach conflicts, implementation decisions) → **the software architect decides.** Agents ask the architect directly; its answer is binding for code matters.
- **Requirement-related clarifications** (what the user asked for, scope, acceptance, prioritization, product behavior intent) → **the PM answers** (the pm may consult the user; the user remains the final authority on requirements).
- Everything else keeps its owner: deploy gates → deploy-owner (with pm/user escalation chains), QA verdicts → QA, board/coordination → pm.

## SDLC vs requirements ownership (user directive 2026-09-11, BINDING)

- **Software architect = SDLC decisions.** Process shape, sequencing of technical work, implementation approach, technical UX decisions, fix-vs-data-call, gate mechanics — the architect decides; agents treat its SDLC answers as binding.
- **PM = requirements.** What the user asked for, scope, acceptance criteria, prioritization, product-intent questions; PM consults the user as final authority.
- Together with the routing above (code clarifications → architect; requirement clarifications → PM), the division is: architect owns HOW the software is built and delivered; pm owns WHAT is being built and why.

## 15-minute progress chase (user directive 2026-09-11 ~09:42, BINDING — response to a 9-hour gate stall)

- The orchestrator (pm) MUST chase team progress **every 15 minutes** while a wave is open: check inbox for verdicts/reports, check origin/prod for new commits, and ping ANY lane that is idle-with-pending-work or a gate that hasn't ruled.
- A pending approval/plan/review older than ~15 minutes = ESCALATE immediately (urgent demand + deadline); a gate that stalls past its deadline = invoke the pm's fallback authority (accept well-evidenced plans under pm approval, mandatory retroactive architect review before the next environment touch) — waiting silently is never acceptable.
- Origin incident that triggered this: the vehicle-fix + chunk-C2 plans sat unruled ~9h overnight (2026-09-10→11) while every lane idled at the gate; the user flagged it directly. In-process recurring cron now enforces the cadence.

## VERIFY-RUNNING rule (user directive 2026-09-11 ~09:52, BINDING — zero assumptions)

- **An agent is working ONLY if `agents_list_live` shows status `busy` or an advancing last-activity timestamp.** A delivered message is NOT work. `idle`, `waiting_input`, or a growing `pending/unread` queue = NOT working.
- Every 15-min chase cycle MUST include an `agents_list_live` status check of ALL lanes — inbox reads alone prove nothing.
- If a console sits idle/waiting_input with a queued assignment: RE-SEND a direct "START NOW" wake message (that input triggers its turn); if it still doesn't flip to busy within one cycle, tell the user to click that agent's terminal tab (user click = console input) or reassign its work to a busy-capable lane.
- Never report a lane as "working" without this verification. Never wait on a console that is not running.
