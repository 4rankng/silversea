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
8. For any UI-facing bug or feature: the **UI verification contract** below is satisfied per claim.

---

## UI verification contract (anti-lying rule)

Applies to every bug fix or feature with a user-visible surface, in local dev (`http://localhost:7174`) or staging (`https://vantai.tingting.vip/`).

### The claim ladder — never skip a rung, always state which rung you are on

| Rung | Label to use verbatim | What it means |
|---|---|---|
| 0 | `NOT TESTED` | No code executed against this path. Reasoning only. |
| 1 | `CODE-READ ONLY` | Read the code/schema. No execution. |
| 2 | `DB/API VERIFIED` | Ran SQL or hit the API directly. **The UI was never driven.** |
| 3 | `UI DRIVEN` | Clicked the actual control in a real browser session, captured the resulting DOM/screenshot, and confirmed the DB side effect. |

**Rules:**
- The words *tested*, *verified*, *works end-to-end*, *confirmed*, *fixed and tested* are reserved for **rung 3 only**. Rung 2 must be reported as "DB/API verified, UI not driven".
- Reasoning from code + a DB query is **rung 2**, never rung 3. Presenting it as rung 3 is a hard failure of this contract.
- One rung label **per bug/claim**, not per session. If bug A is rung 3 and bug B is rung 1, say so per bug. Never let bug A's evidence imply coverage of bug B.

### Rung 3 requires artifacts — no artifact, no claim

A `UI DRIVEN` claim is only valid if all four exist and are referenced by path in the report:
1. **Screenshot after the click** → `qa/<YYYY-MM-DD>_<scope>_ui-<step>.png`
2. **Post-click DOM/text assertion** showing the expected success or error state (the actual toast/row/status text, quoted).
3. **DB side-effect proof** — the query and its row output (e.g. new `trip` row, updated status).
4. **Driver log** → `qa/<YYYY-MM-DD>_<scope>_ui-driver.log` — the script/commands run, exit status.

Auth for headless runs: use the `puppeteer-spa-auth` skill (`evaluateOnNewDocument` to inject the token **before** first navigation) — otherwise the SPA silently redirects to login and you will screenshot a login page and call it a pass.

### Mandatory coverage report — end every UI task with this block

```
## Verification coverage
| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| <bug A>     | UI DRIVEN | qa/…png, qa/…log, trip id=14 | mobile viewport, FORWARDER role |
| <bug B>     | DB/API VERIFIED | psql output | never clicked "Thêm nhà xe" |
```

The **Not covered** column must never be empty or "n/a". If you genuinely cannot think of an untested edge, list at least: other roles, mobile viewport, staging vs local, and error/rollback path. Omitting this block means the task is not done.

### Prohibited phrasings

- ❌ "Verified: the fix works end-to-end" without rung-3 artifacts for *that specific* claim.
- ❌ Reporting multiple bugs under one blanket "tested and fixed".
- ❌ "should now work", "this will fix it" dressed up as verification.
- ❌ Silently downgrading: if you tried to drive the UI and the driver failed, report `NOT TESTED — driver failed: <reason>`, never fall back to rung 2 wording that sounds like rung 3.

### When you cannot drive the UI

Say so immediately and in the first sentence of the report: *"I could not drive the UI for X because Y. Rung: DB/API VERIFIED only."* Then ask whether to invest in the driver or hand the click-through to the user. Do **not** proceed to a confident summary.

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
