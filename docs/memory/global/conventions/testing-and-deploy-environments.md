---
name: "testing-and-deploy-environments"
description: "Standing rule: commit + push after every task/chunk — never batch-push at the end"
folder: "global / conventions"
tags: []
updatedAt: "2026-09-10T16:21:53.516Z"
author: "Project Manager (pm)"
---

# Testing & deploy environments (HARD RULE)

**STANDING RULE (user directive 2026-09-09 ~21:09, after an agent live-tested /suppliers on prod):**

- **ALL testing happens on staging: https://vantai.tingting.vip** (`make demo`, ideally from a temp worktree at the pushed HEAD so peer WIP never ships).
- **PROD https://silversea.tingting.vip is the customer's LIVE system. NEVER test there: no QA drives, no test data, no mutations, no "verification" logins that touch state.** Post-deploy prod verification is READ-ONLY only (GET endpoints, row counts, dropdown contents) unless the user explicitly authorizes more.
- Deploy targets from this checkout: `make deploy` = prod (requires prod branch + clean tree); `make demo` = staging.

## Incident record
- 2026-09-09 ~21:00: Bug-B "verification" on prod assigned carrier **HÀ AN** to live fulfillment **EHPH26080202** (LOG COM, no plate). User flagged it. Reversible via the plan editor (READY row); left in place unless the user asks to revert.

## Deploy pipeline mechanics (migrated from Makefile + AGENTS.md, 2026-09-10)

**Local stack:** `make dev` (db `:5441`, redis `:6391`, backend `:3001`, frontend `:7174`, Adminer `:8083`); `make setup` first time; `make stop` (keep db/redis) / `make down` (all).

**Deploy targets:**
- `make demo` — deploy current tree to **staging** (vantai.tingting.vip), keeps existing DB.
- `make deploy` — deploy **prod** (silversea.tingting.vip). Run from the `prod` branch in the silversea-prod checkout; ships AS-IS, keeps DB. Requires prod branch checked out + clean working tree. (This checkout IS the prod deploy checkout.)
- `make deploy-advance` — fast-forward prod branch to origin/main.
- `make deploy-db-backup` — server-side pg_dump of prod DB; run before manual prod data changes (fails on failure).
- `make deploy-server-setup` / `make deploy-seed` — one-time provisioning; idempotent prod master-data seed (`node dist/seed/seed-prod.js`).

**Migration rails (fails closed):**
- `make migrate` — runs drizzle-kit migrations, **backs up first** (`db-backup` prerequisite), fails closed.
- `make db-backup` — timestamped pg_dump to `backups/` (required before any migration apply).
- `make generate` — drizzle-kit generate, serialized via mkdir-lock (no flock on local macOS).
- `make db-drift-check` — asserts `generate` is a no-op on a clean tree (probe-safe guard).
- DB sync (REPLACE target data): `make devdb` (staging → local), `make devdb-prod` (prod → local), `make stgdb` (prod → staging mirror).

**Account/password rule (testplan/testaccounts.txt, 2026-09-06):** EVERY account on staging AND local dev uses password `Abc123`. Staging is a prod mirror (`make stgdb`) — after every sync, re-run the password reset (bcrypt hash of `Abc123` onto `users.password_hash`) so prod-set passwords never leak into staging logins.

**Pre-deploy served-bundle check (PM standard 2026-09-09):** a fix in the local build is not a fix in production. Before declaring a frontend commit done, verify the served bundle matches the local build — fetch the served CSS/JS on staging and confirm the expected rule/chunk hash is present (Vite `[name]-[hash]` content hash MUST flip when the fix changes output). Same hash after push = deploy hasn't run. Full procedure in [[design-system-contracts]].

## Branch protection ruling (user, 2026-09-10 ~03:00 SGT) — BINDING
- **NEVER merge any branch INTO `prod`.** Prod advances only via direct commits made on the prod branch (explicit pathspecs, logical chunks).
- Also in force same session: no git operations touching `main` (user retracted an earlier merge-prod-into-main order). The main→prod merge gate sequence from [[main-prod-merge-readiness]] / scout cdb2f819 stays PARKED until the user explicitly re-authorizes a merge.
- Deploy flow implication: `make deploy` runs from the prod checkout with direct commits on prod (this is how the 2026-09-10 waves shipped). deploy-advance (ff main→prod) is structurally impossible while prod leads main anyway, and is now also ruled out by this protection until the user changes it.

- **Deploy-owner pre-flight check (fullstack, for the search-fix cut and every later cut):** before `make deploy`, verify the prod range contains direct commits only — `git log --merges origin/prod..prod` must be EMPTY (any merge commit in range = STOP and escalate to pm, do not deploy). Full runbook pattern: audit-report addendum §A–E (`plans/reports/pm-260910-responsive-space-audit.md`) — tree guard incl. the 7 plumbing files (AGENTS.md, BACKLOG.md, CONTEXT.md, HANDOFF.example.md, HANDOFF.md, ROADMAP.md, .codex/hooks.json; re-deletion = stop + escalate, never restore-loop), pre-named `pre-cutover-<UTC>.env` rollback snapshot, deploy, 8-row probe checklist w/ bundle markers, numbers to pm.

## 2026-09-10 ~02:00 SGT — HARD STOP on prod probes (user directive, BINDING, supersedes the "READ-ONLY only" wording above)

The "READ-ONLY" carve-out above was too broad and is now narrowed. After tonight's search-fix cut wave `44b16c44`, the user ruled the probe pattern (admin-token mint, authenticated search GETs, deliberate 400-param probe against dispatch-fleet, bundle-marker GETs against prod) constitutes **testing in prod** and is NOT permitted.

