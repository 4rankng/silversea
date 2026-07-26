# AGENTS.md — Agent Working Contract (Silversea)

This repo is the TingTing Vietnamese trucking logistics platform deployed for the SilverSea customer.
Every coding agent (Claude Code, Codex, Cursor, etc.) working here **must** follow the closed-loop
SDLC below. There are no exceptions for "small" or "quick" changes.

## Development context loading (mandatory)

`AGENTS.md` defines **how to work**. [`CONTEXT.md`](CONTEXT.md) defines **what to
load for the current task**. Keep those concerns separate.

At the start of a task:

1. Read `CONTEXT.md` and `HANDOFF.md` when it exists. `HANDOFF.md` is ignored
   local state, not a source of product truth; use `HANDOFF.example.md` as its
   structure.
2. Resolve the smallest task-specific context set:
   `pnpm context -- <changed-path-or-task-keyword>`.
3. Read only the returned sources plus the code immediately around the target.
   Do not bulk-load every PRD, plan, route, or test.
4. State expected output, acceptance criteria, scope boundary, constraints, and
   touchpoints before implementation.
5. Before handoff, the controller updates `HANDOFF.md` and runs
   `pnpm context:check`. Subagents and parallel sessions report through their
   assigned `plans/.../reports/` path and must not overwrite `HANDOFF.md`.

If the resolver returns no profile, scout with `rg`/code intelligence first,
then use `pnpm context -- --profile <profile-id>`. The manifest at
`.codex/context-manifest.json` is versioned and must not contain secrets,
machine-specific paths, customer data, or transient command output.

## Closed-loop SDLC (mandatory)

Every task runs this loop. **"Done" means the loop exited green — not that code was written.**

```
 Understand → Plan → Implement → QA ──→ Fix ──→ Re-QA ──→ DONE (all green)
                                │       ↑          │
                                │       └──────────┘   (loop while any gate is red)
                                └─ red gate ──┘
```

1. **Understand** — read the request, the file you are touching, and the code around it. For a bug, reproduce it before fixing.
2. **Plan** — decide scope before editing. Keep changes minimal and focused on the request.
3. **Implement** — write real behavior. No stubs, mocks, `test.skip`, `TODO` placeholders, or fake data inserted just to satisfy a check.
4. **QA** — immediately run the verification gates below against everything the change touches, and **save every run's output as an artifact under `qa/`** (see *QA artifacts*).
5. **Fix** — if **any** gate is red, fix the **root cause** right now. Do not weaken a test, do not `eslint-disable`, do not broaden a type to silence an error, do not delete or skip a failing test.
6. **Re-QA** — re-run the gates and **save the re-run artifacts under `qa/`**. The loop closes **only** when every affected gate is green. Still red → back to Fix.

A task is **not complete** while any gate is red or any fix is unverified. Do not hand off, commit, or claim done otherwise.

## QA gates (run after every implementation)

Run from repo root unless noted. **All gates the change can affect must be green** before a task is done.

| Gate | Command | Bar |
|------|---------|-----|
| Lint (root) | `pnpm lint` | 0 errors |
| Backend typecheck | `cd backend && npx tsc --noEmit` | 0 errors |
| Backend tests | `cd backend && pnpm test` | all pass |
| Frontend typecheck | `cd frontend && npx tsc -b` | 0 errors |
| Frontend tests | `cd frontend && pnpm test` | all pass |
| Build | `make build` | succeeds |
| E2E (if API / flow / RBAC / schema changed) | `cd e2e && ./run_all.sh` | all pass |

Scope each QA run to what the change actually touches — but **never skip a gate the change could affect**. When shared contracts, Drizzle schemas, financial calculations (`shared/src/calculations/`), or RBAC change, run the full set including E2E.

## QA artifacts (save to `qa/` — mandatory)

**Every QA run produces an artifact, and every artifact goes under `qa/`.** No exceptions, no scattering output into the repo root, `reports/`, or paste-only chat.

- **Directory:** `qa/` at repo root (see `qa/README.md` for the full convention).
- **One artifact per gate per task**, capturing the *actual* command output — pass **or** fail: backend/frontend tests, lint, typecheck, build, e2e, plus `code-reviewer`/`verifier` reports and manual-QA screenshots.
- **Naming:** `qa/<YYYY-MM-DD>_<scope>_<gate>.<ext>` — e.g. `qa/2026-07-25_trip-status_backend-test.log`, `qa/2026-07-25_debit-note_lint.txt`, `qa/2026-07-25_gps-rbac_review.md`.
- **Content:** the exact command run, exit status, and full output. If a gate failed, the artifact must include the failure **and** the subsequent fix-and-re-run that turned green — the loop must be auditable.
- A task is not done until its QA artifacts are saved here.

## Fix-loop rules (hard)

- **Prove root cause before changing behavior.** For bugs, no guessing — reproduce first.
- **Never silence a red gate.** Fix the cause; do not disable, relax, or work around the check.
- **Never self-approve in the same pass.** Authoring and review are separate. Re-read your own diff as a reviewer before closing the loop; for non-trivial or cross-module changes, hand off to `code-reviewer` / `verifier` and save the report under `qa/`.
- **No fake completion.** `TODO` comments, skipped tests, stub branches, and "wire later" notes are **blockers**, not progress. Implement them, or report the blocker explicitly.
- **If a gate is genuinely blocked by infra or flakiness**, say so with evidence (paste the failure into the `qa/` artifact). Do not pretend it passed.

## Definition of Done

A task is done **only when all** are true:
1. Code implements the requested behavior — verified by running it, not assumed.
2. Every QA gate the change can affect is green.
3. The diff was reviewed (self or reviewer) for correctness and scope creep.
4. No `TODO` / `skip` / stub / placeholder left in the changed surface.
5. Docs updated if user-visible behavior, commands, or architecture changed.
6. **All QA artifacts saved under `qa/`**, including any fix-loop re-runs.

---

## Local dev quick reference

- **Agent context engineering:** see [`docs/context-engineering/playbook.md`](docs/context-engineering/playbook.md) — the system-prompt builder, lanes, tool-selection, and governance mapped to code.
- Start everything: `make dev` → Postgres `:5441` · Redis `:6391` · Backend `:3001` · Frontend `:7174` · Adminer `:8083`
- First-time setup: `make setup` (infra + migrate + seed)
- Backend health: http://localhost:3001/api/health
- Drizzle ORM only — **no raw SQL**. Financial precision via `round2dp()` / `computeTripTotals()`.

## Demo accounts (all passwords `admin123`)

| Username | Role |
| --- | --- |
| admin | ADMIN |
| giamdoc | MANAGER |
| ketoan | ACCOUNTANT |
| laixe | DRIVER |
| giaonhan | FORWARDER |
| thu | DRIVER |
| pho | DRIVER |
| quyet | DRIVER |

Open http://localhost:7174 and log in with `admin / admin123`. ✅
