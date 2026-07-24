---
date: 2026-07-15
session: chatbot-latency-implementation
status: implemented-awaiting-production-validation
---

# Journal: 2026-07-15 — Chatbot Latency Implementation

## Context

The chatbot's original M2.1 production sample showed long ReAct turns, high token use, repeated schema fallback, and a p95 user wait well above the 12-second target. This session implemented the approved orchestration changes while preserving deterministic financial calculations and the existing read-only bot boundary.

## What Happened

- Upgraded the default runtime and admin-facing model name to `MiniMax-M2.7-highspeed`.
- Added deterministic `financial` and `report` lanes. Supported company-health and canonical total questions now call business services directly, with independent financial reads run concurrently, and return typed cards without ReAct or a final-format model call. Analytical, entity-specific, comparative, and unsupported-period questions still fall through to ReAct.
- Reduced ReAct cost with intent-scoped tool schemas, conditional prompt sections, dynamic iteration budgets, compact tool history/results, and omission of an empty `tools` payload.
- Added per-turn memoization for exact duplicate read-only calls. Failures are evicted and cache hits are traced. Existing Redis report caches remain responsible for cross-turn reuse; expense mutations now join the existing financial/trip invalidation surface so cached reports are not knowingly served after those writes.
- Kept live answer streaming enabled by default and added `AGENT_STREAMING_ENABLED=false` as a terminal-response safety switch. Reviewer follow-up added a chunk-safe filter for split `<think>`, tool-call, and MiniMax-internal markup, plus cancelled-turn metrics when a client aborts before persistence.
- Extended monitoring with per-lane p50/p95, average tokens, fallback rate, average iterations, cancellation buckets, and ReAct final-call avoidance. Periods with no ReAct turns report avoidance as unavailable rather than a misleading 0%; the lane-detail layout now wraps the longer metric text.
- Verified the local implementation with the backend suite (688 tests: 687 pass, 0 fail, 1 todo) and the shared/backend/frontend production build. The frontend build retains its pre-existing large-chunk warning.

## Reflection

The highest-confidence latency reductions came from removing model calls for well-bounded intents and reducing repeated context on the remaining ReAct path. The review was valuable because several edge cases were not visible in the headline design: reasoning markup can split across stream chunks, an empty tool list should not be sent as a tool contract, aborted work needs explicit telemetry, and report caches need invalidation from expense writes too. Local tests prove behavior and contracts, not production latency gains.

## Decisions Made

| Decision | Rationale | Impact |
|---|---|---|
| Use M2.7 high-speed as the single default model | Requested upgrade with minimal routing risk | All model-backed turns use the newer high-speed line; this is not model tiering |
| Route only narrow, recognizable financial intents deterministically | Avoid model and schema costs without weakening analytical answers | Supported questions use zero LLM calls; ambiguous cases retain ReAct |
| Select tools and iteration caps conservatively | Reduce prompt and loop cost while preserving unknown-intent coverage | Known domains advertise fewer schemas; unknown intents keep the full role-allowed surface |
| Memoize only exact duplicate read-only calls within a turn | Safe reuse without broad stale-data risk | Duplicate work is collapsed; rejected results are never retained |
| Keep streaming default-on with sanitization and a kill switch | Improve perceived latency while retaining a safe operational fallback | Progress remains visible; live model text can be disabled by configuration |
| Treat production KPIs as a post-deploy gate | Local execution cannot establish representative p50/p95 or tail behavior | No unsupported latency-result claim is made |

## Next

- Deploy shared, backend, and frontend changes together, then collect representative M2.7 traffic.
- Compare `financial`, `report`, and `react_fallback` separately against the labeled historical M2.1 baseline using user-perceived p50/p95/p99, TTFT, token use, fallback rate, iterations, and the over-20-second share.
- Recheck routing accuracy, schema conformance, navigation compliance, streaming abort behavior, and cache freshness under real mutations.
- Consider strong-model tiering or background jobs only if the remaining analytical tail still misses the target.
