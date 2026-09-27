# AGENTS.md — Silversea Agent Contract

Every bugfix/feature: update `testplan/` first, re-test before marking done. **Every user-reported bug must also land a regression case in `testplan/`** (repro steps + expected behavior + case ID) before its fix is reported done, so the same bug cannot regress silently — cite the case ID in the fix report and re-run it before any deploy.

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
- **Never claim "tested" or "verified" without browser interaction evidence.** Reading code, running API calls, or querying the database does NOT count as testing. If you clicked a button in the browser and saw the result, say what you clicked and what happened. If you didn't interact with the UI, say "NOT TESTED — I only analyzed the code." Lying about testing is worse than not testing.

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

Applies to every bug fix or feature with a user-visible surface, in local dev (`http://localhost:7175`) or staging (`https://vantai.tingting.vip/`).

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
- State the environment for any UI claim: local dev or staging, account used, and the concrete object tested (BL / shipment code / plate).

### Default action: click

For a UI bug, the **expected and default action is to click the actual button** in a real browser and observe the real outcome. Reasoning from code is the fallback, not the shortcut.

- **Do not avoid clicking.** Phrases like "the user can verify in their browser", "the logic clearly handles this", "I've reasoned through it, looks correct", "skipping the click to save time" are all **refusals to test** — treat them as such and click.
- **Do not be afraid of the click.** A red error toast, a 500, a broken dialog — that is *useful evidence*. Catching it in QA is the whole point. Clicking and seeing the failure is better than reasoning and reporting a fake pass.
- **Do not be lazy about setup.** If the browser driver / auth / dev server isn't ready, **set it up first** (puppeteer-spa-auth skill, `make dev`, seed data), then click. Don't downgrade the claim because the harness was inconvenient.
- **No "I'll do it later".** A click promised after the report is a click that will never happen. Click before writing "fixed".
- **No "I see the dialog is already open, let me just describe it".** Describe = rung 1. Click = rung 3. The difference is non-negotiable.

If, after genuinely trying, the UI cannot be driven (sandbox without browser, environment broken, blocker outside your control), say so in the first sentence with the reason, label as `NOT TESTED` or `DB/API VERIFIED` as appropriate, and ask whether to invest in the driver or hand off the click-through. Never paper over the gap with confident-sounding prose.

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
- **Design law book:** [`docs/design-guidelines.md`](docs/design-guidelines.md) — every standing UI ruling as law (data cells text-only, no pills, icons-for-actions-only, semantic colors, contrast, density, tables, empty states); every UI change obeys it.
- **Context engineering:** [`docs/context-engineering/playbook.md`](docs/context-engineering/playbook.md)
- Start: `make dev` → Postgres `:5441` · Redis `:6391` · Backend `:3002` · Frontend `:7175` · Adminer `:8083`
- First-time setup: `make setup`
- Backend health: http://localhost:3002/api/health
- Drizzle ORM only — **no raw SQL**. Financial precision via `round2dp()` / `computeTripTotals()`.

## Accounts & credentials

All logins for every environment are centralized in [`testplan/testaccounts.txt`](testplan/testaccounts.txt) — users, roles, URLs, the shared password rule, and scripted-testing API notes. Do NOT add or duplicate account data in this file; update the canonical file only.

Staging: https://vantai.tingting.vip/

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

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
