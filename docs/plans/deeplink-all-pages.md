# Plan: Reliable Notification Deeplinks (Clickable Drawer + Silent-Drop Fixes)

> **Status: PENDING APPROVAL** — ralplan consensus loop, round 2 (Planner → Architect → Critic).
> **Revision: 2** (revised after Architect APPROVE-WITH-CONDITIONS + Critic ITERATE).

### Changes from v1
- **Pivoted the route strategy.** v1 proposed a new `shared/src/routes/registry.ts` as "single source of truth." That would have created a THIRD URL source alongside the existing `frontend/src/lib/routes.ts` (which already declares itself the SoT on line 1) and `App.tsx <Route>`. v2 **consolidates into `lib/routes.ts`** instead (see ADR — path (a)).
- **Honest scope.** Added "Scope reality" section: only 3 `relatedEntityType` values are emitted today (trips, payments, penalties); `urlFor()` already covers all 3. There is NO coverage gap. The real value is: (i) fix 2 silent-drop bugs, (ii) make the drawer clickable, (iii) drift-proof the NEW second builder, (iv) `/edit` deeplink for trips.
- **Dropped `FRONTEND_URL` / `toAbsolute` / AC8 / Phase 4.** Path-only URLs work for both `openWindow` (SW resolves relative against `self.location.origin`) and `postMessage`. Eliminates the `process.env`-in-`shared/` hazard entirely (`shared/` has ZERO `process.env` today and ships ESM to Node + browser).
- **Fixed AC1** to test emitter reality (grep call sites) instead of a phantom `NotificationEntityType` union (which does not exist — `relatedEntityType` is `string | null`).
- **Added AC5b** — `PUSH_NOTIFICATION` listener that invalidates the TanStack notifications cache (v1 only fixed the click).
- **Trimmed the builder to the 3 real emitters.** Entities with no emitter (expenses, forwarder_settlements, customers, debt, payables, advances, fuel/config:*, salary_periods, users, audit_logs) moved to "Future (requires emitter)" appendix. Misleading `action:'new'` examples dropped.
- **Fixed `Role` import** (`shared/src/constants/index.ts:19`, enum — not `../types/auth`).
- **Promoted route-existence test to Phase-1 CI gate.**
- **Deferred generic `views`/`action` machinery.** Only `trips` has BOTH an edit route AND an emitter; special-case it, don't build a generic map.
- **Resolved FORWARDER penalty routing** → `/my-settlements` (no penalties route exists for FORWARDER).
- **Made stale-comment cleanup a definite Phase-1 task** (not an open question).
- **Rewrote ADR** with honest drift framing (latent, not active) and a real steelman of path (b).
- **Replaced weak AC7 snapshot** with explicit (entity, role) → path assertions.
- **Added Critic items:** iOS Safari push scope-out + rationale, `tag`/`renotify` last-wins behavior, SW-listener kill-switch, `/expenses/*` adminOnly note (moot after trim).

---

## Scope reality (read first)

The codebase emits EXACTLY three `relatedEntityType` values across all `createNotification` call sites:

| Value | Call sites (verified) |
|---|---|
| `'trips'` | `backend/src/routes/trips.ts:182,213,238,274`; `backend/src/services/trip-command.service.ts:51,82` |
| `'payments'` | `backend/src/routes/financial/payments.routes.ts:33` |
| `'penalties'` | `backend/src/routes/financial/penalties.routes.ts:34,50` |

The existing `urlFor()` (`backend/src/services/notification.service.ts:146-160`) **already returns a path for all three.** There is NO coverage gap today.

Of these three, **only `trips`** has BOTH an `/edit` route (`App.tsx`) AND an emitter. `/expenses/:id/edit`, `/expenses/new`, `/my-settlements/new` exist as routes but NOTHING emits a notification that would deep-link to them — so "deeplink to /new" is NOT achievable until emitters are added, which is OUT OF SCOPE here.

