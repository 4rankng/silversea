# Plan — Bot-driven navigation + pinpoint-the-button highlight (pending approval)

**Status:** `implemented + verified (uncommitted)` — ralph execution. ralplan consensus (Architect ITERATE→applied; Critic ITERATE→applied) → implemented WS-A. **Two discoveries beyond the plan, both fixed:** (1) `fleetTires`/`fleetTrailerTires` were NOT in `AGENT_ROUTE_KEYS` (true root cause) → added; (2) `resolvePath` hardcoded `{id}` → tire pages would hit `/fleet/undefined/tires` → fixed via `requiresParams[0]`. WS-B (Driver.js) + WS-C (auto-open) deferred (tire form is always-visible, no modal). All gates green: shared/backend/frontend tsc + vite build + backend tests (routeMatcher 13 + golden + metrics) + frontend vitest 102/102. Architect verify pass: 1 P0 fixed verbatim + regression-guarded. **Pending: manual QA against live MiniMax (≥80% direct-navigate) + commit + `make migrate` (0086).**
**Date:** 2026-06-27
**Trigger:** Bot replied with plain text `"...trang Lốp xe tại /fleet/1/tires"` instead of navigating; user asked (a) why, (b) should the bot open the relevant component, and (c) add a tutorial-style animation that **pinpoints the button to click**.

---

## 0. Diagnostic — why it behaves like this today

The user saw:

> "Tôi đang ở chế độ CHỈ ĐỌC … Để thêm lốp xe, bạn vui lòng thao tác trực tiếp trên giao diện trang Lốp xe tại /fleet/1/tires."

That sentence is **not hardcoded — it is MiniMax-M3 talking.** Verified facts that reframe the request:

1. **Navigation already works end-to-end.** `ui.navigate` → `AgentDirective {kind:'navigate', routeKey, params, highlight?, animation?}` → `AgentDirectiveContext.send()` → react-router `navigate()`. `highlight` is already a valid field on the navigate schema.
2. **The system prompt already forbids the behavior** (`orchestrator.ts:102`) — **but the rule is scoped to "mở trang/tìm/xem" (open/find/view), not write/delegation.** "thêm lốp xe" (a write) falls outside it, so the model emits prose.
3. **`ui.navigate` does not advertise its `highlight` capability.** `ui.ts:80` defines tool params as `{routeKey, params}` only — `highlight` is omitted, so the LLM cannot discover it can point at an element. **This is the real "no pinpoint" root cause.**
4. **The Tire page needs almost no new affordance.** Verified at `TruckTiresPage.tsx`: "Thêm lốp" is `<a href="#ttp-add-title">` (line 230) — an **anchor/button**, and the form `<section className="ttp-panel--form">` (line 238) is **always rendered** (no modal). The anchor itself currently has no `id` (only its scroll-target `ttp-add-title` does) — **M1 fix: give the anchor its own stable id so the pinpoint lands ON the button, not the heading above it.**

**Root cause of Ask 1 (no redirect):** the model ignored navigation because (a) the prompt rule doesn't cover delegation/write, and (b) the tool description doesn't say "use me when you can't act, and point at the element."
**Root cause of Ask 2 (no pinpoint):** misdiagnosed as "needs a tour library." Really: `navigate` was never told to highlight the button, and the button lacked a targetable id.

**Conclusion:** Ask 1 is a *prompt/tool-description* fix; Ask 2 is *solvable with the existing ring-pulse* once the `highlight` param is exposed and the button gets an id. **No new library, no new directive kind, no new component for v1.**

---

## RALPLAN-DR summary (final)

**Principles**
1. **Don't rebuild what exists.** Navigate pipeline + `highlightElement` + the terminal-directive-ack block all work.
2. **Read-only philosophy holds.** Bot points at the button ("người dùng tự lưu"). No auto-write.
3. **Distrust the model; add a deterministic net — but stay honest.** The guardrail navigates *for real* by producing a directive the existing ack block executes; it never claims success it didn't earn.
4. **Fit the ethos.** No new dependency for v1. (Driver.js reserved for *future* dense-page spotlights — see §4.)
5. **Verify anatomy before building.** First draft assumed a hidden button/modal; the page is a single tall workbench. (Caught by Architect + Critic + reads.)

**Decision drivers (top 3)**
1. Bot must **reliably** navigate on delegation/write requests — measured, not hoped.
2. After navigating, the **button** must be pinpointed (ring lands on the anchor, not a heading 200px above it).
3. Minimal blast radius: backend prompt + tool-description + one guardrail + one id on one anchor. **No shared schema change, no new dep.**

**Viable options**

| | Option 1 — Expose `highlight` + prompt + honest guardrail + button id *(chosen)* | Option 2 — Driver.js spotlight | Option 3 — auto-open form (`open` directive) |
|---|---|---|---|
| Fit | Reuses ring on the actual button of an always-visible form | New dep + popover pointing at a 200px-scroll anchor | Targets a modal that doesn't exist |
| Verdict | **v1** | Defer (future dense-page hidden targets) | **Delete** for this page (no modal) |

