# AGENTS.md — SilverSea Agent Contract

SilverSea (TransTing) is a road-freight transport management system: shipments, containers, trips, drivers, customs, and accounting. pnpm monorepo — `shared/` (Zod contracts, types, financial calculations), `backend/` (Express 5, Drizzle ORM + Postgres, Casbin RBAC), `frontend/` (React + Vite SPA), `e2e/` (authenticated product flows).

**This file is the canonical contract for every agent runtime** (Claude Code, Codex, opencode, subagents). Other surfaces each serve one job: `CONTEXT.md` = what to load per task; `docs/` + `docs/adr/` = domain knowledge; `HANDOFF.md` = local task state. Nothing overrides this file except an explicit, current user decision.

## 1. Authority order

When sources disagree, use this order:

1. Explicit user decisions and accepted scope for the current task.
2. This contract (workflow, safety, Definition of Done).
3. Accepted/modified SilverSea decisions in `docs/prd/business-logic-qa-proposals.md` — `pending` proposals are not approved requirements.
4. Current code, schemas, tests, and migrations for implemented behavior.
5. Active phase plans in `plans/` for intended future work — a plan is not proof of completion.
6. `HANDOFF.md` for continuity only; verify drift-prone claims before acting.

## 2. Non-negotiables

- **Trunk-based git.** No branches, no worktrees, no PRs against yourself (§4).
- **Git history is append-only.** Never `reset`/`amend`/`rebase`/force-push; undo with `revert` or a forward fix.
- **Production is untouchable.** No agent ever writes the prod database, logs into prod, or taps prod UI. Deploy only on explicit owner instruction; implementation authorization is never deploy authorization.
- **Drizzle ORM only — no raw SQL** in application behavior. Financial precision only via `round2dp()` / `computeTripTotals()` (`shared/src/calculations/`).
- **No stubs, mocks, `test.skip`, `TODO` placeholders, or fake data.** If a gate is red, fix the root cause — never weaken tests, `eslint-disable`, broaden types, or skip/delete failing tests.
- **Never self-approve.** Authoring and review are separate passes; non-trivial changes go through `code-reviewer`/`verifier`.
- **Never claim "tested"/"verified" without the evidence of the claimed rung (§9).** Lying about testing is worse than not testing.
- **Testplan first.** Every bugfix/feature updates `testplan/` before it is done (§6).
- **Tickets before fixes.** The card lands in TODO before any fix work starts.
- **Sweep the class, not the instance.** Fix the instance and sweep the same defect class in the same breath.
- **Internal IDs are never user-facing.** Số Bill / Số Booking is the display key.

## 3. Workflow: closed-loop SDLC

Every task runs **Understand → Plan → Implement → QA → Fix → Re-QA → DONE**. "Done" means all gates green — not that code was written. Loop Fix ↔ Re-QA while any gate is red.

### Context loading

1. Read `CONTEXT.md` and `HANDOFF.md` (if present). `HANDOFF.md` is local state, not product truth; keep it to the field list in `CONTEXT.md` ("Task state and handoff").
2. Resolve task-specific context: `pnpm context -- <changed-path-or-task-keyword>`.
3. Read only returned sources plus code around the target. No bulk-loading. If the resolver returns no profile: scout with `rg`/code intelligence first, then `pnpm context -- --profile <profile-id>`.
4. State expected output, acceptance criteria, scope, constraints, and touchpoints before implementing.
5. Before handoff: the controller updates `HANDOFF.md` and runs `pnpm context:check`. Subagents report via `plans/.../reports/` only.

`.codex/context-manifest.json` must never contain secrets, machine-specific paths, customer data, or transient output.

### Skill selection

Before any task, select the smallest relevant skill(s). Read each `SKILL.md` fully before acting. Announce selections and why.

**Mandatory tool routing:**

