/**
 * Admin chatbot (agent) performance monitoring — read-only aggregation API.
 *
 * Surfaces per-turn metrics from `agent_turn_metrics` as rolled-up summaries,
 * latency breakdowns, per-tool stats, a daily timeseries, and a recent-turns
 * table. All handlers accept `?range=7d|30d` (default 7d) and filter on
 * created_at >= (now - range). RBAC: the `chatbot-metrics` Casbin action is
 * applied at mount time; the existing ADMIN wildcard (`p, ADMIN, *, *`) grants
 * ADMIN, every other role gets 403 — no policy edits here.
 *
 * NULL-SAFETY CONTRACT — percentile_cont / AVG over empty or all-null sets
 * return NULL. We preserve null everywhere (the frontend renders '—'); never
 * COALESCE to 0, which would corrupt latency/error visuals.
 *
 * Postgres pattern: `percentile_cont(0.95) WITHIN GROUP (ORDER BY col)` is the
 * only correct way to get a continuous p95 from a column. AVG returns numeric;
 * cast to double precision for a stable JSON number shape.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { and, gte, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import { asyncHandler } from '../middleware/asyncHandler';
import { config } from '../config';
import type {
  ChatbotMetricSummary,
  ChatbotLatencyBreakdown,
  ChatbotMetricDay,
  ChatbotToolStat,
  ChatbotRecentTurn,
} from '@tingting/shared';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Safe rate: numerator / denominator, or 0 when there are no turns.
 * Factored out so it can be unit-tested without a database — the empty-set
 * case (0 denominator) is exactly the "no data yet" dashboard state and must
 * read as 0, not NaN/null (0% error rate is the honest value for zero turns).
 */
