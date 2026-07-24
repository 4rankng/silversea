# Plan — Reduce ReAct Chatbot Latency (perceived + actual)

**Status:** `implemented; awaiting post-deploy production validation`
**Date:** 2026-06-28
**Last updated:** 2026-07-15
**Owner:** backend agent subsystem
**Target:** p50 ≤ 6 s, p95 ≤ 12 s, eliminate the >20 s tail (original M2.1 baseline: p95 ≈ 17 s, tail > 20 s)

### Implementation update — 2026-07-15

- Default MiniMax model upgraded from `MiniMax-M2.1-highspeed` to
  `MiniMax-M2.7-highspeed` in the runtime and admin settings contract.
- Broad company financial-health questions now use a deterministic `financial`
  lane: current-period P&L, receivables, and payables run in parallel and
  produce a typed insight card without an LLM call.
- Canonical simple reports now use a deterministic `report` lane: current or
  explicit-month profit/revenue, current receivables, and current payables call
  the corresponding business service and build the typed response without
  ReAct or a final-format call. Unsupported periods and analytical/entity-
  specific questions fail open to ReAct.
- Analytical financial questions (vehicle/customer scope, comparisons, causes,
  unsupported quarter or year-only periods) continue to use ReAct; established
  customer receivable lookups continue to use the lookup lane.
- ReAct turns now advertise intent-specific tool schemas, use dynamic iteration
  caps (1 with no tools, 2 for tutorial intents, 3 for simple financial/report
  intents, and 4 for causal/comparative/specific analysis), and receive a concise prompt whose data,
  tour, UI, and structured-response rules are included only when relevant.
- Exact duplicate read-only tool calls within one turn share the same promise;
  failures are evicted and cache hits are recorded in the tool trace. This is
  additive to the existing Redis report caches (`reports:pnl:*`, aging/entity
  results, dashboard and fuel variance) and their mutation invalidation paths;
  it does not claim a new cross-turn cache for every tool.
- Live answer-token streaming is enabled by default. The new
  `AGENT_STREAMING_ENABLED=false` kill switch returns model text through the
  terminal path while retaining run/tool progress events. Incremental filtering
  removes split `<think>` and internal tool markup before deltas reach the UI.
- Cancelled/disconnected turns are persisted as an `aborted` monitoring lane,
  parallel tool latency is recorded once per wall-clock batch, and expense
  create/update/delete now invalidate cached P&L reports.
- Monitoring now reports per-lane p50/p95, average tokens, fallback rate and
  average iterations, plus the share of ReAct turns that avoided a separate
  final-format call. The avoidance value is `null` when a period has no ReAct
  turns, avoiding a misleading 0% KPI.
- Verification on 2026-07-15: `pnpm --dir backend test` completed with 688
  tests (687 pass, 0 fail, 1 todo); `pnpm build` completed for shared, backend,
  and frontend. Vite still reports its existing warning for chunks over 500 kB.
- Production p50/p95 and >20 s-tail targets remain **unverified** until the
  changes are deployed and receive representative traffic. Compare new
  `financial`, `report`, and `react_fallback` buckets against the historical
  M2.1 baseline; do not present deterministic-path estimates as measured gains.

### Hardening — 2026-07-15 (post-`ck:predict` review)