---

## Workstreams

### WS-A — Reliability + pinpoint-via-existing-highlight (the whole v1 fix)

- **A1. System prompt rewrite** (`orchestrator.ts` `buildSystemPrompt`): broaden the navigate rule from "mở trang/tìm/xem" to an explicit **delegation rule**: *"Khi người dùng yêu cầu tạo/sửa/xóa mà bot không được phép (v1 chỉ đọc): KHÔNG từ chối bằng text đường dẫn — LUÔN gọi `ui.navigate` với `highlight.targetId` trỏ vào phần tử/nút cần thao tác."* Add **2 few-shot examples**, one for "thêm lốp xe cho xe 1" → `ui.navigate({routeKey:'fleetTires', params:{truckId:1}, highlight:{targetId:'ttp-add-trigger', durationMs:4000}})`.
- **A2. Expose `highlight` in `ui.navigate`** (`ui.ts`): add `highlight: {targetId, durationMs?}` to the advertised params schema + description: *"Có thể kèm `highlight.targetId` để cuộn + tô sáng nút/phần tử trên trang đích."* (Backend-local Zod only — **no shared change, no rebuild.**)
  - **A2b. Button id (M1 fix):** add `id="ttp-add-trigger"` to the "Thêm lốp" `<a>` at `TruckTiresPage.tsx:230` so the ring lands ON the button.
  - **A2c. Small default-target fallback:** a tiny inline map `{ fleetTires: 'ttp-add-trigger' }` in the backend — if the model calls `ui.navigate` to a mapped routeKey *without* a `highlight`, inject the default `targetId`. (1–2 entries, not the over-engineered registry the Architect warned against; grows only if QA shows frequent omission.)
- **A3. Honest deterministic guardrail** (`orchestrator.ts`, *after* `produceFinalAnswer` returns at ~line 372, *before* the terminal-ack block at 376–400):
  - **Mechanism (confirmed against code):** if `response.type === 'text'`, no directive was emitted this turn, and the matcher (below) resolves a path token in the text to a routeKey **whose (routeKey + normalized params) differ from the current route**, then **set `response = {type:'directive', directive:{kind:'navigate', routeKey, params, highlight:{targetId}}}`**. The **existing** terminal-ack block at `orchestrator.ts:376-400` then emits the directive (`requiresAck:true`), awaits the ack, and rewrites the bubble via **`directiveAckText()`** — honest "Đã mở / không mở được". **No new emit code; no synthesized lying bubble.** `directiveAckText` already covers `navigate` (`orchestrator.ts:126`).
  - **Matcher spec (lives in backend; imports `PAGE_CATALOG` which is already a runtime dep → no shared rebuild):**
    1. Match only on **`/path`-shaped tokens** (regex). Vietnamese title/alias matching is **out of scope for v1** (determinism over recall).
    2. Resolve path→routeKey via the catalog path templates (do **not** hand-parse segments — handles static suffixes like `/fleet/:truckId/tires`).
    3. **Parametric routes:** require a numeric id segment **only where the catalog template declares a param**. Non-parametric routes (e.g. `/dashboard`) need no id.
    4. **Current-route guard compares routeKey AND normalized params** — so navigating from `/fleet/1/tires` to `/fleet/2/tires` (same `fleetTires` key, different truck) is NOT suppressed.
  - **Rollback (kill-switch):** gate A3 behind `config.agent.navigateGuardrail` (default `true`) so it can be disabled via config without code removal.