export function computeRate(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/** Parse `?range=7d|30d` → a Date to filter created_at against. Default 7d. */
function parseSince(req: Request): Date {
  const r = (req.query.range as string | undefined)?.trim().toLowerCase();
  const days = r === '30d' ? 30 : 7;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Coerce a possibly-null numeric aggregate to a clean number|null. */
function toNullableNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── GET /metrics → ChatbotMetricSummary ───────────────────────────────────
router.get('/metrics', asyncHandler(async (req: Request, res: Response) => {
  const since = parseSince(req);
  // Single roll-up query: counts, sums, averages, and three percentiles for
  // each of the two latency columns. percentile_cont over an empty/all-null
  // set returns NULL — preserved verbatim (frontend renders '—').
  const rows = await db.select({
    turns: sql<number>`count(*)::int`,
    activeUsers: sql<number>`count(distinct ${schema.agentTurnMetrics.userId})::int`,
    // Postgres ordered-set aggregate. Cast the column to double precision so the
    // percentile is computed on a continuous domain (integer percentiles would
    // round to the nearest sample).
    upP50: sql<number | null>`percentile_cont(0.5)  within group (order by coalesce(${schema.agentTurnMetrics.latencyClientWaitMs}, ${schema.agentTurnMetrics.latencyUserPerceivedMs})::double precision)`,
    upP95: sql<number | null>`percentile_cont(0.95) within group (order by coalesce(${schema.agentTurnMetrics.latencyClientWaitMs}, ${schema.agentTurnMetrics.latencyUserPerceivedMs})::double precision)`,
    upP99: sql<number | null>`percentile_cont(0.99) within group (order by coalesce(${schema.agentTurnMetrics.latencyClientWaitMs}, ${schema.agentTurnMetrics.latencyUserPerceivedMs})::double precision)`,
    mpP50: sql<number | null>`percentile_cont(0.5)  within group (order by ${schema.agentTurnMetrics.latencyTotalMs}::double precision)`,
    mpP95: sql<number | null>`percentile_cont(0.95) within group (order by ${schema.agentTurnMetrics.latencyTotalMs}::double precision)`,
    mpP99: sql<number | null>`percentile_cont(0.99) within group (order by ${schema.agentTurnMetrics.latencyTotalMs}::double precision)`,
    errors: sql<number>`count(*) filter (where ${schema.agentTurnMetrics.errorKind} is not null and ${schema.agentTurnMetrics.errorKind} !~ '^final_')::int`,
    // P0b — final-answer degradations: errorKind carries a `final_` prefix
    // (final_timeout / final_schema / ...) when the structured card fell back to
    // prose. Kept OUT of `errors` above so errorRate stays pure ReAct-loop only.
    finalFallbacks: sql<number>`count(*) filter (where ${schema.agentTurnMetrics.errorKind} ~ '^final_')::int`,
    timeouts: sql<number>`count(*) filter (where ${schema.agentTurnMetrics.errorKind} = 'timeout')::int`,
    fallbacks: sql<number>`count(*) filter (where ${schema.agentTurnMetrics.fallbackUsed})::int`,
    reactTurns: sql<number>`count(*) filter (where coalesce(${schema.agentTurnMetrics.reactIterations}, 0) > 0)::int`,
    finalAvoided: sql<number>`count(*) filter (where coalesce(${schema.agentTurnMetrics.reactIterations}, 0) > 0 and coalesce(${schema.agentTurnMetrics.latencyFinalMs}, 0) = 0)::int`,
    aborts: sql<number>`count(*) filter (where ${schema.agentTurnMetrics.aborted})::int`,
    navigateDirectives: sql<number>`count(*) filter (where ${schema.agentTurnMetrics.navigateDirectiveEmitted})::int`,
    guardrailFires: sql<number>`count(*) filter (where ${schema.agentTurnMetrics.guardrailFired})::int`,
    avgIterations: sql<number | null>`avg(${schema.agentTurnMetrics.reactIterations})::double precision`,
    avgToolCalls: sql<number | null>`avg(${schema.agentTurnMetrics.toolCallCount})::double precision`,
    tokensIn: sql<number>`coalesce(sum(${schema.agentTurnMetrics.tokensIn}), 0)::bigint`,
    tokensOut: sql<number>`coalesce(sum(${schema.agentTurnMetrics.tokensOut}), 0)::bigint`,
    // P0 — time-to-first-token percentiles. Null over an empty/all-null set.
    ttftP50: sql<number | null>`percentile_cont(0.5)  within group (order by ${schema.agentTurnMetrics.latencyFirstTokenMs}::double precision)`,
    ttftP95: sql<number | null>`percentile_cont(0.95) within group (order by ${schema.agentTurnMetrics.latencyFirstTokenMs}::double precision)`,
    ttftP99: sql<number | null>`percentile_cont(0.99) within group (order by ${schema.agentTurnMetrics.latencyFirstTokenMs}::double precision)`,
  })
    .from(schema.agentTurnMetrics)
    .where(gte(schema.agentTurnMetrics.createdAt, since));

  const r = rows[0] ?? null;
  // No rows in range → return a zeroed summary with null percentiles. The
  // dashboard renders this state without divide-by-zero artifacts.
  if (!r || Number(r.turns) === 0) {
    const empty: ChatbotMetricSummary = {
      turns: 0,
      activeUsers: 0,
      userPerceived: { p50Ms: null, p95Ms: null, p99Ms: null },
      modelPipeline: { p50Ms: null, p95Ms: null, p99Ms: null },
      errorRate: 0,
      timeoutRate: 0,
      fallbackRate: 0,
      finalAvoidanceRate: null,
      finalFallbackRate: 0,
      fallbackReasons: [],
      abortRate: 0,
      navigateRate: 0,
      guardrailRate: 0,
      avgIterations: null,
      avgToolCallsPerTurn: null,
      tokensIn: 0,
      tokensOut: 0,
      sla: { p95GreenMs: config.agentSlaP95GreenMs, p95AmberMs: config.agentSlaP95AmberMs },
      ttft: { p50Ms: null, p95Ms: null, p99Ms: null },
      intentBuckets: [],
    };
    res.json(empty);
    return;
  }

  const turns = Number(r.turns);
  // P0b — fallback-cause breakdown: a separate GROUP BY (the roll-up above is a
  // single ungrouped aggregate) bucketing the `final_*` errorKind values so the
  // dashboard can show WHY turns fall back. Only runs when there's data in range.
  const reasonRows = await db.select({
    reason: schema.agentTurnMetrics.errorKind,
    count: sql<number>`count(*)::int`,
  })
    .from(schema.agentTurnMetrics)
    .where(and(
      gte(schema.agentTurnMetrics.createdAt, since),
      sql`${schema.agentTurnMetrics.errorKind} ~ '^final_'`,
    ))
    .groupBy(schema.agentTurnMetrics.errorKind);

  // P0 — intent-lane distribution: how many turns each lane handled. Coalesce
  // NULL (pre-column rows) to 'unknown'. Sorted by count desc so the dominant
  // lane reads first on the dashboard.
  const intentRows = await db.select({
    bucket: sql<string>`coalesce(${schema.agentTurnMetrics.intentBucket}, 'unknown')`,
    count: sql<number>`count(*)::int`,
    p50Ms: sql<number | null>`percentile_cont(0.5) within group (order by coalesce(${schema.agentTurnMetrics.latencyClientWaitMs}, ${schema.agentTurnMetrics.latencyUserPerceivedMs})::double precision)`,
    p95Ms: sql<number | null>`percentile_cont(0.95) within group (order by coalesce(${schema.agentTurnMetrics.latencyClientWaitMs}, ${schema.agentTurnMetrics.latencyUserPerceivedMs})::double precision)`,
    // Null means unknown work (for example a client-aborted in-flight turn),
    // so exclude it from the average instead of fabricating a zero-token turn.
    avgTokens: sql<number | null>`avg(${schema.agentTurnMetrics.tokensIn} + ${schema.agentTurnMetrics.tokensOut})::double precision`,
    fallbacks: sql<number>`count(*) filter (where ${schema.agentTurnMetrics.fallbackUsed})::int`,
    avgIterations: sql<number | null>`avg(${schema.agentTurnMetrics.reactIterations})::double precision`,
  })
    .from(schema.agentTurnMetrics)
    .where(gte(schema.agentTurnMetrics.createdAt, since))
    .groupBy(sql`coalesce(${schema.agentTurnMetrics.intentBucket}, 'unknown')`);

  const summary: ChatbotMetricSummary = {
    turns,
    activeUsers: Number(r.activeUsers),
    userPerceived: {
      p50Ms: toNullableNum(r.upP50),
      p95Ms: toNullableNum(r.upP95),
      p99Ms: toNullableNum(r.upP99),
    },
    modelPipeline: {
      p50Ms: toNullableNum(r.mpP50),
      p95Ms: toNullableNum(r.mpP95),
      p99Ms: toNullableNum(r.mpP99),
    },
    errorRate: computeRate(Number(r.errors), turns),
    timeoutRate: computeRate(Number(r.timeouts), turns),
    fallbackRate: computeRate(Number(r.fallbacks), turns),
    finalAvoidanceRate: Number(r.reactTurns) > 0
      ? computeRate(Number(r.finalAvoided), Number(r.reactTurns))
      : null,
    finalFallbackRate: computeRate(Number(r.finalFallbacks), turns),
    fallbackReasons: reasonRows
      .map((rr) => ({ reason: rr.reason ?? '', count: Number(rr.count) }))
      .sort((a, b) => b.count - a.count),
    abortRate: computeRate(Number(r.aborts), turns),
    navigateRate: computeRate(Number(r.navigateDirectives), turns),
    guardrailRate: computeRate(Number(r.guardrailFires), turns),
    avgIterations: toNullableNum(r.avgIterations),
    avgToolCallsPerTurn: toNullableNum(r.avgToolCalls),
    tokensIn: Number(r.tokensIn),
    tokensOut: Number(r.tokensOut),
    sla: { p95GreenMs: config.agentSlaP95GreenMs, p95AmberMs: config.agentSlaP95AmberMs },
    ttft: {
      p50Ms: toNullableNum(r.ttftP50),
      p95Ms: toNullableNum(r.ttftP95),
      p99Ms: toNullableNum(r.ttftP99),
    },
    intentBuckets: intentRows
      .map((ir) => ({
        bucket: ir.bucket,
        count: Number(ir.count),
        p50Ms: toNullableNum(ir.p50Ms),
        p95Ms: toNullableNum(ir.p95Ms),
        avgTokens: toNullableNum(ir.avgTokens),
        fallbackRate: computeRate(Number(ir.fallbacks), Number(ir.count)),
        avgIterations: toNullableNum(ir.avgIterations),
      }))
      .sort((a, b) => b.count - a.count),
  };
  res.json(summary);
}));

// ─── GET /metrics/latency → ChatbotLatencyBreakdown ────────────────────────
// Average of each pipeline-stage latency. AVG ignores nulls by default, and
// returns null over an empty set — exactly the contract we want (do NOT
// COALESCE to 0; a stage that never ran must read '—', not 0ms).
router.get('/metrics/latency', asyncHandler(async (req: Request, res: Response) => {
  const since = parseSince(req);
  const rows = await db.select({
    llmMs: sql<number | null>`avg(${schema.agentTurnMetrics.latencyLlmMs})::double precision`,
    toolsMs: sql<number | null>`avg(${schema.agentTurnMetrics.latencyToolsMs})::double precision`,
    finalMs: sql<number | null>`avg(${schema.agentTurnMetrics.latencyFinalMs})::double precision`,
    ackMs: sql<number | null>`avg(${schema.agentTurnMetrics.latencyAckMs})::double precision`,
    persistMs: sql<number | null>`avg(${schema.agentTurnMetrics.latencyPersistMs})::double precision`,
    firstTokenMs: sql<number | null>`avg(${schema.agentTurnMetrics.latencyFirstTokenMs})::double precision`,
  })
    .from(schema.agentTurnMetrics)
    .where(gte(schema.agentTurnMetrics.createdAt, since));

  const r = rows[0] ?? {};
  const breakdown: ChatbotLatencyBreakdown = {
    llmMs: toNullableNum(r.llmMs),
    toolsMs: toNullableNum(r.toolsMs),
    finalMs: toNullableNum(r.finalMs),
    ackMs: toNullableNum(r.ackMs),
    persistMs: toNullableNum(r.persistMs),
    firstTokenMs: toNullableNum(r.firstTokenMs),
  };
  res.json(breakdown);
}));

// ─── GET /metrics/tools → ChatbotToolStat[] ────────────────────────────────
// The per-turn `tool_trace` jsonb is an array of { toolName, ok, args?, ... }.
// We fetch the recent traces and reduce IN-APP, aggregating calls + errorRate
// per toolName. There is NO per-call duration in the trace today, so a true
// per-tool p95 cannot be computed honestly — p95Ms is returned as null rather
// than fabricated from the turn-level latency_tools_ms.
//
// TODO(Phase 2 instrumentation): capture per-call duration in each tool_trace
// entry (e.g. { toolName, ok, durationMs }) and compute a real per-tool p95
// here via a percentile over the flattened call list. Until then p95Ms stays
// null; the dashboard renders '—' for it.
router.get('/metrics/tools', asyncHandler(async (req: Request, res: Response) => {
  const since = parseSince(req);
  const rows = await db.select({
    toolTrace: schema.agentMessages.toolTrace,
  })
    .from(schema.agentTurnMetrics)
    .innerJoin(
      schema.agentMessages,
      // messageId is the PK of agent_turn_metrics and FK → agent_messages.id (1:1).
      sql`${schema.agentTurnMetrics.messageId} = ${schema.agentMessages.id}`,
    )
    .where(gte(schema.agentTurnMetrics.createdAt, since));

  // Aggregate in-app. Unknown trace shapes are skipped defensively — a corrupt
  // row must never abort the whole reduce.
  const acc = new Map<string, { calls: number; errors: number }>();
  for (const row of rows) {
    const trace = row.toolTrace;
    if (!Array.isArray(trace)) continue;
    for (const entry of trace) {
      if (!entry || typeof entry !== 'object') continue;
      const name = (entry as { toolName?: unknown }).toolName;
      if (typeof name !== 'string' || name === '') continue;
      const ok = (entry as { ok?: unknown }).ok;
      const bucket = acc.get(name) ?? { calls: 0, errors: 0 };
      bucket.calls += 1;
      if (ok === false) bucket.errors += 1;
      acc.set(name, bucket);
    }
  }

  const stats: ChatbotToolStat[] = Array.from(acc.entries())
    .map(([name, b]) => ({
      name,
      calls: b.calls,
      p95Ms: null, // honest: no per-call duration captured yet (see TODO above)
      errorRate: computeRate(b.errors, b.calls),
    }))
    .sort((a, b) => b.calls - a.calls); // busiest tool first

  res.json(stats);
}));

// ─── GET /metrics/timeseries → ChatbotMetricDay[] ──────────────────────────
// Daily buckets of user-perceived latency. date_trunc('day', ...) groups by
// calendar day in the DB timezone; the result is cast to a YYYY-MM-DD string
// for stable JSON transport. avg + p95 are null over an empty bucket (which
// can't actually happen since the GROUP BY only emits non-empty days, but the
// null-handling is kept defensive).
router.get('/metrics/timeseries', asyncHandler(async (req: Request, res: Response) => {
  const since = parseSince(req);
  const rows = await db.select({
    date: sql<string>`to_char(date_trunc('day', ${schema.agentTurnMetrics.createdAt}), 'YYYY-MM-DD')`,
    avgMs: sql<number | null>`avg(coalesce(${schema.agentTurnMetrics.latencyClientWaitMs}, ${schema.agentTurnMetrics.latencyUserPerceivedMs}))::double precision`,
    p95Ms: sql<number | null>`percentile_cont(0.95) within group (order by coalesce(${schema.agentTurnMetrics.latencyClientWaitMs}, ${schema.agentTurnMetrics.latencyUserPerceivedMs})::double precision)`,
    turns: sql<number>`count(*)::int`,
  })
    .from(schema.agentTurnMetrics)
    .where(gte(schema.agentTurnMetrics.createdAt, since))
    .groupBy(sql`date_trunc('day', ${schema.agentTurnMetrics.createdAt})`)
    .orderBy(sql`date_trunc('day', ${schema.agentTurnMetrics.createdAt}) asc`);

  const days: ChatbotMetricDay[] = rows.map(r => ({
    date: r.date,
    avgMs: toNullableNum(r.avgMs),
    p95Ms: toNullableNum(r.p95Ms),
    turns: Number(r.turns),
  }));
  res.json(days);
}));

// ─── GET /metrics/recent → ChatbotRecentTurn[] ─────────────────────────────
// Latest (or slowest) turns joined to their assistant message for content.
// `assistantText` is extracted from the agent_messages.response jsonb: a
// `text` response yields content; an `insight_card` yields its summary; a
// `directive` yields the directive key (no natural-language body). Anything
// else → null.
//
// `userContent` is the preceding user turn in the same conversation. Rather
// than a fragile self-join on "the row created just before this one", we use
// the conversation title as a stable proxy — it summarises the conversation
// topic and is always present, while the preceding-row join is brittle under
// concurrent inserts. Documented trade-off: title is topic, not verbatim.
router.get('/metrics/recent', asyncHandler(async (req: Request, res: Response) => {
  const since = parseSince(req);
  const sort = (req.query.sort as string | undefined)?.trim().toLowerCase() === 'slowest'
    ? 'slowest'
    : 'recent';
  // Clamp limit into [1, 100]; default 20.
  const rawLimit = Number.parseInt((req.query.limit as string | undefined) ?? '', 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(100, Math.max(1, rawLimit))
    : 20;

  // Order column depends on sort. slowest = user-perceived desc nulls last;
  // recent (default) = created_at desc.
  const orderExpr = sort === 'slowest'
    ? sql`coalesce(${schema.agentTurnMetrics.latencyClientWaitMs}, ${schema.agentTurnMetrics.latencyUserPerceivedMs}) desc nulls last`
    : desc(schema.agentTurnMetrics.createdAt);

  const rows = await db.select({
    messageId: schema.agentTurnMetrics.messageId,
    traceId: schema.agentTurnMetrics.traceId,
    createdAt: schema.agentTurnMetrics.createdAt,
    role: schema.agentTurnMetrics.role,
    latencyUserPerceivedMs: sql<number | null>`coalesce(${schema.agentTurnMetrics.latencyClientWaitMs}, ${schema.agentTurnMetrics.latencyUserPerceivedMs})`,
    latencyTotalMs: schema.agentTurnMetrics.latencyTotalMs,
    errorKind: schema.agentTurnMetrics.errorKind,
    fallbackUsed: schema.agentTurnMetrics.fallbackUsed,
    model: schema.agentTurnMetrics.model,
    reactIterations: schema.agentTurnMetrics.reactIterations,
    toolCallCount: schema.agentTurnMetrics.toolCallCount,
    response: schema.agentMessages.response,
    conversationTitle: schema.agentConversations.title,
  })
    .from(schema.agentTurnMetrics)
    .innerJoin(
      schema.agentMessages,
      sql`${schema.agentTurnMetrics.messageId} = ${schema.agentMessages.id}`,
    )
    .leftJoin(
      schema.agentConversations,
      sql`${schema.agentTurnMetrics.conversationId} = ${schema.agentConversations.id}`,
    )
    // NB: every agent_turn_metrics row is an assistant turn by the 1:1
    // invariant (only persisted assistant turns write a row), so no role filter
    // is needed here — the `role` column holds the caller's RBAC role
    // (ADMIN/MANAGER/…), NEVER 'assistant'. The preceding user turn is surfaced
    // via the conversation title proxy.
    .where(gte(schema.agentTurnMetrics.createdAt, since))
    .orderBy(orderExpr)
    .limit(limit);

  const turns: ChatbotRecentTurn[] = rows.map(r => {
    // Extract assistantText from the response jsonb by its discriminator.
    const resp = r.response as { type?: string; content?: unknown; summary?: unknown; directive?: { kind?: unknown } } | null;
    let assistantText: string | null = null;
    if (resp && typeof resp === 'object') {
      if (resp.type === 'text' && typeof resp.content === 'string') {
        assistantText = resp.content;
      } else if (resp.type === 'insight_card' && typeof resp.summary === 'string') {
        assistantText = resp.summary;
      } else if (resp.type === 'directive' && resp.directive && typeof resp.directive.kind === 'string') {
        // AgentDirective discriminates on `kind` (navigate/focus/open/prefill/toast/scrollTo),
        // NOT `key` — surfacing it gives ADMIN a meaningful action label per turn.
        assistantText = resp.directive.kind;
      }
    }
    return {
      messageId: r.messageId,
      traceId: r.traceId,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
      role: r.role ?? '',
      latencyUserPerceivedMs: toNullableNum(r.latencyUserPerceivedMs),
      latencyTotalMs: toNullableNum(r.latencyTotalMs),
      errorKind: r.errorKind ?? null,
      fallbackUsed: Boolean(r.fallbackUsed),
      model: r.model ?? '',
      reactIterations: toNullableNum(r.reactIterations),
      toolCallCount: Number(r.toolCallCount ?? 0),
      // Conversation title as a stable topic proxy (see note above).
      userContent: r.conversationTitle ?? '',
      assistantText,
    };
  });

  res.json(turns);
}));

export default router;
