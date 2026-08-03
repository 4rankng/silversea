# AGENTS.md — Agent Working Contract (Silversea)

This repo is the TingTing Vietnamese trucking logistics platform deployed for the SilverSea customer.
Every coding agent (Claude Code, Codex, Cursor, etc.) working here **must** follow the closed-loop
SDLC below. There are no exceptions for "small" or "quick" changes.

## Git workflow: trunk-based on `main` only (mandatory)

This repo follows strict trunk-based development. **All work happens directly on
the `main` branch.** No exceptions for "exploratory", "isolated", "parallel", or
"safer" work — the closed-loop SDLC below is the safety model, not branches.

- **Do not create branches.** Never run `git checkout -b`, `git switch -c`,
  `git branch <name>`, or `git worktree add`. Do not let a skill or subagent do
  it either.
- **Do not create worktrees.** There is exactly one worktree — the main checkout
  at the repo root. Do not add linked worktrees under `/tmp`, `~`, or anywhere
  else.
- **Commit directly to `main`.** Implement → run the QA gates → commit on `main`.
  If `main` is the current default branch and your tooling refuses to commit to
  it, commit anyway with `git commit` (the project explicitly authorizes this)
  rather than spinning up a branch to work around it.
- **Do not open feature, release, or hotfix branches**, and do not open PRs
  against yourself. Code review happens through the fix-loop rules and the
  `code-reviewer` / `verifier` agents, not through branch-based pull requests.
- **If a branch or worktree already exists from prior work**, do not build on it.
  Surface it to the user and ask before merging it back to `main` or deleting it
  — unmerged branches can carry work that is not on `main`.
- **Remotes stay untouched unless asked.** Do not push, force-push, or delete
  remote branches without an explicit user instruction.

This rule exists because parallel branches in this repo have historically
diverged by dozens of commits with conflicting migration histories, making
merges destructive and lossy. One branch, linear history, verified by the loop
below.

## Skill selection (mandatory)

Before attempting any task, inspect the available skill descriptions and select
the smallest relevant skill or skill sequence for the request. Read each
selected `SKILL.md` completely before taking task actions, announce the selected
skill(s) and why they apply, and follow their instructions together with this
project contract. If no specialized skill matches, state that briefly and
continue with the repository workflow rather than forcing an unrelated skill.

For PostgreSQL or Drizzle ORM work, use the globally installed
`postgres-drizzle` skill and match this repository's installed Drizzle version
and existing patterns before writing schema, query, transaction, or migration
code. When a migration requires a data backfill, constraint tightening,
deployment ordering, or rollback planning, also use `drizzle-safe-migrations`;
replace its generic package-manager examples with this repository's documented
pnpm commands and migration conventions.

For accessibility audits, use `wcag-accessibility-audit` together with the
applicable browser/UI testing skill. Treat WCAG 2.2 Level AA as the default
audit target unless the accepted scope specifies otherwise, and retain the
project's required real-role, desktop, tablet, and mobile evidence.

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

## UI component libraries (mandatory)

For UI design or implementation work, consult the configured UI MCP component
libraries—Shadcn, Untitled UI, and Tailkit—early in the task, and use suitable
components or patterns from them where they improve the result. Treat these
libraries as design and implementation inputs, then adapt what you use to the
canonical Silversea design system, existing code conventions, accessibility
requirements, and responsive desktop/mobile behavior. Do not copy a component
verbatim when it would introduce an incompatible dependency or conflict with an
existing project primitive.

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
7. **The Understand-Anything knowledge base in `.ua/` is current** for the
   committed HEAD (see *Knowledge Base* below) — run the incremental update if
   the `Stop` hook reported staleness.

---

## Knowledge Base (Understand-Anything)

This repo ships an [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything)
knowledge graph in `.ua/` — a structured map of files, components, layers, and
their relationships that every agent (and human) can query instead of reading
code blind. It is committed to git so the team and other agents share one graph
rather than each rebuilding it.

**Keep it current — this is part of the closed loop, not optional.**

- **Where it lives:** `.ua/` — `knowledge-graph.json` (the graph),
  `fingerprints.json` (structural fingerprints), `meta.json` (last commit
  analyzed), `config.json` (`autoUpdate: true`, `outputLanguage`). The scratch
  dirs `.ua/intermediate/` and `.ua/.trash-*/` are transient and gitignored.
- **Auto-update trigger:** `.zcode/config.json` registers a `Stop` hook
  (`.zcode/hooks/understand-staleness.sh`) that compares `meta.json.gitCommitHash`
  against `HEAD` at the end of every turn. When the graph is stale it injects an
  instruction to update it. **If that instruction appears, you MUST run the
  incremental update before declaring the task done** — treat it like a red QA
  gate.
- **How to update incrementally (agent-driven, low cost):** the injected prompt
  points at the plugin's `hooks/auto-update-prompt.md`
  (`~/.understand-anything-plugin/hooks/auto-update-prompt.md`). Read it and
  execute its phases — Phase 1 fingerprints changes at zero LLM cost; only
  structurally-changed files (new/removed functions, classes, imports, exports)
  are re-analyzed by `file-analyzer` subagents. Cosmetic-only changes spend zero
  tokens.
- **Skills available** (invoke by name; these live in `~/.agents/skills/`):
  - `/understand` — full rebuild from scratch. Use `--full` to force, or on a
    cold repo. Expensive (dispatches one subagent per file batch).
  - `/understand-diff` — preview the architectural impact of a diff **before**
    committing. Run this when a change is non-trivial.
  - `/understand-explain` — ask "what is X / how does feature Y work" and get an
    answer grounded in the graph.
  - `/understand-onboard`, `/understand-domain`, `/understand-chat`,
    `/understand-dashboard`, `/understand-knowledge`, `/understand-figma` —
    exploration and specialized views.
- **Never** hand-edit `knowledge-graph.json` / `fingerprints.json`. If the graph
  is corrupt or wildly stale, run `/understand --full` to re-baseline.

---

## Local dev quick reference

- **Agent context engineering:** see [`docs/context-engineering/playbook.md`](docs/context-engineering/playbook.md) — the system-prompt builder, lanes, tool-selection, and governance mapped to code.
- Start everything: `make dev` → Postgres `:5441` · Redis `:6391` · Backend `:3001` · Frontend `:7174` · Adminer `:8083`
- First-time setup: `make setup` (infra + migrate + seed)
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

Open http://localhost:7174 and log in with `admin / Abc123`. ✅


# STAGING ACCOUNT

| Username | Role |
| --- | --- |
| admin | ADMIN |
| giamdoc | MANAGER |
| ketoan | ACCOUNTANT |
| laixe | DRIVER |
| giaonhan | FORWARDER |
| khachhang | CUSTOMER |

https://vantai.tingting.vip/

All password Abc123
