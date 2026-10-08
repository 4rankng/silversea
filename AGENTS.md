# AGENTS.md — SilverSea Agent Contract

This is the canonical contract for Codex, Claude Code, opencode and subagents.
SilverSea/TransTing is a pnpm transport-management monorepo: `shared/` contracts
and calculations, `backend/` Express/Drizzle/Postgres/Casbin, and `frontend/`
React/Vite. `CONTEXT.md` selects task context; `docs/` records
product decisions; `HANDOFF.md` records local continuity, never product truth.

## 1. Authority order

1. Explicit current user decisions and accepted task scope.
2. This contract: workflow, safety and completion requirements.
3. Accepted decisions in `docs/adr/` and the PRD index `docs/prd/README.md`.
   Pending proposals and document attachments are evidence, not approval.
4. Current implementation, schemas, migrations and tests.
5. Plans for future work; a plan is not completion evidence.
6. Handoff history; verify branch, data, runtime and QA claims before reuse.

Final audit policies are in `docs/adr/2026-10-01-audit-todo-policy-rulings.md`:
nonnegative trip inputs, DRAFT shipment creation with later progression, and
CUS **read** access to the active quotation-fee catalog. The last SUPERSEDES
that ADR's original "CUS access stays restricted" clause (amended 2026-10-03;
landed `c27875f5`) — read the ADR, not a summary of it, or you will revert a
superseded decision. Cite these rulings by ADR name rather than a `D` number:
`D02` already names a different owner law (card 20261002_293, a computed
financial zero is a value). Do not reopen an owner decision without a new
instruction.

## 2. Non-negotiables

- Local development only by default. Never access production UI/database or
  write production data. Deployment requires explicit owner instruction.
- Trunk only: no new branches, worktrees or self-authored PRs. Append-only Git:
  no reset, amend, rebase or force-push. Preserve unrelated work. See §4.
- Drizzle for application database behavior; no raw SQL escape hatch.
  Financial precision uses shared `round2dp()` / `computeTripTotals()`.
- No stubs, fake data, mock replacements, skipped/deleted failing tests,
  placeholder fixes, lint suppressions or widened types to make gates green.
- Regression case and issue/TODO card before implementation. Fix the whole
  defect class in its shared owner; sweep sibling consumers, not unrelated work.
- Internal IDs never serve as display keys: use Số Bill / Số Booking.
- Nontrivial changes require an independent code-reviewer/verifier pass.
- Report only the execution and evidence obtained; §9 governs UI claims.

## 3. Workflow and context

Understand → Plan → Implement → QA → Fix → Re-QA → Done. Continue until affected
checks pass; a written patch alone is not completion.

1. Read `CONTEXT.md`, then current `HANDOFF.md` if present.
2. Run `pnpm context -- <path-or-task>`. Read returned sources and relevant code/
   tests. If no profile matches, scout then select `--profile <profile-id>`.
3. State output, acceptance criteria, scope, constraints and touchpoints.
4. Record regression/TODO case, implement, run affected gates and obtain review.
5. Controller alone updates the bounded handoff and runs `pnpm context:check`.
   Subagents write `plans/.../reports/`; preserve concurrent work.

Select the smallest relevant skills, read each fully and announce why.
Use `postgres-drizzle` for PostgreSQL/Drizzle work; also use
`drizzle-safe-migrations` for backfills, constraints, deployment order/rollback.
Match installed versions and repo pnpm commands. Never put secrets, customer
records, machine paths or transient output into the context manifest.

### Required UI routing

Read `docs/design-system/README.md` and `docs/design-guidelines.md` before UI
changes. One pattern, one shared implementation: never override shared design
bands with page-local variants. Use the paid catalogs before inventing layouts:

| Catalog | Purpose | Required discovery |
|---|---|---|
| Untitled UI PRO | Component source | `search_components` / `get_page_templates`, then `get_component` / `get_component_bundle`; version 8, returned `pnpm uui:add:*` from frontend. `search_icons` for icon names. |
| Tailkit UI | Layout reference | `browse_catalog` then `get_component_code` with actual plural ids such as `a-c-tables-13`. |

