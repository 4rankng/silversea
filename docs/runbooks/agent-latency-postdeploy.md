# Runbook — Agent Latency Post-Deploy Validation

**Purpose:** Measure whether the deterministic lanes (financial / report / lookup
/ summary / nav) and the streaming changes actually moved production latency, and
whether a residual `react_fallback` tail justifies Phase 3/4 work.

**When to run:** After the lane + streaming changes have received representative
traffic (target: ≥ 7 days, ≥ a few hundred turns across all buckets). Do NOT
present pre-deploy estimates as measured gains.

**Target (from `docs/plans/chatbot-latency-reduction.md`):**
p50 ≤ 6 s, p95 ≤ 12 s, >20 s tail < 1 % of turns.

---

## 0. Connect to the right database

The app uses a non-default port (5440). Use the same `DATABASE_URL` the backend
uses, or connect with the explicit port:

```bash
psql "$DATABASE_URL"        # preferred
# or
psql -h localhost -p 5440 -U <user> -d <db>
```

All queries below read only `agent_turn_metrics` — safe to run on the primary.

---

## 1. Per-bucket latency (the headline view)

A blended 7-day average hides whether the financial lane cleared p95. Always
split by `intent_bucket`.

```sql
SELECT
  COALESCE(intent_bucket, 'unknown')                AS bucket,
  COUNT(*)                                          AS turns,
  ROUND(AVG(latency_user_perceived_ms)::numeric, 0) AS p50_avg,
  PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY latency_user_perceived_ms) AS p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_user_perceived_ms) AS p95,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_user_perceived_ms) AS p99,
  ROUND(AVG(latency_first_token_ms)::numeric, 0)    AS ttft_avg
FROM agent_turn_metrics
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND aborted = false
GROUP BY 1
ORDER BY turns DESC;
```

**Read it as:** did the `financial` / `report` buckets land near DB latency
(sub-second to low-single-digit seconds) with zero tokens? Did `react_fallback`
p95 drop vs. the pre-deploy baseline (≈ 17 s) — or did the deterministic lanes
merely shift *easy* traffic out, leaving the hard analytical tail behind?

---

## 2. The >20 s tail (the original target)

```sql
SELECT
  COALESCE(intent_bucket, 'unknown') AS bucket,
  COUNT(*) FILTER (WHERE latency_user_perceived_ms > 20000) AS turns_over_20s,
  COUNT(*)                                                 AS total_turns,
  ROUND(100.0 * COUNT(*) FILTER (WHERE latency_user_perceived_ms > 20000)
        / NULLIF(COUNT(*), 0), 2)                          AS pct_over_20s
FROM agent_turn_metrics
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY turns_over_20s DESC;
```

**Target:** < 1 % overall, and ideally concentrated in `react_fallback` (where
Phase 3 tiering would be the lever). If the tail shows up in a *deterministic*
bucket, that's a regression — a service read is timing out, not reasoning.

---

## 3. Lane-shift effectiveness (route-before-reasoning)

Did traffic actually move out of `react_fallback`?

```sql
SELECT
  COALESCE(intent_bucket, 'unknown') AS bucket,
  COUNT(*)                           AS turns,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct_of_traffic
FROM agent_turn_metrics
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY turns DESC;
```

Compare the `react_fallback` share against the pre-deploy baseline. The win
condition is: most volume in deterministic buckets, with `react_fallback`
shrinking to the genuinely-analytical residual.

---

## 4. Correctness gates (must not regress)

Every phase carries these gates. Run alongside the latency queries — a latency
win that regresses correctness is a rollback candidate.

```sql
SELECT
  COALESCE(intent_bucket, 'unknown') AS bucket,
  ROUND(100.0 * AVG((fallback_used)::int), 2)              AS pct_fallback,
  ROUND(100.0 * AVG((navigate_directive_emitted)::int), 2) AS pct_nav_directive,
  ROUND(100.0 * AVG((guardrail_fired)::int), 2)            AS pct_guardrail,
  ROUND(AVG(NULLIF(react_iterations, 0))::numeric, 1)      AS avg_iters_when_react
FROM agent_turn_metrics
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY bucket;
```

- `pct_fallback` should not rise vs. baseline (deterministic buckets should be
  ~0; a nonzero fallback there means the lane threw and fail-opened to ReAct —
  see R7 — investigate the cause).
- `pct_nav_directive` / `pct_guardrail` should hold (navigate compliance).

---

## 5. Token / cost impact of the deterministic lanes

```sql
SELECT
  COALESCE(intent_bucket, 'unknown') AS bucket,
  SUM(tokens_in)                     AS tokens_in,
  SUM(tokens_out)                    AS tokens_out,
  ROUND(AVG(tokens_in)::numeric, 0)  AS avg_tokens_in,
  SUM(estimated_cost_vnd)            AS est_cost_vnd
FROM agent_turn_metrics
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY tokens_in DESC;
```

The financial / report lanes should show **zero tokens**. If they show tokens,
the lane failed open to ReAct for those turns (check the error_kind / logs).

---

## 6. Decision: is Phase 3/4 worth it?

After running the above:

- **If `react_fallback` p95 ≤ 12 s and >20 s tail < 1 %:** STOP. The
  deterministic lanes + streaming solved the problem. Do not build model tiering
  (Phase 3) or tool-result caching (Phase 4) speculatively.
- **If the >20 s tail is concentrated in `react_fallback` Case-3 analytical
  turns:** Phase 3 (model tiering / context diet) is the real remaining work.
  Re-derive the task list against *current* code first — much of the original
  Phase 1/2 has shipped.
- **If the tail appears in a deterministic bucket:** that's a regression, not a
  Phase-3 problem. A service read is slow/failing; trace `error_kind` and the
  per-read latency before anything else.

Record the numbers back into the plan doc's "Implementation update" section so
the next reviewer doesn't re-derive the baseline.