**Therefore the plan's actual value is:**
1. Fix 2 silent-drop bugs (the `PUSH_NOTIFICATION` and `NOTIFICATION_CLICK` `postMessage`s have no frontend listener).
2. Make the in-app drawer clickable (currently inert rows).
3. Drift-proof the NEW second builder (the clickable drawer) against `lib/routes.ts` + `<Route>` via a CI gate.
4. Enable `/edit` deeplink for trips specifically (the one entity where it's achievable).

This is reframed from v1's "deeplink to ALL pages," which overpromised.

---

## RALPLAN-DR Summary

### Principles
1. **One frontend URL source: `lib/routes.ts`.** It already exists, already declares itself the single source of truth, and already covers every parameterized path plus `homeForRole()`. The clickable drawer MUST import from it — not from a new module. (v1 violated this; v2 corrects it.)
2. **Never silently drop a click.** The SW posts both `PUSH_NOTIFICATION` (drawer refresh) and `NOTIFICATION_CLICK` (navigate); NEITHER has a frontend listener today. Both must be handled. This is a correctness bug, not a nicety.
3. **Honest degradation over wrong links.** If a (entity, role) pair has no dedicated route, link to the role's home or owning list — never fabricate a `/foo/:id` that 404s. Blank > wrong.
4. **Role-gating lives with the path builder.** A DRIVER must never receive an admin `/trips/:id` link. The builder encodes per-role resolution; callers pass `(entityType, role)` and trust the result.
5. **URLs may carry DB ids; UI text may not.** Internal `:id` path segments are fine (consistent with `/trips/:id`, `/debt/:id`). The "no raw IDs" convention governs visible labels, not URL internals.

### Decision Drivers (top 3)
1. **Enable the new second builder safely.** The clickable drawer is a NEW deep-link builder in the frontend. Its drift risk vs `lib/routes.ts` + `<Route>` is the immediate thing to manage — not "active drift" (there is one builder today; drift is latent).
2. **Correctness of the click path.** Two `postMessage` types are silently dropped. This is the highest-user-impact fix.
3. **Rollout safety.** Push is in production; the change must be additive and shippable in small increments.

### Viable Options

**Option A — Consolidate into `frontend/src/lib/routes.ts` + a co-located `buildNotifPath()` helper (CHOSEN).**
Extend the existing `routes` module with the role-scoped + entity-keyed helpers the drawer and SW-listener need. The backend keeps its own `urlFor()` (it has no access to the frontend module and shouldn't gain a cross-package dependency for 3 entities); the two are kept honest by a shared `EMITTER_ENTITY_TYPES` constant array in `shared/` (the 3 real emitter strings) that a CI gate diff's against both builders' keys.
- *Pros:* Genuinely ONE frontend URL source (honors `lib/routes.ts`'s charter). No new "registry module." Backend stays decoupled. The `shared/` surface is a single constant array — no `process.env`, no ESM/browser hazard. Drift between the two builders is caught by CI (string-diff of emitter entities vs builder keys) rather than prevented by construction, which is proportionate for 3 entities.
- *Cons:* Two builders still exist (backend `urlFor()`, frontend `buildNotifPath()`); CI gate is the drift defense, not the type system. Acceptable at this scale.

**Option B — A ~15-line `buildNotifPath(notification, role)` helper in the frontend only, NO `shared/` constant, backend `urlFor()` untouched.**
The Architect's steelman: the frontend already has `lib/routes.ts` for the actual paths; just write the helper next to it; leave the backend alone.
- *Pros:* Smallest possible diff. Zero new shared surface. No cross-package anything.
- *Cons:* No programmatic link between backend `urlFor()` keys and frontend `buildNotifPath` keys. A 4th emitter added on the backend would silently produce a path the frontend drawer can't resolve (drawer falls back to role-home — correct but the team gets no signal). With Option A's `EMITTER_ENTITY_TYPES` constant, CI fails loudly instead.
- *Why not B:* The cost of the one `shared/` constant array + one CI gate is trivial (a dozen lines), and it converts a silent fallback into a loud test failure when a new emitter appears. That is exactly the drift signal a growing codebase wants. Below ~3 emitters B would win; at 3 with growth expected, A's CI signal is worth it.

**→ Chosen: Option A.** Consolidates the frontend into its existing SoT, keeps the backend decoupled, and adds a lightweight CI signal — without inventing a "registry module" (v1's error) or leaving drift totally uninstrumented (Option B).

**Cutover trigger (when to revisit):** if emitters grow beyond ~6-8 entities OR a 3rd builder appears (e.g. email notifications, share links), promote `EMITTER_ENTITY_TYPES` + the builder logic into a real `shared/` registry module consumed by all builders. At 3 entities / 2 builders, that is premature.

### Mode
SHORT. (No schema migration, no data loss path, no security boundary change — push payloads already carry `url`. We're adding a listener, making rows clickable, and adding a CI gate.)

---

## 1. Goal & Success Criteria

### Goal
Every notification the system actually emits (3 entity types today) resolves to a navigable frontend page for the recipient's role; the click reliably lands whether the app tab is open or closed and whether the user taps the OS push or the in-app drawer item; and the NEW second builder (the clickable drawer) cannot silently drift from `lib/routes.ts` or the backend `urlFor()`.

### Acceptance Criteria
- **AC1 (Emitter coverage, reality-based):** For every `relatedEntityType` value that appears in a `createNotification` call site (enumerated by grep — currently 3: `trips`, `payments`, `penalties`), `buildNotifPath(entityType, role, { id })` returns a non-empty path starting with `/` for EVERY role. A CI gate FAILS if a new emitter appears (call-site value not in `EMITTER_ENTITY_TYPES`) OR if a value in `EMITTER_ENTITY_TYPES` has no matching key in the frontend builder or backend `urlFor()`.
- **AC2 (Role-gating):** A DRIVER never receives a path starting `/trips`, `/finance`, `/penalties`, `/expenses`, `/payables`, `/config`, `/debt`, `/dispatch`, `/fleet`, `/customers`, `/users`, `/audit-logs`, `/suppliers`, `/profit`, `/salary`, `/dashboard`. DRIVER paths start with `/my-`. FORWARDER paths restricted to `/my-forwarder-trips`, `/my-advances`, `/my-settlements` (FORWARDER has NO penalties route → penalty notifications fall back to `/my-settlements`).
- **AC3 (trips /edit — the one achievable edit deeplink):** `buildNotifPath('trips', MANAGER, { id: '123', action: 'edit' })` → `/trips/123/edit`; same for DRIVER → `/my-trips/123` (no driver edit route — action ignored, falls to view). Requesting `action:'edit'` on `payments` or `penalties` (no edit route) returns the view/fallback path, never a 404.
- **AC4 (SW closed-tab):** With no app tab open, clicking a push calls `clients.openWindow(url)` (sw.js:94) at the resolved relative path; the SW resolves it against `self.location.origin`; the page loads (manual QA per role on vantai).
- **AC5a (SW open-tab click — silent-drop fix #1):** With an app tab open, clicking a push focuses it AND the frontend `NOTIFICATION_CLICK` listener calls `navigate(payload.url)`. Verified by an integration check that the listener is registered.
- **AC5b (SW push refresh — silent-drop fix #2):** On receiving a `PUSH_NOTIFICATION` message, the frontend listener invalidates the TanStack Query notifications cache (`queryClient.invalidateQueries({ queryKey: qk.notifications.all })` — the codebase idiom at `frontend/src/api/keys.ts`) and refreshes the unread badge. Both message types are handled by a single `<DeeplinkListener/>` component (one listener, two branches on `event.data.type`).
- **AC6 (Drawer clickable):** Each item in `NotificationBell.tsx` is a clickable element that navigates to `buildNotifPath(n.relatedEntityType, currentRole, { id: n.relatedEntityId })`, marks the notification read, and closes the drawer. Keyboard-accessible (Enter/Space).
- **AC7 (Known outputs, explicit):** The 3 known (entity, role) → path mappings are asserted explicitly (replaces v1's weak snapshot):
  - `('trips', DRIVER)` → `/my-trips/:id`
  - `('trips', MANAGER)` → `/trips/:id`
  - `('payments', MANAGER)` → `/finance`
  - `('penalties', DRIVER)` → `/my-penalties`
  - `('penalties', FORWARDER)` → `/my-settlements` (no forwarder penalties route)
- **AC8 (Route-existence CI gate, Phase 1):** Every path produced by `buildNotifPath` for every `(entity in EMITTER_ENTITY_TYPES × Role × {view, edit})` is present in the static route inventory derived from `App.tsx`. Fails CI on drift. (This is the cheapest, strongest defense against builder↔`<Route>` drift; promoted from v1 Phase 3 to Phase 1.)
- **AC9 (No regression):** `useFocusDeepLink` (`?focus=`) and `useMonthRoute` (`?m=&y=`) still work. Backend `urlFor()` return values for the 3 existing entities are UNCHANGED (additive only).

---

## 2. Design

### 2.1 Consolidate into `frontend/src/lib/routes.ts` (the existing SoT)
Add a role-scoped, entity-keyed builder co-located with the existing `routes` object and `homeForRole()`. This is Option A. It reuses the existing parameterized path functions (`routes.tripDetail`, `routes.myTripDetail`, etc.) — it does NOT redeclare any path string.

```ts
// frontend/src/lib/routes.ts (append to existing module)
import { Role, type EmitterEntityType } from 'shared/constants';   // Role enum: shared/src/constants/index.ts:19; EmitterEntityType: shared/src/constants/notification-emitters.ts (§2.2)

/**
 * Resolve a notification click to a frontend path for the recipient's role.
 * Co-located with `routes` so there is ONE frontend URL source.
 * `action:'edit'` is honored ONLY for trips (sole entity with an edit route + emitter).
 */
export function buildNotifPath(
  entity: EmitterEntityType,
  role: Role,
  opts: { id?: string | number | null; action?: 'view' | 'edit' },
): string {
  const id = opts.id;
  switch (entity) {
    case 'trips': {
      if (role === Role.DRIVER) return routes.myTripDetail(id ?? '');
      if (role === Role.FORWARDER) return routes.myForwarderTripDetail(id ?? '');
      // office roles
      if (opts.action === 'edit' && id != null) return routes.tripEdit(id);
      return routes.tripDetail(id ?? '');
    }
    case 'payments': {
      if (role === Role.DRIVER) return routes.myEarnings;
      return routes.finance;
    }
    case 'penalties': {
      if (role === Role.DRIVER) return routes.myPenalties;
      if (role === Role.FORWARDER) return routes.mySettlements; // no FORWARDER penalties route
      return routes.penalties;
    }
    default: {
      // exhaustive guard: new emitter without a case → CI fails (AC1), runtime falls home
      return homeForRole(role);
    }
  }
}
```

### 2.2 `shared/src/constants/notification-emitters.ts` (NEW, tiny)
A single constant array — the contract between backend emitters and the frontend builder. NOT a registry module.

```ts
// shared/src/constants/notification-emitters.ts
/** Every relatedEntityType value the backend emits via createNotification.
 *  A CI gate diffs this against (a) createNotification call sites and (b) the frontend builder keys. */
export const EMITTER_ENTITY_TYPES = ['trips', 'payments', 'penalties'] as const;
export type EmitterEntityType = (typeof EMITTER_ENTITY_TYPES)[number];
```
Export from `shared/src/constants/index.ts`. No `process.env`, no path strings, no browser-hazard.

### 2.3 Backend `urlFor()` — minimal change
- Fix the stale comment at `notification.service.ts:144-145` (references a nonexistent `urlForNotification()` in `NotificationDrawer.tsx`; the file is `NotificationBell.tsx`). Phase-1 cleanup.
- `urlFor()` already covers all 3 entities and returns path-only. Leave its logic intact (AC9). Add the `action` field to the notification payload type so trip-edit notifications can carry `action:'edit'`; resolve it in `urlFor()` for `trips` only (mirror of the frontend special-case).
- No `FRONTEND_URL`, no `toAbsolute`. Path-only is correct for both `openWindow` and `postMessage`.

### 2.4 Frontend `<DeeplinkListener/>` — both silent-drop fixes
A single component rendered once inside the router/auth tree (the actual provider stack is `QueryClientProvider > BrowserRouter > App > AuthProvider > AppRoutes` per `main.tsx`, so mount it within `AppRoutes` where both `useNavigate()` and `useQueryClient()` are valid). Registers ONE `message` listener branching on `event.data.type`:
- `NOTIFICATION_CLICK` → `navigate(payload.url)` (AC5a).
- `PUSH_NOTIFICATION` → `queryClient.invalidateQueries({ queryKey: qk.notifications.all })` + refetch unread badge (AC5b).

Uses `useNavigate()` and `useQueryClient()`. Rendered inside the auth/provider tree so hooks are valid. **Kill-switch:** the listener body is wrapped in try/catch; on throw it logs and no-ops (the push/drawer still work via their own paths — only the auto-refresh/navigate is lost). Reverting the `<DeeplinkListener/>` import in `App.tsx` fully disables it.

### 2.5 Clickable drawer — `NotificationBell.tsx`
Wrap each `notif-item` (`NotificationBell.tsx:75-84`) in a `<button>`/`role="link"` with:
```ts
onClick={() => {
  navigate(buildNotifPath(n.relatedEntityType as EmitterEntityType, role, { id: n.relatedEntityId }));
  markRead(n.id);
  onClose();
}}
```
Add `onKeyDown` for Enter/Space (AC6). Cast on `relatedEntityType` is safe because unknown values fall to `homeForRole` (Principle 3); the CI gate (AC1) keeps the union honest.

### 2.6 FORWARDER penalty routing — resolved
`/my-penalties` is `driverOnly` (`App.tsx:136-137`); FORWARDER has no penalties route. FORWARDER penalty notifications resolve to `/my-settlements` (their home). Encoded in the builder (§2.1). No longer an open question.

### 2.7 `tag`/`renotify` dedup behavior — stated
`sw.js:61,67` uses `tag` + `renotify:true`. Collapsed notifications keep the LAST deeplink (last-wins). This is the intended behavior — a newer notification supersedes an older one of the same tag, and clicking the collapsed notification opens the newest target. Acceptable; documented here as the decision.

### 2.8 iOS Safari push — scoped OUT
DRIVERS are the mobile target. iOS Safari's Web Push support for `clients.openWindow` / `notificationclick` has known quirks (background-service limitations, inconsistent `openWindow`). **This plan does NOT include iOS QA in AC4/AC5a.** Rationale: the in-app drawer (AC6) and `PUSH_NOTIFICATION` refresh (AC5b) work regardless of iOS push quirks; the OS-notification-click path on iOS is best addressed by a follow-up that can acquire an iOS device for manual verification. Note this as a follow-up, not a blocker.

---

## 3. File-by-File Change List

| File | Change | Why |
|---|---|---|
| `shared/src/constants/notification-emitters.ts` | NEW — `EMITTER_ENTITY_TYPES` const array + `EmitterEntityType` type. | Contract between backend emitters + frontend builder (AC1 CI gate). |
| `shared/src/constants/index.ts` | `export * from './notification-emitters';` | Public surface. |
| `shared/src/types/index.ts` (or notifications type location) | Add optional `action?: 'view'\|'edit'` to notification payload. | Carries the edit hint for trips. |
| `frontend/src/lib/routes.ts` | Append `buildNotifPath()` (reuses existing `routes.*` + `homeForRole`). Import `Role` from `shared/constants`. | ONE frontend URL source (Option A). |
| `frontend/src/components/DeeplinkListener.tsx` | NEW — single `message` listener; branches `NOTIFICATION_CLICK` (navigate) + `PUSH_NOTIFICATION` (invalidate cache). try/catch kill-switch. | AC5a + AC5b (both silent-drop fixes). |
| `frontend/src/App.tsx` | Render `<DeeplinkListener />` once within `AppRoutes` (inside `AuthProvider`, under the `BrowserRouter` from `main.tsx`). | AC5. |
| `frontend/src/components/layout/NotificationBell.tsx:75-84` | Make `notif-item` clickable; `navigate(buildNotifPath(...))` + mark-read + close; a11y. | AC6. |
| `backend/src/services/notification.service.ts:144-160` | Fix stale comment (Phase 1); honor `action:'edit'` for `trips` in `urlFor()`. Leave path-only returns. | Honesty + trips /edit (AC3). |
| `backend/src/routes/trips.ts` (trip-assigned emitter) | Where an edit deeplink adds value, set `action:'edit'` on the notification payload for office roles. | Realize AC3 value. |
| `frontend/public/sw.js` | No change (verify only). | Sender already correct (both postMessages). |
| Tests (§5) | NEW unit + integration + CI gate. | Acceptance gates. |

---

## 4. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Builder↔`<Route>` drift** (new drawer builder) | Med | High (404) | AC8 route-existence CI gate in Phase 1. |
| **Builder↔emitter drift** (new entity on backend, drawer can't resolve) | Low | Low (falls to home) | AC1 CI gate diffs `EMITTER_ENTITY_TYPES` vs call sites vs builder keys. |
| **Role-mismatched link** | Med | High | `buildNotifPath` role-first switch; AC2 unit test iterates entity × role. |
| **SW listener double-navigation** | Low | Low | Listener idempotent; Router ignores redundant nav to same path. |
| **SW listener throws** (cache/API change) | Low | Med | try/catch kill-switch; disable by removing `<DeeplinkListener/>` import. |
| **iOS Safari push click quirks** | High (on iOS) | Med | Scoped OUT (§2.8); drawer + cache-refresh unaffected. Follow-up with device. |
| **`tag` dedup loses older deeplink** | Intended | Low | Last-wins is the desired behavior (§2.7). |
| **Backward-compat** (pre-`action` payloads) | Low | Low | `action` optional, defaults `'view'`; `urlFor()` widening only (AC9). |

---

## 5. Test Plan

### 5.1 Unit (Vitest, `frontend/`)
`routes.buildNotifPath.test.ts`:
- **AC1:** for each entity in `EMITTER_ENTITY_TYPES` × each `Role`, returns a non-empty `/`-prefixed string.
- **AC2:** DRIVER/FORWARDER path-prefix allow-list; no admin prefix leaks.
- **AC3:** trips+edit (MANAGER) → `/trips/:id/edit`; trips+edit (DRIVER) → `/my-trips/:id`; payments+edit → view path (no edit route).
- **AC7:** the 5 explicit (entity, role) → path assertions listed in AC7.

### 5.2 CI gates (Phase 1)
- **Emitter-reality gate (AC1):** grep all `createNotification` call sites; extract `relatedEntityType` string literals; assert the set equals `EMITTER_ENTITY_TYPES`. FAILS if a new emitter appears without being added to the constant (and thus to both builders).
- **Builder-key gate (AC1):** assert every `EmitterEntityType` is handled by `buildNotifPath` (exhaustive switch) AND by backend `urlFor()`.
- **Route-existence gate (AC8):** static route inventory from `App.tsx`; every `buildNotifPath` output (entity × role × {view,edit}) is present. FAILS on builder↔`<Route>` drift.

### 5.3 Integration (Vitest, `backend/`)
`notification.service.deeplink.test.ts`: for each emitter entity, `urlFor()` returns expected path-only URL; trips with `action:'edit'` returns `/trips/:id/edit` for office roles; unchanged for the 3 pre-existing cases (AC9).

### 5.4 Manual / e2e (on vantai first)
For each role (admin, manager, accountant, driver, forwarder):
1. **Closed-tab push (AC4):** kill tab, trigger notification, click OS notification → opens at resolved path; loads (no 404/403).
2. **Open-tab push (AC5a):** app in background, click OS notification → tab focuses AND navigates.
3. **Push refresh (AC5b):** app open, push arrives → drawer updates + unread badge refreshes without click.
4. **Drawer tap (AC6):** open bell, click unread item → navigates + marks read + closes.
5. **trips /edit (AC3):** office role trips notification with `action:'edit'` → `/trips/:id/edit`.
6. **Role isolation:** DRIVER; confirm no notification yields an admin path (inspect push payload).
7. **Both domains:** repeat 1-3 on `vantai.tingting.vip` and `nepo.tingting.vip` (path-only, no domain config needed).
8. **iOS (scoped out):** skipped per §2.8; tracked as follow-up.

---

## 6. Phased Rollout

**Phase 1 — Drift-proofing + backend honesty (additive, zero behavior change).**
- Add `EMITTER_ENTITY_TYPES` constant; add the AC1 + AC8 CI gates; fix the stale `notification.service.ts` comment; add optional `action` field.
- Ship: CI green; existing 3 entities resolve identically (AC9).

**Phase 2 — Frontend silent-drop fixes + clickable drawer (highest user impact).**
- `buildNotifPath()` in `lib/routes.ts`; `<DeeplinkListener/>` handling both message types; `NotificationBell.tsx` items clickable; honor `action:'edit'` for trips.
- Ship: manual QA matrix per role on vantai.

Each phase independently shippable and reversible. (No Phase 3/4 — v1's coverage-widening and absolute-origin phases are dropped; they require emitters that don't exist / solve a non-problem.)

---

## 7. ADR

- **Decision:** Consolidate the frontend deeplink builder into the existing `frontend/src/lib/routes.ts` (Option A), add a tiny `EMITTER_ENTITY_TYPES` constant in `shared/` as the cross-layer contract, fix both SW `postMessage` silent-drops via one `<DeeplinkListener/>`, make the `NotificationBell` drawer items clickable, and add two CI gates (emitter-reality + route-existence). Drop `FRONTEND_URL`/absolute-origin entirely.
- **Drivers:** (1) Enable the new second builder (clickable drawer) safely — its drift risk vs `lib/routes.ts` is the immediate concern; drift is LATENT today (one builder exists), not active. (2) Correctness: two `postMessage` types are silently dropped. (3) Rollout safety: additive, no schema/security change.
- **Alternatives considered:**
  - **B — Frontend-only ~15-line helper, no `shared/` constant, backend untouched (Architect's steelman):** rejected because a 4th emitter added on the backend would silently fall to the drawer's home fallback with no signal; the cost of the one `shared/` array + one CI gate (~12 lines) is trivial and converts silent fallback into a loud test failure. At <3 emitters B would win; at 3 with growth expected, A's signal is worth it.
  - **v1's `shared/src/routes/registry.ts` (full registry module):** rejected — would create a THIRD URL source alongside `lib/routes.ts` and `<Route>`, violating the "one frontend URL source" principle it claimed to uphold. Also pulled path strings into `shared/` (a `process.env`-free ESM package shipped to both Node and browser), which is the wrong layer for frontend routes.
  - **Codegen from `<Route>` annotations:** rejected — disproportionate; no codegen pipeline; React Router elements don't carry entity/role metadata.
- **Why chosen:** Honors the existing `lib/routes.ts` charter (one frontend URL source), keeps the backend decoupled (no cross-package route dependency for 3 entities), and adds a proportionate CI drift signal — without inventing a registry module or an absolute-URL config. Smallest change that fixes both silent-drops, makes the drawer clickable, and protects the new builder.
- **Consequences:** One new tiny `shared/` constant; one new co-located helper in `lib/routes.ts`; one new listener component; two CI gates to maintain; notification payload gains an optional `action` field. The frontend builder and backend `urlFor()` remain two pieces of code kept honest by CI (not by construction) — acceptable at 3 entities.
- **Follow-ups:** (a) Promote to a real `shared/` registry if emitters exceed ~6-8 or a 3rd builder appears (email, share). (b) iOS Safari push-click QA with a real device. (c) Add emitters for `/expenses/:id/edit` and `/my-settlements/new` if/when those deeplinks are wanted — they are NOT achievable today (no emitter). (d) Telemetry on push CTR per entity.

---

## Open Questions (none blocking)
- (Resolved) FORWARDER penalties route: none — fall back to `/my-settlements` (§2.6).
- (Resolved) Stale `urlForNotification()` comment: yes, stale — Phase-1 cleanup (§2.3).
- (Resolved) `FRONTEND_URL` per-deployment: no longer needed — path-only works for both SW paths (§2.3).
- (Open, non-blocking) Should `action:'edit'` surface in the in-app drawer for office roles, or stay push-only? Current design: drawer always navigates to `view`; `action:'edit'` is a push-payload hint honored only on OS-notification click. Revisit if users ask for edit-from-drawer.

---

## Appendix — Future entities (require an emitter; OUT OF SCOPE)
These routes EXIST but NOTHING emits a notification that would deep-link to them. Adding builder rows for them now would be dead code and mislead. They become in-scope only when an emitter is added (at which point the AC1 CI gate forces their addition to `EMITTER_ENTITY_TYPES` + both builders):

| Entity | Route exists | Emitter? | Role note |
|---|---|---|---|
| `expenses` | `/expenses/:id/edit`, `/expenses/new` | NONE | `adminOnly` (MANAGER/ACCOUNTANT access per `App.tsx`) |
| `forwarder_settlements` | `/my-settlements/:id`, `/my-settlements/new` | NONE | FORWARDER-only |
| `customers` | `/customers` (modal mgmt) | NONE | office |
| `debt` | `/debt/:id` | NONE | office |
| `payables` | `/payables/:id` | NONE | office |
| `advances` | `/advances`, `/my-advances` | NONE | office/FORWARDER |
| `fuel` / `config:*` | `/config/fuel` etc. | NONE | office |
| `salary_periods` | `/config/salary-periods` | NONE | office |
| `users` / `audit_logs` | `/users`, `/audit-logs` | NONE | office |
