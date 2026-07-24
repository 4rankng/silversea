# Fix vantai.tingting.vip "bricked logout" + stale-shell cluster

> **Status: ⏸️ PENDING APPROVAL** — ralplan consensus reached (Planner → Architect `proceed-with-changes` → Critic `ITERATE → APPROVE-able`). **No code or deploy changes were made.** Execution requires explicit user approval (via team or ralph).

**Date:** 2026-06-24 · **Author:** ralplan consensus (Planner / Architect / Critic) · **Target:** `vantai.tingting.vip` demo

---

## 1. TL;DR — root cause

The 7 issues a human tester reported on the vantai demo are **overwhelmingly a stale-deployment + stale-service-worker problem, NOT source-code bugs.**

- The demo's CI/CD has been **billing-blocked since ~2026-06-16**, so the deployed frontend build predates fixes from **2026-06-22 onward** (route-reactive breadcrumb, collapsed-dropdown CSS, Topbar work, `sw.js` changes).
- **Backend is healthy** (live probe: `GET /api/auth/me → 401` correct; root → `200`).
- **Service worker cache version was never bumped** (`CACHE = 'tingting-shell-v1'`, unchanged), so a stale registered SW keeps serving old chunks. After an inconsistent/partial deploy, `index.html` references chunk hashes the old SW can't supply → the lazy `LoginPage` chunk fails to load on logout → the `<Suspense>` `<PageLoader/>` "Đang tải…" fallback **hangs forever → blank page**. Classic PWA stale-SW brick.
- Only **one genuine HEAD UX gap** (collapsed-icon tooltips) and **one minor robustness gap** (logout idempotency) exist. Everything else is already fixed in `main`.

**Evidence base:** 4 parallel read-only code investigations + git history + live HTTP probes + direct verification of `sw.js`, `main.tsx`, `useAuth.tsx`, `useAuthedQuery.ts`.

---

## 2. Issue verdicts

| # | Reported symptom | HEAD status | Action |
|---|---|---|---|
| 1 | Logout → "Đang tải…" spinner hangs + blank page; root URL also blank | Logout is synchronous (`useAuth.tsx:81-84`), cannot hang in HEAD | **P0 hotfix** (redeploy + SW v2 + chunk self-heal) |
| 2 | Breadcrumb "Đang xem – Tổng quan" frozen; page stays on dashboard | Route-reactive only since `173d9c0d` (06-22); routes render correctly | **P0 hotfix** (redeploy) |
| 3 | "Phân xe" / "Xem chuyến" buttons don't navigate | All navigate correctly (`DashboardPage.tsx:272-301,370-373`) | **P0 hotfix** (redeploy) |
| 4 | MANAGER can't access dispatch/trips | MANAGER has `trips:read/write/delete` (`policy.csv:3-5`); guard admits MANAGER | **P0 hotfix** (redeploy) |
| 5 | Collapsed icons lack tooltips | Native `title=` only (`Sidebar.tsx:58,108`); no rich tooltip, no touch | **P1** (add Tooltip) |
| 6 | Logout off-screen when collapsed | Footer pinned + dropdown `position:fixed` (`app-shell.css:118-128`, 06-22) | **P0 hotfix** (redeploy) |
| 7 | Responsive overflow risk | All grids `minmax(0,1fr)` + reflow; fluid hand-rolled SVG charts (no Recharts) | **No action** (verified healthy) |

---

## 3. The plan

### P0 — Hotfix (exactly **3 code changes** + verify-gated deploy)

> Scope discipline: the hotfix commit contains ONLY `sw.js`, `main.tsx`, and the new `lib/chunk-error.ts`. The logout idempotency guard was moved to P1 (non-causal; keeps the hotfix diff auditable).

