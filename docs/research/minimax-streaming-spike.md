# P0.3 Spike — MiniMax streaming shape

> ⚠️ **DESCOPED 2026-06-28** — user decided NOT to ship agent streaming. Kept as
> a research record only (finding: MiniMax `stream:true` IS viable + safe). The
> streaming code (event variants, `AGENT_STREAMING_ENABLED`, probe script) was
> reverted. Do NOT act on the P1.3 recommendations below without re-confirming.

**Date:** 2026-06-28
**Probe:** `backend/src/scripts/probe-minimax-stream.ts`
**Plan ref:** `docs/plans/chatbot-latency-reduction.md` Phase 0 / P0.3 (gates P1.3)
**Endpoint:** `POST https://api.minimax.io/v1/chat/completions`, `model=MiniMax-M2.1-highspeed`, `stream:true`, `reasoning_split:true`, `temperature:0.2`, `max_tokens:200`, plain-text prompt (no tools, no `response_format`).

## Verdict: streaming is VIABLE and SAFE for P1.3

The two gating risks the Architect/Critic flagged are both **cleared** by MiniMax's actual streaming behavior. Streaming `delta.content` to the user is clean by construction.

## Findings (answers to the 3 spike questions)

### (a) Does `stream:true` return OpenAI-shaped SSE `data:` chunks + terminal `[DONE]`?
- **Yes, OpenAI-shaped; NO `[DONE]`.** `Content-Type: text/event-stream`, `object: "chat.completion.chunk"`, each line `data: {…}`.
- **Termination is `finish_reason`, not `[DONE]`.** The last content chunk carries `"finish_reason":"stop"`; the server then closes the stream without a `data: [DONE]` frame (`DONE_SEEN=false`, `DATA_CHUNKS=5`).
- **→ Parser requirement:** treat any chunk with a non-null `finish_reason` (or a closed body) as end-of-stream. Do **not** wait for `[DONE]` (the P1.3 parser must not hang on a sentinel MiniMax never sends).

### (b) Do delta chunks carry `<think>`/reasoning that `stripThink` can't clean per-delta?
- **No literal `<think>` tags** in content (`THINK_TAG_IN_DELTA=false`, `FULL_CONTENT_HAS_THINK_TAG=false`). `reasoning_split:true` works in streaming mode exactly as documented for non-streaming: reasoning is routed OUT of `content`.
- **Reasoning streams in its own fields** — `delta.reasoning_content` (string) and `delta.reasoning_details[]` — while `delta.content` is **empty `""`** during reasoning, then fills with the answer once reasoning completes.
  - Chunks [0],[1]: `reasoning_content`/`reasoning_details` present, `content:""`.
  - Chunks [2]–[4]: `content` carries the answer (~30–40 char fragments), no reasoning field.
- **→ Correctness rule for P1.3:** stream **only `delta.content`** to the client; **never** forward `reasoning_content`/`reasoning_details`. Because content is empty during reasoning, nothing renders until the real answer starts — so no reasoning ever leaks, and `stripThink` is not needed on the streaming path (the split is structural, not textual).

### (c) Fields/granularity available per delta
- `delta.content`: answer text, sub-string fragments.
- `delta.reasoning_content` / `delta.reasoning_details[]`: chain-of-thought (ignore for display).
- `choices[0].finish_reason`: `"stop"` on the terminal chunk.
- `usage`: present on at least one chunk (appears alongside content chunks) — so token accounting is available without a second call.
- `id`/`model`/`created`/`object`: standard OpenAI fields on every chunk.

## Implications for the plan (P1.3)

1. **The single biggest perceived-latency win is real and safe:** stream `delta.content` live; the user sees the first answer token as soon as reasoning completes (chunk [2]), not after the whole answer generates + a JSON parse. No `<think>`-leak risk.
2. **Reasoning time still gates first-content-token.** Reasoning streams first (chunks [0],[1]); `content` stays empty until it finishes. So TTFT for *answer text* is bounded by reasoning duration — still a large win over full-completion latency, but the instant `thinking` ack (US-005) remains valuable to fill the reasoning gap with visible progress.
3. **2-call default for Case-3 analytical stands:** partial `insight_card` JSON still can't render mid-stream, so stream the brief prose (Case 2) live and emit the structured card as a completion event. The spike validates streaming text; it does NOT make streaming JSON safe.
4. **Parser must key off `finish_reason`/body-close, not `[DONE]`.**

## Follow-up probe (NOT blocking this run — for the P1.3 implementation run)

This probe used **plain-text mode** (no `tools`, no `response_format`). Before P1.3 ships, re-run the probe with:
- `response_format: { type: "json_object" }` — confirm `delta.content` then streams JSON fragments and `finish_reason` still terminates (affects the single-call "prose+delimited-JSON" optimization).
- `tools: [...]` (a tool-calling iteration) — confirm whether tool-call arguments stream incrementally or arrive only on the terminal chunk (affects whether ReAct iterations can stream at all, though we don't plan to stream tool-selection calls).

## Raw evidence (redacted)

```
STATUS 200 OK
CONTENT-TYPE text/event-stream; charset=utf-8
DATA_CHUNKS 5
DONE_SEEN false
THINK_TAG_IN_DELTA false
REASONING_FIELD_PRESENT true
NON_STANDARD_LINES 0
# Sample chunks show: reasoning in reasoning_content/reasoning_details (content ""),
# then content fragments, terminal chunk finish_reason:"stop".
```