A five-persona predict review (Architect / Security / Performance / UX /
Devil's Advocate) stress-tested the deterministic lanes against the current
code and produced a **CAUTION** verdict. The lane's design is sound for a
single-tenant system; the review surfaced concrete hardening items, now closed:

- **Fail-open on lane error (R7).** `runFinancialOverview`/`runDeterministicReport`
  reads are now wrapped in try/catch at the socket: a thrown read (any of the
  parallel `Promise.all` legs, or a P&L/aging failure) falls through to the full
  ReAct loop instead of surfacing a generic "Đã có lỗi khi xử lý" error. A
  transient failure degrades to a slower-but-correct answer.
- **Month-to-date framing (R4).** The financial-overview card title now
  annotates "(tính đến DD/MM)" via `currentVnDay()`, so a director does not read
  a partial current-month P&L as a full-month result. Falls back to the plain
  period when the day is unavailable or out of range.
- **Single source of truth for the current aging bucket (R5).** The `'0-30'`
  magic string was duplicated across `aging.service.ts`, `dashboard-stats.service.ts`,
  `deterministic-report-lane.ts`, and `financial-overview-lane.ts`. Extracted as
  `CURRENT_AGING_RANGE`; all overdue-total filters now compare against it. A
  future bucket-label change can no longer silently flip "overdue" to "all
  outstanding".

**Risks the review recorded but explicitly did NOT action as code** (process
gates, not bugs):

- **R1 (plan staleness):** the phases below describe the *original* 2026-06-28
  task list. Much of Phase 1/2 has since shipped (streaming, intent router,
  financial/report lanes, dynamic iteration caps). Treat Sections 3–4 as
  historical rationale, not an active TODO list. The only remaining *gated*
  work is Phase 0's post-deploy measurement gate (see R2) and the
  contingency-only Phase 3/4 (model tiering / caching), which must NOT be
  started until post-deploy metrics show a residual >20 s tail in the
  `react_fallback` bucket.
- **R2 (skipped Phase 0 gate):** before any further lane work, pull production
  `agent_turn_metrics` for the `financial`/`report`/`react_fallback` buckets
  and compare against the pre-lane M2.1 baseline. The `latency_first_token_ms`
  column already exists (`schema.ts:1175`); the lane writes
  `intent_bucket='financial'`. See the query runbook in this repo at
  `docs/runbooks/agent-latency-postdeploy.md`.
- **R6 (role/tenant scoping):** confirmed non-issue. The deterministic lanes
  and the ReAct tool layer both return the same single-tenant company-wide
  aggregates; the only gate is the `OFFICE_ROLES` check at `agentSocket.ts:151`,
  mirroring the Casbin policy. No new scoping gap was introduced.

**Resolved (no action):** the review's open question about whether the socket
fail-opens on a lane throw is now confirmed — it does, via the try/catch added
under R7 above.

> **Review log**
> - **Architect (ITERATE → accepted):** fixed model version (M2.1, not M2.7 — verified `models.ts:17`); reframed `MODEL_STRONG` (comment only, not an export — must be introduced + validated, not "wired"); pulled MiniMax streaming-shape (R1) spike into Phase 0; reframed Phase 1 as a shared-schema change to `agentEventSchema`; inverted §4.1 (2-call safe default, single-call = Phase 3 optimization); added Case-path instrumentation + per-phase correctness gates; acknowledged P2.2/P3.1 cannibalization; added streaming `<think>` token-delta risk.
> - **Rejected Architect claim:** that the "6-iter / 78s / 145k tokens" citation is missing — it IS at `models.ts:26-28` (verified); kept.
> - **Critic (ACCEPT-WITH-RESERVATIONS → consensus reached; no CRITICAL/MAJOR findings):** pinned the p95 baseline column (`latency_user_perceived_ms`); documented the `agentEventSchema` change as additive/non-breaking + shared-rebuild-before-backend deploy order; resolved the Step-A streaming-source ambiguity (stream the single Case-2 call's tokens live, not a finished message; ≤2 s TTFT scoped to ack/progress); added the `answer_chunk` emit mechanism; added P1.4 streaming kill-switch; added the P2.1 ≤10% misroute-rate gate; anchored the mid-stream abort-semantics test. Deferred to spikes (correctly): MiniMax `stream:true` shape (P0.3), P4.1 cache-invalidation surface.

---

## 1. Original problem and baseline (2026-06-28)

This section preserves the evidence and rationale used to approve the plan. It
describes the **original M2.1 implementation**, not the 2026-07-15 runtime.

At that baseline, a bot turn was a **sequential chain of LLM calls** to
`MiniMax-M2.1-highspeed`, plus tool/DB work between them. Wall-clock ≈
`(iterations + final calls) × per-call reasoning latency`.

- ReAct loop: up to `AGENT_MAX_ITERATIONS = 4` — `orchestrator.ts:386`; cap rationale + the recorded prod datapoint ("a 6-iter turn hit 78 s / 145 k prompt tokens") at `models.ts:26-30`.
- Final answer is already branched into **3 cases** the Planner must thread any streaming redesign through (`orchestrator.ts:610-635`):
  - **Case 1** — last loop turn already emitted valid structured JSON → `produceFinalAnswer` direct-parse, **0 extra calls** (the existing P1 gate).
  - **Case 2** — no data tool used, prose-style answer → 1 prose/streamed call.
  - **Case 3** — data tools used, model must synthesize a structured `insight_card` → 1 structured call (`+1`), `+1` prose fallback worst case (`orchestrator.ts:773-879`).
- Each call: full reasoning model, `reasoning_split: true` (moves CoT out of billable content, **not** out of wall-clock) — `minimax.client.ts:120-127`.
- Each iteration re-bills the **growing** context; `trimToolHistory` (`orchestrator.ts:1229`, 24k-char budget) trims *old tool results* but **not** the system prompt (`buildSystemPrompt`, ~4–5 kB of rules + `RESPONSE_SHAPE_HINT` + examples) or tool schemas (`toolsToMiniMax`) — those re-bill on every call regardless of trimming.
- Non-streaming: `callMiniMax` does `await res.json()`; one terminal `done` frame per turn — `minimax.client.ts:187`, `agentSocket.ts:218-230`.
- The shared event contract `agentEventSchema` (`shared/src/schemas/agent.ts:316-356`) is a **closed discriminatedUnion of exactly 5 variants** (`tool_start`, `tool_result`, `directive`, `done`, `error`). There is **no `thinking` and no token-stream event** — adding either is a coordinated shared→backend→frontend schema change, parsed on both sides (`useAgentChat.ts:97-188` exhaustive switch; `AgentAssistant.tsx` dispatches on `response.type`).
- `MODEL_STRONG` is **only a comment** (`models.ts:10-14`), not an exported constant — tiering means *introducing + validating* a new model, not wiring an existing one.

**Current implementation note (2026-07-15):** `MODEL_FAST` is now
`MiniMax-M2.7-highspeed`; deterministic financial/report lanes bypass the chain
for supported intents; ReAct uses selected tool schemas, conditional prompt
sections, dynamic iteration caps, in-turn duplicate-read memoization, and
default-on streaming with a kill switch. `MODEL_STRONG` remains unimplemented;
there is no claim that model tiering shipped.

**Root cause:** the >20 s tail is multi-iteration Case-3 analytical turns where sequential reasoning calls + context growth + occasional card-schema fallback stack. Already mitigated (do NOT redo): cap 6→4, Case-1 direct-parse gating, `reasoning_split`, `jsonrepair`, `compactToolResult`, `salvageText`, concurrent read-only tools (P1.3), `trimToolHistory`, token-attribution logging.

**Industry guidance (user-supplied):** "a 10–12 s agent feels broken unless it streams or breaks work into visible steps"; "industry treats long ReAct latency as a product/orchestration problem, not just a model problem"; recommended architecture = acknowledge instantly → stream progress → ReAct backend → stream final answer when ready; fast fallback model for short replies + slower model only for deep reasoning. *(Note: this is a stakeholder preference that strongly favors perceived-latency-first; Phase 0 will confirm with data.)*

---

## 2. RALPLAN-DR summary

### Principles (5)
1. **Perceived latency (TTFT) > total for a chat UI.** Streaming + visible progress is the highest-leverage fix. A streamed 12 s turn feels fine; a 12 s blank pause feels broken.
2. **Cut sequential reasoning calls.** The N+1 structure is the root actual-latency cost — collapse simple paths and tier models.
3. **Never regress correctness/safety.** v1 is read-only; keep JSON validation, the `finish_reason='length'` truncation guard, fallback paths, and the event-contract invariants. Streaming must not break the `insight_card` schema contract. **Every phase carries a correctness gate.**
4. **Measure every change** — including *which Case path* fired. No change ships without before/after numbers.
5. **Stage by ROI.** Perceived-latency wins first, actual-latency second, tail/conversation third.

### Decision Drivers (top 3)
1. The "10–12 s feels broken" threshold → streaming + progress is **mandatory** for acceptable UX (stakeholder mandate).
2. Reasoning-model per-call wall-clock × N calls is the dominant actual-latency cost.
3. The final-answer path is already branched (Cases 1/2/3) — so perceived-latency wins can be captured **incrementally per case**, de-risking Phase 1.

### Viable options
- **Option A — Product/orchestration first:** streaming + progress + intent fast-path. Biggest perceived win; modest actual win. Medium effort.
- **Option B — Model/token first:** model tiering + context diet + caching. Biggest actual win; no perceived win (still a blank pause); high effort + high-risk spike.
- **Option C — Hybrid, staged (RECOMMENDED):** A first (perceived), then B (actual), then tail.

**Why C over A alone:** A leaves the >20 s analytical tail intact in total time (just hides it). **Why C over B alone:** B still produces a blank 8–12 s pause until every lever lands (high effort/risk). C delivers acceptable UX in Phase 1 and compounds gains after. **Architect steelman noted:** C optimizes the *demo/first-turn*, B optimizes the *long session* (system prompt + schemas re-bill every call regardless of streaming). C's ordering is preference-driven (stakeholder) until Phase 0 confirms whether perceived-spike or total-floor pain dominates real usage — so Phase 0 can **reorder** C if data says so.

---

## 3. The plan (staged)

Status markers below describe the repository state on 2026-07-15. Acceptance
targets that require production traffic remain pending even when their code is
implemented.

### Phase 0 — Measure + spike (`instrumentation implemented; production comparison pending`)
- **P0.1 — PARTIAL.** The original M2.1 `latency_user_perceived_ms`
  baseline is preserved and monitoring separates user-perceived from pipeline
  latency. A post-deploy M2.7/per-lane production pull is still required for
  p50/p95/p99 and >20 s-tail validation.
- **P0.2 — PARTIAL.** Metrics capture TTFT and intent buckets. The dashboard now
  adds per-lane p50/p95, average tokens, fallback rate and average iterations,
  and derives final-call avoidance for ReAct turns from
  `latency_final_ms = 0`. An explicit three-case final-path field was not added;
  the avoidance KPI is a useful proxy, not a complete Case-1/2/3 breakdown.
- **P0.3 — IMPLEMENTED LOCALLY; LIVE SHAPE CHECK PENDING.** The
  OpenAI-compatible SSE parser, final accumulated-content cleaning, streaming
  event contract, and frontend streaming bubble are present and covered by
  backend tests. The callback intentionally receives raw deltas, so live M2.7
  an incremental sanitizer now removes split reasoning/internal-tool markup
  before UI emission; production traffic still validates provider behavior.
- **P0.4 — NOT SHIPPED AS TIERING.** The default high-speed model moved from
  M2.1 to M2.7. `MODEL_STRONG` and task-based model tiering remain future work;
  the model upgrade must not be described as tiering.
- **Decision gate:**
  - If Case-1/Case-2 (simple/nav/prose) dominate **volume** → Phase 2 intent fast-path is highest ROI.
  - If Case-3 analytical turns dominate the **>20 s tail** → Phase 3 tiering is highest ROI (and P2.2/P3.1 cannibalization — see §4.5 — decides whether tiering still pays after iteration reduction).

### Phase 1 — Perceived latency (`implemented; production TTFT gate pending`)
**Reframe (Architect):** this is a **shared-schema change**, not backend-only. Sub-tasks:
- **P1.0 — IMPLEMENTED EARLIER.** The shared AG-UI contract uses
  `RUN_STARTED`, `TOOL_CALL_*`, `TEXT_MESSAGE_START/CONTENT/END`,
  `RUN_FINISHED`, and `RUN_ERROR`; the frontend consumes the streaming text
  events. These names supersede the original draft's `thinking` and
  `answer_chunk` labels while preserving the intended behavior.
- **P1.1 — IMPLEMENTED EARLIER.** Run-start progress is emitted before model
  completion.
- **P1.2 — IMPLEMENTED EARLIER.** Tool-start/tool-end progress events are
  surfaced through the existing event path.
- **P1.3 — IMPLEMENTED EARLIER.** Model prose is streamed through
  `TEXT_MESSAGE_*`, with the terminal structured response still delivered by
  `RUN_FINISHED`. Split and self-closing `<think>`, `tool_call`, and MiniMax
  internal tags are filtered before any token delta reaches the frontend.
  **Original staged rationale (preserved):**
  - **Step A (ship first, zero call-count cost, no schema-streaming problem):** Case-2 turns make **exactly one** prose-producing LLM call — switch THAT call to `stream: true` and emit its tokens live as `answer_chunk`. This is a real **TTFT-vs-completion** win (user sees the first token when the model starts generating, not after the whole response finishes) at **zero extra calls**. *(Clarifies the prior ambiguity: we stream the single Case-2 call's deltas as they arrive — we do NOT stream an already-finished message, which would give only a typewriter effect.)* The "TTFT ≤ 2 s" acceptance below is scoped to the P1.1/P1.2 instant-ack + tool-progress rendering; first-prose-token for Case-2 is bounded by that one call's own TTFT (a reasoning model may exceed 2 s to first token — still far better than waiting for full completion).
  - **Step B (Case 3 analytical):** settle single-call-vs-2-call via the P0.3/P0.4 spike, then ship. **Default = 2-call** (streamed brief prose, then structured `done.response`); single-call "prose + delimited JSON" is an optimization to prove, not assume (see §4.1).
- **P1.4 — IMPLEMENTED.** `AGENT_STREAMING_ENABLED` defaults to `true` and
  gates live model text in both the ReAct loop and prose-finalization path.
  Setting it to `false` retains run/tool progress and uses non-streaming model
  calls. Because this is an environment setting, changing it still requires
  the deployment/runtime's normal configuration restart; it is not a remote
  hot toggle.
- **Acceptance (Phase 1):** TTFT ≤ 2 s on 95% of turns (blocked-on-P0.2 TTFT metric; scoped to P1.1/P1.2 ack+progress per Step A); `tool_start`/`thinking` rendered within 1 s; **correctness gate: no increase in `fallbackUsed` rate and no decrease in navigate-compliance (`navigateDirectiveEmitted`/`guardrailFired`) vs Phase-0 baseline.**

### Phase 2 — Collapse call count (`implemented for supported intents; production gate pending`)
- **P2.1 — IMPLEMENTED/EXPANDED.** Existing FAQ, navigation, lookup, and daily
  summary fast paths are joined by:
  - `financial`: broad current-company health, using P&L plus receivables and
    payables service reads in parallel, 0 LLM calls.
  - `report`: canonical profit/revenue, receivables, or payables totals, using
    one business-service read, 0 LLM calls.
  - Causal, comparative, entity-specific, unsupported-quarter, and unsupported
    year-only requests fall through to ReAct. The planned 50-intent production
    misroute gate is not claimed complete by the focused routing tests.
- **P2.2 — IMPLEMENTED.** The ReAct loop uses an intent-specific cap: 1 with no
  selected tools, 2 for tutorial intents, 3 for simple financial/report
  prompts, and 4 for causal/comparative/specific analysis or other complex
  work. `AGENT_MAX_ITERATIONS = 4` remains the upper safety bound.
- **Acceptance (Phase 2):** ≥50% of turns (simple/nav bucket) complete in ≤ 1 LLM call; p50 ≤ 6 s; **correctness gate as above.**

### Phase 3 — Per-call cost (`context diet implemented; model tiering pending`)
- **P3.1 — NOT IMPLEMENTED.** The runtime now uses
  `MiniMax-M2.7-highspeed`, but all MiniMax calls still share `MODEL_FAST`.
  `MODEL_STRONG` and task-complexity model routing remain pending.
- **P3.2 — IMPLEMENTED.** `selectToolsForMessage` advertises only conservative,
  intent-relevant schemas for recognized domains and preserves the full
  role-filtered surface for unknown intents. `buildSystemPrompt` now includes
  data, tours, UI-detail, and structured-response guidance conditionally; a
  no-tool conversation requests concise prose without JSON overhead.
- **Acceptance (Phase 3):** mean per-call `latency_llm_ms` ↓ ≥ 30% at equal prompt size; p95 ≤ 12 s; >20 s tail <1% of turns; **correctness gate: schema-conformance rate holds vs baseline.**

### Phase 4 — Tail / conversations (`partially implemented`)
- **P4.1 — PARTIAL.** Exact duplicate calls to any tool marked `readonly` share
  one promise within a single ReAct turn; rejected calls are removed and hits
  are included in the trace. Existing cross-turn Redis report caches remain in
  place with mutation invalidation for trip and financial writes. Session-wide
  `data.*` TTL memoization and directive-resolution caching from the original
  plan were not added.
- **P4.2 — NOT IMPLEMENTED (optional).** Formalize
  acknowledge→background→notify with a job queue only if the deployed Phase
  1–3 changes do not clear the threshold.

---

## 4. Key tradeoff tensions (resolved/inverted per Architect)

1. **"Brief first, detailed later" vs "cut sequential calls" (Principle 1 vs 2) — INVERTED.** The structured `insight_card` is JSON and cannot be partially rendered; to stream a brief FIRST you either (a) stream the single structured call's tokens (JSON can't render mid-flight; model emits summary-then-widgets in non-guaranteed order) or (b) make a SEPARATE brief-prose call (+1, violates Principle 2). **Resolution:** 2-call is the **safe default** (correct-by-construction; prose streams first so perceived latency still wins); single-call "prose + `<<CARD>>`-delimited JSON" is a **Phase 3 optimization** to prove via spike — `parseAgentResponseContent` (`orchestrator.ts:893-909`, already does stripThink→extractFirstJsonObject→jsonrepair→Zod) is parsing-ready, but model reliability of emitting the delimiter mid-stream is unverified.
2. **Streaming JSON is fragile** → that's why Step A streams Case-2 prose (text) and Case-3 emits the card as a completion event, not a token stream.
3. **Streaming `<think>` token-delta risk (Architect) — RESOLVED IN CODE.** Raw deltas pass through a chunk-boundary-safe filter that suppresses closed, truncated, split, and self-closing reasoning/internal-tool markup before UI emission; the completed content still passes through `stripThink` as a second guard.
4. **Model-tiering fallback risk.** A cheaper non-reasoning model may mis-select tools / fail the strict card schema → higher fallback rate could *increase* total calls (card→salvage→prose), regressing actual latency. Mitigation: keep the reasoning model for final synthesis; gate on fallback-rate (P0.4).
5. **P2.2 / P3.1 cannibalization (Architect).** If P2.2 cuts simple-case iterations to 1–2, P3.1's per-iteration-call win shrinks to Case-3 analytical turns only. P3.1 priority is therefore **contingent on Phase 0's analytical-turn volume**.
6. **Abort semantics under streaming — IMPLEMENTED.** Abort signals stop provider reads, the frontend stream is retired, cancelled turns receive an `aborted` metrics row, and per-socket finalization is serialized so replacement messages cannot reorder cancellation history.

---

## 5. Verification

### Completed locally — 2026-07-15

- Backend suite: `pnpm --dir backend test` — 688 tests, 687 pass, 0
  fail, 1 todo.
- Monorepo production build: `pnpm build` — shared TypeScript, backend
  TypeScript, and frontend Vite build pass. Vite reports the pre-existing
  warning for chunks over 500 kB; it does not fail the build.
- Focused coverage includes financial/report routing boundaries, financial
  card schema/sign handling, intent-scoped tool selection, dynamic budgets,
  stable duplicate-read cache keys, metric bucket taxonomy, SSE parsing, and
  streaming event schemas.

### Required after deployment

- Collect representative M2.7 traffic before declaring the latency target met.
  Report p50/p95/p99 and >20 s share from `latency_user_perceived_ms`, with
  `latency_total_ms` and TTFT shown separately.
- Compare `financial`, `report`, and `react_fallback` lanes separately, including
  per-lane p95, average tokens, fallback rate, and average iterations. The
  original 7-day M2.1 baseline must remain labeled as historical.
- Validate final-call avoidance only across ReAct turns; periods with no ReAct
  turns are not 0% and render as unavailable.
- Re-run the correctness gates on production traffic: fallback rate,
  navigate-compliance, schema conformance, streaming abort behavior, and the
  labeled misroute set. Local passing tests do not establish p50/p95 gains.

## 6. ADR
- **Decision:** Stage C — perceived-latency first (Phase 1 streaming + progress, Step-A Case-2 prose first), then collapse calls (Phase 2 fast-path), then per-call cost (Phase 3 tiering + diet, contingent on Phase 0).
- **Drivers:** "feels broken >10–12 s" stakeholder mandate; N+1 reasoning calls dominate; final-answer path already branched per Case so wins are incremental.
- **Alternatives:** A alone (hides but doesn't fix total time); B alone (still blank-pauses; high-risk spike blocks value).
- **Why chosen:** Delivers acceptable UX in Phase 1, compounds actual-latency gains after; each phase independently valuable + measurable; Phase 0 can reorder if data contradicts the perceived-first preference.
- **Consequences:** Streaming = shared-schema (3-package) + render-state work; single-call streaming + model tiering are bets gated behind P0.3/P0.4 spikes.
- **Follow-ups:** P0 gates P1.3/P3.1; P4 caching/async only if tail persists.