**Step 0 — Verification GATE (read-only, BEFORE any code).** SSH to `/opt/vantai`:
- Record the deployed git rev and the deployed `sw.js` `CACHE` value.
- `curl` the deployed `/index.html`, extract one referenced chunk URL, fetch it — confirm presence/absence against the index references.

  **Abort/branch logic (tightened per Critic):**
  - **Abort → re-plan** ONLY if: deployed rev is current AND all chunks exist and match `index.html` AND a **fresh incognito window (no SW, no cache) ALSO bricks**. That would prove a real HEAD defect, not staleness — stop and re-investigate the logout/render path.
  - **Proceed + log** if: the deployed rev is stale (expected), OR chunks mismatch index.html, OR the brick only reproduces in a normal window (cached shell) but not incognito. All three resolve to the same fix. Record which case was found for the postmortem.

  > Note: the tester's observed frozen breadcrumb already strongly indicates staleness; this gate confirms the specific brick mechanism and guards against acting on a wrong premise.

**Step 1 — `frontend/public/sw.js` (ONE line).** Bump `const CACHE = 'tingting-shell-v1'` → `'tingting-shell-v2'`.
- `install`'s `self.skipWaiting()` and `activate`'s cache-purge (`k !== CACHE`) + `self.clients.claim()` **already exist** (verified `sw.js:16-29`). The purge drops every `v1` cache on first activation of the new SW.

**Step 2 — `frontend/src/main.tsx` (SW lifecycle — the real gap).**
- Register with an `onUpdate` callback and add a `navigator.serviceWorker.addEventListener('controllerchange', …)` listener that **reloads the page once** when a new SW takes over, so the open tab picks up the new module graph (today the tab keeps the old in-memory graph even after the new SW claims it — verified `main.tsx:31-37` has no such handling).
- Guard the reload against loops with a `sessionStorage` flag.

**Step 3 — `frontend/src/lib/chunk-error.ts` (new) + wire from `main.tsx`.**
- Global handler for failed dynamic imports / `ChunkLoadError`: purge SW caches (`caches.keys()` → `delete`) and force-reload, so ANY stale-chunk load self-heals instead of hanging on "Đang tải…".
- **Loop-cap spec (prevents a reload bomb under broken-deploy):**
  1. Increment a `sessionStorage` counter **unconditionally on entry**.
  2. If counter `> 1`: do **not** reload — instead render a visible Vietnamese fallback ("Phiên bản mới đã sẵn sàng — vui lòng tải lại trang") and stop.
  3. Else: clear caches + `window.location.reload()`.

**Step 4 — Deploy HEAD to vantai consistently** (frontend + `sw.js` + backend together).
- `make push` + manual SSH deploy to `/opt/vantai` (per project memory: `make deploy` is NEPO-only; CI billing-blocked since 06-16). The v2 SW purges v1 caches on first activation.

**Step 5 — Verify** on the previously-bricked browser: reload once → SW updates → caches purge → re-test all 7 symptoms + confirm chunk-error self-heal (simulate a missing chunk locally).

### P1 — Separate commits (after hotfix stabilizes)

- **Collapsed-icon Tooltip** (`Sidebar.tsx:58,108`) — replace/augment native `title=` (which has ~1s delay and no touch support).
- **`logout()` idempotency guard** (`useAuth.tsx:81-84`) — short-circuit redundant `setQueryData(null)` when already logged out, so re-entrant `logout()` calls from `useAuthedQuery` during teardown don't trigger extra re-renders. **Non-causal hardening** (with global `retry:false` it is not a loop) — deferred out of the hotfix per Critic.

### P2 — DROPPED (scope-creep)

- ~~Rename `adminOnly` → `officeOnly`~~ (`App.tsx:95`). It is a **misnomer but not a behavioral defect** — MANAGER is correctly admitted. Dropping it keeps the hotfix surgical (Architect + Critic both flagged this).

### P3 — Prevent recurrence (process/infra, tracked separately, non-blocking)

- Either **restore CI/CD billing**, or formalize a **vantai manual-deploy runbook**.
- Add a **build-hash / `/version` indicator** (topbar stamp or endpoint) so demo staleness is visible at a glance next time — this is the root root-cause: the demo silently drifts because deploys are manual and invisible.

---

## 4. Acceptance criteria (testable)