Never paste Tailkit classes/dependencies: rebuild layout with house tokens.
See `frontend/docs/untitled-ui.md` and `frontend/docs/tailkit-ui.md`. Record the
catalog/component id consulted, or deliberately chosen house primitive and
reason. If unavailable, record that limitation; do not pretend consultation.

Current owner design decisions: opaque form surfaces; consistent emerald house
tokens; ordinary controls at most 40px on every screen; coefficient 72×30px;
compact facts and useful content density; responsive wrapping without clipping;
rounded dialog corners clipped by the shared surface; dimmed dialog backdrop;
errors in accessible toast/popover without filter-height jumps; visible filters
when width permits; static status text must not look actionable. Retain all
labels, values and keyboard access. No invented signed-trip-input permission.

Drive changed screens and affected siblings at 390/768/1440. Use
`cd frontend && pnpm design:lock` only for an approved look. The full route
sweep is `node role-ui-sweep.mjs` from frontend when required by task scope;
explicit owner exclusions take precedence. Maximum five audit-owned Chrome
windows concurrently; reuse them and preserve unrelated windows.

## 4. Git workflow

Work in the existing trunk checkout, including an existing `prod` checkout.
No `checkout -b`, `switch -c`, `branch` or `worktree add`. Surface existing
branches/worktrees; obtain direction before merging/deleting them. Do not
push or delete remote branches without explicit instruction. Fetch only when
needed by authorized scope, such as a patch against the latest requested base.

Land via affected green gates → independent review → trunk commit. Never bypass
a failed gate to satisfy an automatic commit rule. Undo through revert/forward
fix. For patch delivery preserve local changes; prove apply/reverse against the
requested base in a plain directory without a branch/worktree or history rewrite.

## 5. Affected QA gates

Save exact command, complete output and exit status for each run under `qa/`.
Run every gate the change can affect; fix failures rather than weakening checks.

| Gate | Command | Required result |
|---|---|---|
| Root lint | `pnpm lint` | 0 errors |
| Backend typecheck | `cd backend && npx tsc --noEmit` | 0 errors |
| Backend tests | `cd backend && pnpm test` | all pass |
| Frontend typecheck | `cd frontend && npx tsc -b` | 0 errors |
| Frontend tests | `cd frontend && pnpm test` | all pass |
| Build | `make build` | succeeds |

Shared contracts, schema, RBAC or financial calculation changes require the full
set. Docs-only changes require their context/link checks.
The versioned hook `scripts/githooks/pre-commit` is wired through
`core.hooksPath`/pnpm prepare. It typechecks affected packages and test files:
backend test changes use test-inclusive tsconfig, not build-only config.
A justified `--no-verify` is never evidence of a green compile gate.

## 6. Regression plan

Before implementation, add every reported bug to `testplan/` with case ID,
reproduction steps and expected behavior. Extend meaningful existing tests.
Re-run the case before reporting completion; cite its ID and evidence.

## 7. QA artifacts

Naming: `qa/<YYYY-MM-DD>_<scope>_<gate>.<ext>`. Record pass and fail outputs,
including the repair and green rerun. `qa/` is ignored except force-tracked
artifacts; never assume these files exist in a fresh clone or delivered patch.
Do not include accounts, secrets or private customer data in exported artifacts.

## 8. Definition of Done

Behavior implemented and executed; all affected gates green; independent review
resolved; no skip/stub/placeholder workaround; relevant docs/regressions updated;
QA artifacts saved; UI claims satisfy §9 with design provenance. State remaining
coverage explicitly. Never label partial implementation or packaging as complete
product acceptance.

## 9. UI verification contract

| Rung | Label | Evidence |
|---|---|---|
| 0 | NOT TESTED | No execution of this path. |
| 1 | CODE-READ ONLY | Source/schema review, no real UI execution. |
| 2 | DB/API VERIFIED | Actual database/API evidence; UI not driven. |
| 3 | UI DRIVEN | Actual control clicked; screenshot/DOM and persisted side effect captured. |