- **A4. Observability + dashboard read:** add `navigate_directive_emitted` + `guardrail_fired` booleans to the `agent_turn_metrics` row **and update the chatbot-monitoring dashboard query** to surface them (columns alone are useless if the dashboard doesn't read them).

### Deferred — Driver.js spotlight (do NOT build now)
Only when a target is *genuinely hidden* (e.g. a small KPI on a dense Dashboard/Profit page where a ring is easy to miss). Then **Driver.js** (MIT, zero-dep, ~5kb), driven imperatively from the existing `AgentDirective` pipeline, is the recommendation (see §4).

### Out of scope (deleted)
- **WS-C auto-open via `open` directive:** inapplicable — the Tire form is an always-rendered `<section>`, not a modal. (`open`/`prefill` stay valid for *future* modal pages — leave `useAgentOpenable` as-is.)
- **Compile-time AGENT_TARGETS registry:** over-engineered; A2c's tiny map covers v1.
- **New `spotlight` directive kind / shared schema change:** unnecessary; `navigate.highlight` already covers it.

---

## Answer to the library question (article: Driver.js / Intro.js / Shepherd / React Joyride)
For **this** complaint: **none.** The existing ring-pulse (now pointed at the actual button via `ttp-add-trigger`, bumped to 4s) already gives "navigate + pinpoint the button." The article's libraries solve *backdrop-popover* spotlights and *multi-step onboarding tours*, which an always-visible form doesn't need. If/when a future page needs a real spotlight or a first-time-user tour: **Driver.js** is the best fit for TingTing (zero-dep, MIT, framework-agnostic → matches the self-hosted/no-CDN ethos; imperative API drops into the existing directive pipeline; reusable later for tours). **Intro.js is paid for commercial use → eliminated.** Shepherd.js (floating-ui dep) and React Joyride (heavier, harder to theme to Forest Sage) are overkill. The article's other patterns (hotspots, onboarding checklist, empty-state pointers) are a **separate product feature**.

## Decision points to confirm at approval
1. **v1 scope** — A1+A2(+A2b id, A2c fallback map)+A3+A4. No new dep, no schema change. *(Recommended.)*
2. **Pinpoint target** — confirm the ring lands on the "Thêm lốp" button (`ttp-add-trigger`), 4s duration, and that we visually verify `--accent` contrast against the Forest Sage form section. (Vs. accepting a Driver.js popover now.)
3. **Guardrail honesty** — confirm A3 routes through the existing terminal-ack block + `directiveAckText` (honest) rather than a faster synthesized bubble.
4. **Future spotlight** — defer Driver.js until a genuinely-hidden target appears (Dashboard/Profit), yes?

## Acceptance criteria
- **A1 (static gate):** system prompt contains the delegation rule + 2 few-shot examples (verifiable by prompt snapshot/string check).
- **Behavioral gate (manual QA, ≥10 runs of "thêm lốp xe cho xe 1" in dev):** ≥80% emit `ui.navigate(...)` **directly** (no prose) — measured via A4 telemetry `navigate_directive_emitted`. The residual ≤20% are caught by A3. *(A1 is the primary UX fix; A3 is the deterministic net. This gate distinguishes "A1 worked" from "A3 masked A1's failure.")*
- **Pinpoint (M1):** after navigation, the ring lands on `ttp-add-trigger` (the button), in-viewport, visible against Forest Sage styling; bubble contains **no raw path**.
- **A3 (unit-tested contract):** matcher tests — (a) `/fleet/1/tires`→`fleetTires`+params; (b) current-route skip respects params (`/fleet/1` vs `/fleet/2` not suppressed); (c) non-parametric `/dashboard` allowed without id; (d) Vietnamese-only text does not false-trigger; (e) routing through `directiveAckText` (no lying bubble). Gated by `config.agent.navigateGuardrail`.
- **A4:** the two booleans appear on the chatbot-monitoring dashboard (query updated, not just columns).
- `tsc` clean across backend + frontend; **no shared change → no rebuild**; existing agent unit tests pass.

## ADR
- **Decision:** Solve the complaint with **prompt rewrite + exposing the existing `highlight` param + a button id + an honest deterministic guardrail routed through the existing terminal-ack block.** No new dependency, no schema change, no new component.
- **Drivers:** navigate + highlight + terminal-ack infra already exist; the Tire form is always visible (anchor + `<section>`), so a popover/tour is unnecessary once the button is targetable; MiniMax-M3 unreliability needs a deterministic net, but the net must stay honest to the ack contract.
- **Alternatives considered:** Driver.js spotlight (deferred — future hidden targets), React Joyride/Shepherd (overkill), Intro.js (paid — eliminated), auto-open form via `open` directive (inapplicable — no modal), compile-time AGENT_TARGETS registry (over-engineered → A2c's tiny map instead).
- **Consequences:** backend-only changes (prompt + tool desc + guardrail + telemetry) + one frontend id on one anchor. Smallest viable blast radius.
- **Follow-ups:** if a dense page later needs a real spotlight, add Driver.js via the directive pipeline; consider onboarding tours/checklists as a separate feature; track navigate-compliance via A4.

## Review trail (ralplan consensus)
- **Architect — ITERATE → applied:** exposed `highlight` in `ui.navigate` (P0); A3 routed through real directive + `directiveAckText` (P0 honesty); current-route guard (P1); WS-B/WS-C/registry deferred/deleted (P2). Linchpin (anchor + always-visible section) verified by read.
- **Critic — ITERATE → all upgrade criteria applied:** M1 pinpoint target → button id `ttp-add-trigger` + 4s (was: heading 200px above button); M2 A3 location → "return directive, reuse `orchestrator.ts:376-400`" + 4 matcher edge cases specified; M3 → behavioral compliance gate (≥80% direct navigate) added, A1/A3 roles made explicit; gaps closed (A2c default-map, A4 dashboard read, A3 kill-switch, contrast check).
- **Convergence:** both reviewers agree on architecture (navigate+highlight, no Driver.js v1, honest guardrail via existing block). Remaining work is implementation, not design.

## Out of scope
- Multi-step onboarding tours / checklists / hotspots (article patterns) — separate feature; this plan only ensures the *mechanism* (ring now, Driver.js later) can support them.
- Replacing MiniMax-M3 or adding a stronger model.