1. On the previously-bricked browser, after one reload, logout returns to the login page within ~2s — no "Đang tải…" hang, no blank page.
2. Root URL `/` never renders blank (login if logged out, role-home if logged in) on the affected browser.
3. Sidebar nav updates the "Đang xem – <page>" indicator to match the route — assert the displayed string equals `titleForPath('/dispatch')` / `titleForPath('/trips')` from **`frontend/src/lib/routes.ts`** (source-of-truth, not a hardcoded string).
4. "Phân xe" and "Xem chuyến" navigate to `/dispatch` and `/trips` respectively.
5. MANAGER (Lê Văn Tính) can open `/dispatch` and `/trips` and see data.
6. **Cache Storage check (linchpin):** after the reload, DevTools → Application → Cache Storage shows **only `tingting-shell-v2`** — no `tingting-shell-v1` entries remain.
7. Collapsed sidebar icons show a tooltip on hover (desktop) — P1.
8. **Chunk-error self-heal:** simulating a stale chunk (rename an asset, reload) triggers **one** auto-recovery reload, then a visible Vietnamese message — no infinite loop.
9. No regressions: `tsc` clean across the 3 packages; frontend unit tests pass; manual smoke login → dashboard → dispatch → trips → logout.

---

## 5. ADR

- **Decision:** Treat the reported cluster as a stale-deployment + stale-service-worker problem. Ship current HEAD to vantai with a SW cache-version bump (`v1→v2`), a `controllerchange` reload-once handler in `main.tsx`, and a self-healing chunk-error handler. Add collapsed-icon tooltips + a logout idempotency guard as separate follow-ups. Defer CI restoration + build-hash visibility to P3.
- **Drivers:** Backend healthy; breadcrumb freeze impossible in HEAD (route-reactive since 06-22); SW cache never version-bumped; classic PWA brick symptom; demo CI billing-blocked since 06-16.
- **Alternatives considered:**
  - *Code-only (skip deploy)* — rejected: doesn't fix what the tester sees on the stale demo; solves nothing user-facing.
  - *CI-restoration-first* — deferred: billing likely out of scope now and would block the urgent unstick.
  - *Rename `adminOnly` in the hotfix* — rejected: scope-creep, no behavioral defect.
- **Why chosen:** Lowest-risk path that resolves every reported symptom, eliminates the brick failure mode for any user with a stale SW, and keeps the hotfix to 3 auditable code changes.
- **Consequences:** Demo gets current code; users with old SWs self-heal on next load; minor tooltip + logout-hardening gains later. Requires a manual deploy now; CI remains broken (tracked as P3).
- **Follow-ups:** Restore CI/CD billing or formalize the manual-deploy runbook; add build-hash visibility; (optionally) fix the two known SW silent-drop bugs (`PUSH_NOTIFICATION` / `NOTIFICATION_CLICK` listeners) — explicitly OUT OF SCOPE for this hotfix.

---

## 6. Verification summary

- **Read-only pre-checks** (Step 0 gate) before any code/deploy.
- **`tsc` + unit tests** after code changes (AC#9).
- **Browser smoke after deploy** against all 7 symptoms on the affected browser profile AND a fresh incognito profile.
- **Cache Storage inspection** (AC#6) — the single most important check; if `v1` chunks survive, the brick persists.
- **Local chunk-simulation** (AC#8) to validate the loop-cap logic (cannot be re-tested on the live demo without a broken build — acceptable).

---

## 7. Execution path (on approval)

`pending approval` → on explicit user sign-off, execute via:
- **`/oh-my-claudecode:team`** (parallel — recommended): P0 hotfix (Steps 1-3) as one focused task; P1 tooltip + logout-guard as separate tasks.
- **`/oh-my-claudecode:ralph`** (sequential): P0 → verify → P1, with the Step 0 gate and AC#6 as verify checkpoints.

Steps 0, 4, 5 (SSH verify + deploy + browser verify) are operational and not agent-executable — the human/operator owns those; agents prepare the code and run `tsc`/tests.