Use a rung per bug, never transfer coverage between bugs. Automated unit/compile
results are separately stated; they do not imply UI DRIVEN. Reserve UI behavior
claims such as "works end-to-end" or "fixed and tested" for rung 3.

Default: drive the real changed control before the report. Prepare local auth/
server first (`puppeteer-spa-auth`, `make dev`); inject token before SPA navigation
and ensure the screenshot is the actual target, not login. Capture real errors.
Do not promise a click after handoff or ask the user to do authorized local QA.
If execution fails, say which path failed, why and its actual rung; retain the
failure evidence. Explicitly excluded exhaustive visual sweeps are not blockers
for scoped fixes, but do not imply omitted paths passed.

A UI DRIVEN claim requires paths to all four:
1. Screenshot after the click: `qa/<date>_<scope>_ui-<step>.png`.
2. Post-click DOM/text assertion with actual success/error text.
3. Database side-effect proof (query and row output); for read-only changes,
   capture unchanged relevant persisted state and expected API/data identity.
4. Driver command/script log with exit status: `qa/<date>_<scope>_ui-driver.log`.

Record environment, account role, concrete Bill/Booking/plate and catalog/
component provenance. UI tasks end with this coverage table; every Not covered
cell names an actual limit (roles, widths, staging, error/rollback path):

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Specific claim | UI DRIVEN or lower rung | artifact paths | explicit limits |

## 10. Tracker and domain

GitHub Issues: `4rankng/silversea` via gh; see `docs/agents/issue-tracker.md`.
Canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`; see `docs/agents/triage-labels.md`.
Domain loading: `CONTEXT.md` and `docs/adr/`; see `docs/agents/domain.md`.

## 11. Environment and source navigation

`make dev`: Postgres :5441, Redis :6391, backend :3002, frontend :7175,
Adminer :8083. First setup: `make setup`; health `http://localhost:3002/api/health`.
All accounts belong only in `testplan/testaccounts.txt`; never duplicate them.
Backend layering: `docs/backend-architecture.md`; context guidance:
`CONTEXT.md`. Production prohibition remains in §2.

Use available code-review-graph tools first to narrow code/impact/review scope,
then verify source and relevant tests. Empty/unindexed graph results are not
negative evidence; fall back to scoped source searches. Useful tools:
`semantic_search_nodes_tool`, `query_graph_tool`, `get_impact_radius_tool`,
`detect_changes_tool`, `get_review_context_tool`, `get_affected_flows_tool`.
Source wins when a graph is stale or models a relationship incompletely.

`repowise` (CLI at `~/.local/bin/repowise`, plus MCP tools) is available to narrow search and impact scope. Its index is GENERATED output: the source-wins rule above governs it regardless of what the index claims, and an index that is stale, partial, or `upgrade: pending` is never a reason to skip reading the source. The block this paragraph replaces was removed 2026-10-03 (card 20261002_301) because it instructed agents to "trust the index, never re-read" — the opposite of the rule above — while its own index sat 411 commits behind HEAD.

<!-- REPOWISE_DISTILL:START — Do not edit below this line. Auto-generated by Repowise. -->
### Output Distillation

- Prefer `repowise distill <cmd>` for noisy commands — test runs, builds, `git status`/`log`/`diff`, searches, file listings. It runs the command unchanged (exit code preserved) and prints a compact, errors-first rendering; every error line survives.
- Output may contain a marker like `[repowise#a1b2c3d4e5f6: 230 lines omitted (~6.1k tokens); restore: repowise expand a1b2c3d4e5f6]`. The omitted content is fully preserved — run `repowise expand <ref>` to retrieve it, or `repowise expand <ref> -q <regex>` for just the matching lines.
- Never re-run a command to see omitted output; expand the marker instead.
- For structure-level questions about a large indexed file ("what's in here", "which function handles X"), `get_context(["path"], include=["skeleton"])` returns the file with bodies elided — every signature plus the bodies of the most central symbols — at a fraction of the cost of a full Read.
<!-- REPOWISE_DISTILL:END -->