**Effective now and permanent — applies to the deploy-owner role and any teammate inheriting prod-deploy duties:**

- **ONLY permitted post-deploy check on prod:** bare unauthenticated `GET /api/health`.
- **PROHIBITED on prod without explicit per-action user approval in advance:**
  - any login / token mint, even one to "verify" something read-only-looking
  - any authenticated API call of any kind (catalogs, bootstrap, shipments, expenses, dispatch-fleet, CUS workspace, etc.)
  - any param-probing (deliberate 400/404 checks against prod endpoints)
  - any bundle-marker GET against prod (entry JS hash, lazy chunks, CSS markers, pattern-attr fingerprint checks)
  - any catalog or search-surface probe on prod
  - any pattern-attr / chunk-fingerprint check on prod
- Anything beyond bare `/api/health` requires the user's explicit per-action approval BEFORE the call. The "tolerated single admin mint" disclosure pattern from previous runs is no longer tolerated.

**Verification moves to staging only:**
- All matrix / fingerprint / pattern-attr / search-surface verification happens on vantai.tingting.vip BEFORE the prod cutover (qa's fingerprint-matched verdict + frontend's acceptance matrix + fullstack's engine verification on the staged build).
- The prod cutover itself is then trusted if the pre-deploy verification was complete — the post-deploy `GET /api/health` is a liveness check, not a verification.

**Audit implication (retroactive):** the 2026-09-10 search-fix cut wave's 11/11 probes include actions that, by the new standard, would not have been permitted. The wave is shipped and live; this is recorded as a future-standard change, NOT a rollback trigger. Going forward, deploy-owners adhere to the new standard.

**Why this matters:** prod is the customer's LIVE system. Every authenticated call against prod is potentially state-touching (audit log writes, last_login_at stamps, rate-limit consumption). Even when a call looks read-only, the customer reads it as testing in prod, which is what triggered the directive.

## BINDING UPDATE (user directive 2026-09-10 ~02:00Z, supersedes the read-only-probes paragraph above)

**NO prod access of any kind by agents**, with exactly two exceptions: (a) the deploy itself via `make deploy`, and (b) at most ONE bare unauthenticated `GET /api/health` after cutover. Nothing else — **no logins, no token mints, no authenticated GETs, no 400-param probes, not even "read-only" API calls** — unless the user explicitly approves that exact action in advance. Trigger: the 09-10 night wave's authenticated prod activity (admin-token mint, authenticated search GETs, a deliberate 400-param probe) was ruled **testing in prod** and is not permitted; the earlier interpretation ("post-deploy verification is read-only GETs/row counts/dropdowns") is RETRACTED. All verification happens on staging (vantai) — prod evidence beyond the health check comes from the deploy pipeline's own built-in gates (which already probe health during cutover).

## Prod-access standard HARDENED (user ruling 2026-09-10 ~10:00 SGT, after authenticated probes on prod)

Supersedes any earlier "prod is read-only probes" interpretation:
- NO logins to prod. NO admin-token mints on prod. NO authenticated API calls. NO param-probing (deliberate 400s). NEVER — see global note [[never-login-production]].
- Post-deploy prod check = bare unauthenticated `GET /api/health` only. Nothing else without the user's explicit per-action approval.
- All authenticated/functional/UX testing on staging (vantai.tingting.vip) with test accounts (`Abc123` on staging/local only — prod passwords are prod-set, agents have none and must never seek them).
- Incident that triggered it: 2026-09-10 fix-wave probes included an admin mint + authenticated search GETs + a deliberate 400 probe on prod; user ruled this "testing in prod" and forbade it permanently.

## Account info DE-DUPLICATED (user ruling 2026-09-10 ~10:45 SGT)

The "Account/password rule" section below is RETRACTED as a duplication: account lists, usernames, and passwords must NOT be copied into docs or memory — everything lives in the canonical, user-maintained `testplan/testaccounts.txt` (in-repo). Any doc or memory note that needs account info links to that file. Enforced in commit `6a4a7bf4` (AGENTS.md + e2e READMEs + testplan READMEs now point to it; stale demo-as-staging tables removed). If a task needs credentials, read `testplan/testaccounts.txt` at that moment — never quote the values into other docs, memory, or chat.

## Commit-push cadence (user directive 2026-09-10 ~14:20 SGT, BINDING)

**After EVERY completed task/chunk: commit AND push immediately.** Gates green → commit (explicit pathspec, logical chunk) → `git push origin prod` → next task. Never hold committed work for a batch push at the end of a ticket — origin/prod must reflect completed, gate-passed work within minutes. The "hold chunks for one final push" strategy is explicitly retracted.

## Staging-test ordering (user directive 2026-09-11, BINDING — refines the deploy rails)

- **Staging testing happens ONCE, after ALL kanban items are delivered** (every ticket's code landed on origin/prod) — not interleaved per-chunk. Local dev remains the per-fix verification environment (Amendment 4).
- Pipeline per wave: land everything (local-verified, gate-passed, architect-approved) → ONE staging cut → full QA verification batch → tickets to done → board empty → prod deploy.
- Deploy-owner: no staging cut until pm confirms all items delivered; no prod until board empty (unchanged). QA: hold environment-dependent cases until the post-delivery cut; bank everything verifiable without it.

- EXPLICIT (user directive 2026-09-11, same session): **during the SDLC, test LOCAL ONLY.** No staging cuts while development is in progress — staging is touched exactly once, after the last kanban item is delivered, for the single pre-prod verification pass. Per-fix verification = local (make dev) exclusively.
