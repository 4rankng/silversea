# AGENTS.md — Silversea Agent Contract

Every bugfix/feature: update `testplan/` first, re-test before marking done.

## Git workflow: trunk-based on `main` only

Strict trunk-based development — **all work on `main`**. The closed-loop SDLC is the safety model, not branches.

- **No branches.** Never `git checkout -b`, `git switch -c`, `git branch`, `git worktree add`. Applies to skills and subagents too.
- **No worktrees.** Exactly one worktree at the repo root.
- **Commit directly to `main`.** Implement → QA gates → commit. If tooling refuses, commit anyway rather than branching.
- **No PRs against yourself.** Code review through the fix-loop rules and `code-reviewer`/`verifier` agents.
- **Existing branches/worktrees**: surface to user, ask before merging or deleting.
- **Remotes untouched unless asked.** No push, force-push, or remote branch deletion without explicit instruction.

## Skill selection

Before any task, select the smallest relevant skill(s). Read each `SKILL.md` fully before acting. Announce selections and why.

**Mandatory tool routing:**
- **PostgreSQL / Drizzle ORM** → `postgres-drizzle` skill; match installed Drizzle version and existing patterns. For data backfills, constraint tightening, deployment ordering, or rollback → also `drizzle-safe-migrations` (replace its generic examples with this repo's `pnpm` commands).

## Development context loading

`AGENTS.md` = **how to work**. `CONTEXT.md` = **what to load**. Keep separate.

1. Read `CONTEXT.md` and `HANDOFF.md` (if exists). `HANDOFF.md` is local state, not product truth; use `HANDOFF.example.md` as structure.
2. Resolve task-specific context: `pnpm context -- <changed-path-or-task-keyword>`.
3. Read only returned sources + code around the target. No bulk-loading.
4. State expected output, acceptance criteria, scope, constraints, and touchpoints before implementing.
5. Before handoff: controller updates `HANDOFF.md` and runs `pnpm context:check`. Subagents report via `plans/.../reports/` only.

If resolver returns no profile: scout with `rg`/code intelligence first, then `pnpm context -- --profile <profile-id>`. Manifest at `.codex/context-manifest.json` must not contain secrets, machine-specific paths, customer data, or transient output.

## Closed-loop SDLC

Every task runs: **Understand → Plan → Implement → QA → Fix → Re-QA → DONE**. "Done" means all gates green — not that code was written. Loop Fix ↔ Re-QA while any gate is red.

**Non-negotiables:**
- No stubs, mocks, `test.skip`, `TODO` placeholders, or fake data.
- If a gate is red, fix the **root cause** — never weaken tests, `eslint-disable`, broaden types, or skip/delete failing tests.
- Never self-approve: authoring and review are separate passes. For non-trivial changes, hand off to `code-reviewer`/`verifier`.

## QA gates (run after every implementation)

Run from repo root. **All gates the change can affect must be green.**

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

**Mechanical compile gate:** a versioned pre-commit hook (`scripts/githooks/pre-commit`, wired by `git config core.hooksPath scripts/githooks` — also auto-wired on `pnpm install` via the root `prepare` script) runs the typecheck table above whenever staged files touch a project, and refuses the commit on failure. This enforces "QA gates → commit" for every session sharing this checkout, including sweep commits. Escape hatch: `git commit --no-verify` (justify in the commit body — a red `main` is worse than a delayed commit).

## QA artifacts (`qa/` — mandatory)

Every QA run → one artifact under `qa/`. Pass or fail.

- **Naming:** `qa/<YYYY-MM-DD>_<scope>_<gate>.<ext>` — e.g. `qa/2026-07-25_trip-status_backend-test.log`
- **Content:** exact command, exit status, full output. Failures must include the fix-and-re-run that turned green.
- A task is not done without its QA artifacts saved.

## Definition of Done

A task is done **only when all** are true:
1. Code implements the requested behavior — verified by running it.
2. Every affected QA gate is green.
3. Diff reviewed (self or reviewer) for correctness and scope creep.
4. No `TODO`/`skip`/stub/placeholder in the changed surface.
5. Docs updated if user-visible behavior, commands, or architecture changed.
6. All QA artifacts saved under `qa/`.
7. `.ua/` knowledge base is current (see *Knowledge Base* below).

---

## Knowledge Base (Understand-Anything)

Structured knowledge graph in `.ua/` — committed to git, shared across agents.

**Keep it current — part of the closed loop, not optional.**

- **Location:** `.ua/` — `knowledge-graph.json`, `fingerprints.json`, `meta.json`, `config.json`. Transient dirs `.ua/intermediate/` and `.ua/.trash-*/` are gitignored.
- **Auto-update:** `.zcode/config.json` registers a `Stop` hook (`.zcode/hooks/understand-staleness.sh`) that compares `meta.json.gitCommitHash` against `HEAD`. When stale, it injects an update instruction — **treat this like a red QA gate; run the update before declaring done.**
- **How to update:** Read the plugin's `hooks/auto-update-prompt.md` (`~/.understand-anything-plugin/hooks/auto-update-prompt.md`). Phase 1 fingerprints at zero LLM cost; only structurally-changed files are re-analyzed.
- **Skills** (in `~/.agents/skills/`): `/understand` (full rebuild), `/understand-diff` (preview impact), `/understand-explain` (query the graph), plus `/understand-onboard`, `/understand-domain`, `/understand-chat`, `/understand-dashboard`.
- **Never** hand-edit `knowledge-graph.json`/`fingerprints.json`. Corrupt/stale → `/understand --full`.

---

## Local dev quick reference

- **Backend architecture:** [`docs/backend-architecture.md`](docs/backend-architecture.md) — layering rules, naming, god-file split, add-an-entity path; enforced by `backend/src/tests/unit/arch-layering.test.ts`.
- **Context engineering:** [`docs/context-engineering/playbook.md`](docs/context-engineering/playbook.md)
- Start: `make dev` → Postgres `:5441` · Redis `:6391` · Backend `:3001` · Frontend `:7174` · Adminer `:8083`
- First-time setup: `make setup`
- Backend health: http://localhost:3001/api/health
- Drizzle ORM only — **no raw SQL**. Financial precision via `round2dp()` / `computeTripTotals()`.

## Demo accounts (all passwords `Abc123`)

| Username | Role |
| --- | --- |
| admin | ADMIN |
| giamdoc | MANAGER |
| cus | CLERK |
| ketoan | ACCOUNTANT |
| laixe | DRIVER |
| giaonhan | FORWARDER |
| thu | DRIVER |
| pho | DRIVER |
| quyet | DRIVER |

Local: http://localhost:7174 — `admin / Abc123`

## Staging accounts (password `Abc123`)

| Username | Role |
| --- | --- |
| admin | ADMIN |
| giamdoc | MANAGER |
| ketoan | ACCOUNTANT |
| laixe | DRIVER |
| giaonhan | FORWARDER |
| khachhang | CUSTOMER |

Staging: https://vantai.tingting.vip/