- **PostgreSQL / Drizzle ORM** → `postgres-drizzle` skill; match the installed Drizzle version and existing patterns. Data backfills, constraint tightening, deployment ordering, or rollback → also `drizzle-safe-migrations` (replace its generic examples with this repo's `pnpm` commands).
- **Any UI/UX design problem** — layout, component choice, interaction pattern, form, table, dialog, empty state, density, visual polish → **use the paid UI catalogs before inventing anything.** Actively call them; not using them wastes the licence and produces worse UI.

  | Catalog | Role | Tools |
  |---|---|---|
  | **Untitled UI PRO** (`untitledui` MCP) | The repo's component **source** | `search_components`, `get_page_templates` to discover · `get_component` / `get_component_bundle` for the install command · `search_icons` for exact `@untitledui/icons` names. Pass `version: 8`. Run the returned `pnpm uui:add:*` from `frontend/`. |
  | **Tailkit UI** (`tailkit` MCP) | **Pattern reference only** | `browse_catalog` → real ids (they are **plural**: `a-c-tables-13`, `m-s-pricing-01`) · `get_component_code` for the layout idea. |

  - **Never paste Tailkit class names into this repo.** Its components are built on a `secondary-{50..900}` colour ramp, `@headlessui/react`, and Heroicons `hi-*` classes this project does not have — it renders colourless or breaks the build. Take the *layout*, rebuild it in house tokens.
  - Paths: [`frontend/docs/untitled-ui.md`](frontend/docs/untitled-ui.md) · [`frontend/docs/tailkit-ui.md`](frontend/docs/tailkit-ui.md).
  - **Report which catalog you consulted** in the handoff, by component id (`a-c-tables-13`) or Untitled component name. A UI decision with no catalog consultation and no stated reason is an incomplete decision — the same bar as a UI claim with no screenshot.

- **Frontend UI work — required reading.** `docs/design-system/README.md` (the system map: which primitive does which job, what is banned, what enforces it) and `docs/design-guidelines.md` (the design law book: dated §-numbered rulings; every UI change obeys it). **One pattern, one implementation** — change the primitive and let pages inherit; never add a page-local variant, and never re-declare a rule a shared band already owns (a page rule with higher specificity silently outranks the band — both 2026-09-27 regressions were exactly this). Lock an approved look: `cd frontend && pnpm design:lock`; all-route × 390/768/1440 sweep: `node role-ui-sweep.mjs` from `frontend/`.

## 4. Git workflow: trunk-based only

- Strict trunk-based development — all work lands on the trunk; the closed-loop SDLC is the safety model, not branches. (The prod deploy checkout lands directly on its `prod` branch under these same rules.)
- **No branches.** Never `git checkout -b`, `git switch -c`, `git branch`, `git worktree add` — applies to skills and subagents too. Exactly one worktree at the repo root.
- Commit directly to the trunk. Implement → QA gates → commit. If tooling refuses, commit anyway rather than branching.
- **No PRs against yourself.** Code review happens through the fix-loop rules and `code-reviewer`/`verifier` agents.
- **Existing branches/worktrees**: surface to the user; ask before merging or deleting.
- **Remotes untouched unless asked.** No push, force-push, or remote branch deletion without explicit instruction.

## 5. QA gates (run after every implementation)

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

Scope to what the change touches — never skip a gate it could affect. Shared contracts, Drizzle schemas, financial calculations (`shared/src/calculations/`), or RBAC changes → the full set including E2E.

**Mechanical compile gate:** a versioned pre-commit hook (`scripts/githooks/pre-commit`, wired by `git config core.hooksPath scripts/githooks` — also auto-wired on `pnpm install` via the root `prepare` script) runs the typecheck table whenever staged files touch a project, and refuses the commit on failure. This enforces "QA gates → commit" for every session sharing this checkout, including sweep commits. Escape hatch: `git commit --no-verify` (justify in the commit body — a red trunk is worse than a delayed commit).

- **Test files are typechecked too (card 20260928_201).** `tsconfig.build.json` excludes `src/tests`, so the hook historically typechecked no test file at all and 4 real type errors reached two landings behind a green hook. When a staged file matches `backend/src/tests/**` or `*.test.ts` / `*.spec.ts`, the hook runs the test-inclusive `tsc --noEmit` (`tsconfig.json`, a strict superset of the build config) and refuses on any error. Commits touching no test file keep the cheaper build-only run. Proof: `qa/2026-09-28_card201_gate-proof.log`.
- **`qa/` is gitignored, so the artifacts this file mandates do not travel with the repo** (`.gitignore:97` ignores `/qa/`; only `qa/qawave-driver.sh` is force-tracked). Save them locally as the gates require, but do not assume a reviewer or a fresh clone can see them.

## 6. Testplan regression rule

Every bugfix/feature: update `testplan/` first, re-test before marking done. **Every user-reported bug must also land a regression case in `testplan/`** (repro steps + expected behavior + case ID) before its fix is reported done, so the same bug cannot regress silently — cite the case ID in the fix report and re-run it before any deploy.

## 7. QA artifacts (`qa/` — mandatory)

Every QA run → one artifact under `qa/`. Pass or fail.

- **Naming:** `qa/<YYYY-MM-DD>_<scope>_<gate>.<ext>` — e.g. `qa/2026-07-25_trip-status_backend-test.log`
- **Content:** exact command, exit status, full output. Failures must include the fix-and-re-run that turned green.

A task is not done without its QA artifacts saved.

## 8. Definition of Done

A task is done **only when all** are true:

1. Code implements the requested behavior — verified by running it.
2. Every affected QA gate is green.
3. Diff reviewed (self or reviewer) for correctness and scope creep.
4. No `TODO`/`skip`/stub/placeholder in the changed surface.
5. Docs updated if user-visible behavior, commands, or architecture changed.
6. All QA artifacts saved under `qa/`.
7. For any UI-facing bug or feature: the **UI verification contract** (§9) is satisfied per claim, **and** the paid UI catalogs were consulted per §3 routing — or a house primitive was chosen deliberately, with the reason stated.

## 9. UI verification contract (anti-lying rule)

Applies to every bug fix or feature with a user-visible surface, in local dev (`http://localhost:7175`) or staging (`https://vantai.tingting.vip/`).

### The claim ladder — never skip a rung, always state which rung you are on

| Rung | Label to use verbatim | What it means |
|---|---|---|
| 0 | `NOT TESTED` | No code executed against this path. Reasoning only. |
| 1 | `CODE-READ ONLY` | Read the code/schema. No execution. |
| 2 | `DB/API VERIFIED` | Ran SQL or hit the API directly. **The UI was never driven.** |
| 3 | `UI DRIVEN` | Clicked the actual control in a real browser session, captured the resulting DOM/screenshot, and confirmed the DB side effect. |

### Rules

- The words *tested*, *verified*, *works end-to-end*, *confirmed*, *fixed and tested* are reserved for **rung 3 only**. Rung 2 must be reported as "DB/API verified, UI not driven".
- Reasoning from code + a DB query is **rung 2**, never rung 3.
- One rung label **per bug/claim**, not per session. Bug A's rung-3 evidence never implies coverage of bug B.
- State the environment for any UI claim: local dev or staging, account used, and the concrete object tested (BL / shipment code / plate).

### Default action: click

The expected and default action for a UI bug is to **click the actual button in a real browser and observe the real outcome.** Reasoning from code is the fallback, not the shortcut.

- **Do not avoid clicking.** "The user can verify in their browser", "the logic clearly handles this", "skipping the click to save time" are all **refusals to test** — treat them as such and click.
- **Do not be afraid of the click.** A red error toast, a 500, a broken dialog is *useful evidence*. Catching it in QA is the whole point; clicking and seeing the failure beats reasoning and reporting a fake pass.
- **Do not be lazy about setup.** If the driver / auth / dev server isn't ready, set it up first (`puppeteer-spa-auth` skill, `make dev`, seed data), then click. Don't downgrade the claim because the harness was inconvenient.
- **No "I'll do it later".** A click promised after the report is a click that will never happen. Click before writing "fixed".
- **No "the dialog is already open, let me just describe it".** Describe = rung 1. Click = rung 3. The difference is non-negotiable.

### Rung 3 requires artifacts — no artifact, no claim

A `UI DRIVEN` claim is valid only if all four exist and are referenced by path in the report:

1. **Screenshot after the click** → `qa/<YYYY-MM-DD>_<scope>_ui-<step>.png`
2. **Post-click DOM/text assertion** showing the expected success or error state (the actual toast/row/status text, quoted).
3. **DB side-effect proof** — the query and its row output (e.g. new `trip` row, updated status).
4. **Driver log** → `qa/<YYYY-MM-DD>_<scope>_ui-driver.log` — the script/commands run, exit status.

Auth for headless runs: the `puppeteer-spa-auth` skill (`evaluateOnNewDocument` injects the token **before** first navigation) — otherwise the SPA silently redirects to login and you will screenshot a login page and call it a pass.

### Mandatory coverage report — end every UI task with this block

```
## Verification coverage
| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| <bug A>     | UI DRIVEN | qa/…png, qa/…log, trip id=14 | mobile viewport, FORWARDER role |
| <bug B>     | DB/API VERIFIED | psql output | never clicked "Thêm nhà xe" |
```

The **Not covered** column must never be empty or "n/a". If nothing else comes to mind, list at least: other roles, mobile viewport, staging vs local, and the error/rollback path. Omitting this block means the task is not done.

### Design provenance — the licensed catalogs are part of the evidence

A UI claim is only complete if you can say where the design came from.

- **State the catalog and the component** you consulted: a Tailkit id (`a-c-tables-13`) or the Untitled UI component name from `frontend/src/components/untitled-ui/installed.json`.
- **Inventing a pattern without looking is a defect**, not a shortcut — it is the named anti-pattern in the design law book ("reference before invention"). The catalogs are licensed; the point of the licence is that agents actually open them.
- Choosing an **existing house primitive** is a legitimate answer — say so, and say why the catalog search confirmed nothing better fits. Silence is what fails.
- Both catalogs are **dark-mode- and brand-blind**: their output is a *layout idea* that must be rebuilt in house tokens. The app is light-only and the brand is TransTing emerald. See [`frontend/docs/tailkit-ui.md`](frontend/docs/tailkit-ui.md) for the port checklist.

### Prohibited phrasings

- ❌ "Verified: the fix works end-to-end" without rung-3 artifacts for *that specific* claim.
- ❌ Reporting multiple bugs under one blanket "tested and fixed".
- ❌ "should now work", "this will fix it" dressed up as verification.
- ❌ Silently downgrading: if the driver failed, report `NOT TESTED — driver failed: <reason>`, never rung-2 wording that sounds like rung 3.

### When you cannot drive the UI

Say so in the first sentence of the report: *"I could not drive the UI for X because Y. Rung: DB/API VERIFIED only."* Then ask whether to invest in the driver or hand the click-through to the user. Do **not** proceed to a confident summary.

## 10. Agent skills

### Issue tracker

Issues live in GitHub Issues (`4rankng/silversea`, via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels are used as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (the pnpm packages are layers of one product sharing one domain language). See `docs/agents/domain.md`.

## 11. Environment & accounts

- **Backend architecture:** [`docs/backend-architecture.md`](docs/backend-architecture.md) — layering rules, naming, god-file split, add-an-entity path; enforced by `backend/src/tests/unit/arch-layering.test.ts`.
- **Context engineering:** [`docs/context-engineering/playbook.md`](docs/context-engineering/playbook.md)
- Start: `make dev` → Postgres `:5441` · Redis `:6391` · Backend `:3002` · Frontend `:7175` · Adminer `:8083`. First-time setup: `make setup`.
- Backend health: http://localhost:3002/api/health
- All logins for every environment are centralized in [`testplan/testaccounts.txt`](testplan/testaccounts.txt) — users, roles, URLs, the shared password rule, and scripted-testing API notes. Do NOT add or duplicate account data anywhere else; update the canonical file only.
- Staging: https://vantai.tingting.vip/

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**This project has a knowledge graph. Start with the code-review-graph
MCP tools to narrow scope, then read the source.** The graph is cheaper than scanning files and
gives you structural context (callers, dependents, test coverage) that file search cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

### Verify in the source

- Narrow scope with the graph, then read the source. Do not change code from graph output alone.
- For any non-trivial change, read the implementation and the relevant tests before concluding.
- Verify the exact source when touching behavior, database logic, migrations, retries, fallbacks,
  recovery, or compatibility code.
- When the graph and the source disagree, the source wins. The graph may be stale or may not
  model that relationship.
- An empty graph result can mean "not indexed" or "not statically visible", not "does not exist".

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
<!-- /code-review-graph MCP tools -->

<!-- REPOWISE_AGENTS:START — Do not edit below this line. Auto-generated by Repowise. -->
## Codebase Intelligence for silversea-prod (Repowise)

Indexed by [Repowise](https://repowise.dev). Last indexed: 2026-09-27 (commit d7c142d). Confidence: 100%.Scope: fast index · none content · essential Git · 1327 eligible file pages omitted. Missing or unavailable evidence is not a negative finding. Run `repowise update --full` to continue the model-backed upgrade (cost is previewed before generation).Machine-readable scope: `{"analysis": {"skipped": ["generation"], "unavailable": []}, "content_provenance": "none", "file_pages": {"configured_cap": null, "effective_cap": null, "eligible": 1327, "generated": 0, "omitted": 1327}, "git_commit_cap": 3, "git_history_coverage": {"complete_through_depth": 2410, "deep_commits": 2407, "deep_files": 2304, "eligible_files": 2305, "fallback_files": 0, "files_with_history": 2305, "global_commits": 3, "per_file_limit": 3, "recent_files": 8, "retained_commits": 4975, "unavailable_files": 0, "workers": 8}, "git_tier": "essential", "provider": {"embedder": null, "model": null, "model_cost_possible": false, "name": null, "reused": false}, "run_mode": "fast", "search": {"full_text": "unavailable", "next_command": null, "semantic": "unavailable"}, "upgrade": {"completed_stages": [], "next_stage": "git_backfill", "retryable": true, "status": "pending"}, "version": 1}`

### How to work in this repo

- **Trust the index.** `verified: true` and `_meta.complete` mean the bytes were checked against the live tree, so never re-read them. Re-read only what `bounds: "approximate"` or `_meta.stale_warning` names. `confidence` rates the prose, not the evidence: on `low` read the `fallback_targets` or `best_guesses` the reply names, and run `repowise update` and ask again if `_meta.hint` says the index is behind HEAD. `index_behind: true` alone is informational.
- **A zero carries its basis.** An empty `callers`/`callees`/`used_by` comes with a `*_basis` saying how much of that language's calls the graph resolved, so read it before concluding nothing calls a symbol. `_meta.scope_hint` names the areas the answer did not touch.
- **Pre-edit, not instead-of-edit.** These tools decide *which* files to read and edit. Reading a file before you edit it is correct and expected.
- **Noisy commands** (tests, builds, `git log`/`diff`, searches, listings): prefer `repowise distill <cmd>`, the same command with its exit code preserved and errors-first output. A `[repowise#<ref>: N lines omitted]` marker is recoverable via `repowise expand <ref>` (add `-q <regex>` to filter); never re-run the command to see omitted output.
- **Recording a decision** you had to reason out: `repowise decision add --title T --decision D` records it without prompting and prints the id (`--format json` to parse it back). It lands `proposed`, for a person to confirm.

### Tools

| Tool | When and why |
|------|--------------|
| `get_answer(question)` | First call for any how/where/why question. Cite `confidence: "high"` or `grounding: "extracted"` directly; `degraded` means judge by `retrieval_quality`. `symbol_bodies` has live bodies. |
| `get_context(targets=[...])` | Triage card for files/modules/symbols: docs, signatures, hotspot, fix history. No source bytes — `include=["skeleton"]` for the whole file verified, `["callers"|"decisions"]` for depth. Batch targets. |
| `get_symbol(id, depth?)` | **Follow-up, not an entry point** — one verified body for an id a prior response named (`path.py::Name`, `path.py:140-180`, `repowise#<hex>`). Never walk a file symbol by symbol; Read it. |
| `search_codebase(query)` | Hybrid search, auto-routed by query shape; force with `mode=symbol|path|concept|hybrid`. A hit whose `sources` are `[fts]` only has no semantic agreement, so verify it. |
| `get_why(query, targets?)` | Why the code is shaped this way: decision records, git archaeology, rationale comments. Call before a refactor or a pattern divergence. |
| `get_risk(targets, changed_files?, include?)` | File history and structural reach. PR mode leads with `directive`; its 0-10 structural heuristic is uncalibrated, not a probability. Read typed test recommendations and coverage state first. |
| `get_change_risk(revspec?, extensions?, exclude_patterns?)` | Deterministic live-diff review signal for a commit or range. Lead with benchmarked percentile/classification; the 0-10 diff-shape score is supporting, not a probability. `get_risk` scores paths. |
| `get_health(targets?, include?)` | Defect / maintainability / performance scores and findings, plus documentation the code no longer supports. Self-check the files you touched before finishing. |
| `get_dead_code(tier?, min_confidence?, safe_only?)` | Confidence-tiered unreachable files / unused exports / zombie packages. For cleanup sweeps, not targeted fixes. |
| `get_overview()` | Architecture map. Call once, first, in an unfamiliar repo; skip it after that. |

### Architecture
**Files:** 2763 | **Lines:** 1292158 | **Monorepo:** 4 packages | **Import cycles:** 15
silversea-prod is a multi-package typescript codebase of 2763 files, split across 4 packages. Execution starts at frontend/src/App.tsx, frontend/src/main.tsx. ---
*Built from the code's structure. It states what is there, not why it is that
way.

### Key modules
- `frontend/src` — frontend/src · frontend/src/context · frontend/src/data
**Language:** typescript | **Files:** 8 | **Public symbols:** 11 / 127
Covers the 8…
- `backend/src/services` — backend/src/services
**Language:** typescript | **Files:** 268 | **Public symbols:** 1932 / 3156
Covers the 268 source files in…
- `backend/src/db` — backend/src/db · backend/src/db/schema
**Language:** typescript | **Files:** 21 | **Public symbols:** 225 / 226
Covers the 21 source files…
- `frontend/src/features` — frontend/src/features/accounting · frontend/src/features/admin-center · frontend/src/features/app-settings ·…
- `shared` — shared · shared/src · shared/src/calculations
**Language:** typescript | **Files:** 18 | **Public symbols:** 84 / 100
Covers the 18 source…
- `shared/src/constants` — shared/src/constants · shared/src/governance · shared/src/navigation · shared/src/schemas · shared/src/types
**Language:** typescript |…
- `frontend/src/lib/api` — frontend/src/lib/api · frontend/src/lib/gps · frontend/src/lib/http
**Language:** typescript | **Files:** 10 | **Public symbols:** 54 /…
- `frontend/src/lib` — frontend/src/lib
**Language:** typescript | **Files:** 37 | **Public symbols:** 126 / 183
Covers the 37 source files in frontend/src/lib
- `frontend/src/api` — frontend/src/api
**Language:** typescript | **Files:** 35 | **Public symbols:** 297 / 321
Covers the 35 source files in frontend/src/api
- `frontend/src/design-system` — frontend/src/design-system · frontend/src/design-system/forms · frontend/src/design-system/hooks
**Language:** typescript | **Files:** 38 |…

### Entry points
- `frontend/src/App.tsx`
- `frontend/src/main.tsx`

### Files that need care (bug-fix history first, then churn — check `get_risk` before editing)
- `frontend/src/pages/ShipmentsPage.test.tsx` — 55 bug fixes, last fix today (bug magnet); 3 commits/90d
- `frontend/src/pages/ShipmentsPage.tsx` — 51 bug fixes, last fix today (bug magnet); 3 commits/90d
- `frontend/src/pages/DriverTripDetailPage.tsx` — 40 bug fixes, last fix today (bug magnet); 3 commits/90d
- `frontend/src/pages/DriverTripDetailPage.test.tsx` — 35 bug fixes, last fix today (bug magnet); 3 commits/90d
- `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx` — 34 bug fixes, last fix yesterday (bug magnet); 3 commits/90d

### Code health
Three co-equal signals: code health 7.63/10 avg (Good), hotspot health 7.13/10 (improving), worst `backend/src/middleware/casbin.ts` at 3.65/10 · maintainability 7.33/10 · performance risk 155 open static I/O-in-loop / N+1 findings. Detail: `get_health()`.

Critical files:
- `backend/src/services/shipment-accounting-lock-reads.service.ts` — complex conditional (getShipmentFinanceConfirmationSummaries) — impact −2.2
- `frontend/src/pages/clerk/ClerkShipmentCreatePage.tsx` — prior defect — impact −2.0
- `e2e/run_all.sh` — prior defect — impact −2.0
- `backend/src/services/cus-shipment-workspace.service.ts` — prior defect — impact −2.0
- `frontend/src/features/shipments/detail/ShipmentMissingFieldsSummary.tsx` — prior defect — impact −2.0

### Commands
- Build: `pnpm build`
- Lint: `pnpm lint`
- Dev: `pnpm dev`

<!-- REPOWISE_AGENTS:END -->

<!-- REPOWISE_DISTILL:START — Do not edit below this line. Auto-generated by Repowise. -->
### Output Distillation

- Prefer `repowise distill <cmd>` for noisy commands — test runs, builds, `git status`/`log`/`diff`, searches, file listings. It runs the command unchanged (exit code preserved) and prints a compact, errors-first rendering; every error line survives.
- Output may contain a marker like `[repowise#a1b2c3d4e5f6: 230 lines omitted (~6.1k tokens); restore: repowise expand a1b2c3d4e5f6]`. The omitted content is fully preserved — run `repowise expand <ref>` to retrieve it, or `repowise expand <ref> -q <regex>` for just the matching lines.
- Never re-run a command to see omitted output; expand the marker instead.
- For structure-level questions about a large indexed file ("what's in here", "which function handles X"), `get_context(["path"], include=["skeleton"])` returns the file with bodies elided — every signature plus the bodies of the most central symbols — at a fraction of the cost of a full Read.
<!-- REPOWISE_DISTILL:END -->
