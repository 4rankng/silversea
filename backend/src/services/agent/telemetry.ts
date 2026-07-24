/**
 * withSpan — agent instrumentation helper.
 *
 * ---------------------------------------------------------------------------
 * LATENCY CONTRACT (read before editing):
 *
 * Latency columns in agent_turn_metrics are sourced ONLY from `durationMs`,
 * which this helper measures with `performance.now()`. NEVER read
 * `span.duration()` or spanContext timing for metrics, and NEVER write the
 * metrics row from a SpanProcessor.onEnd callback. OTel samples at span
 * CREATION, so a sampled-out span becomes a NonRecordingSpan whose onEnd
 * never fires — relying on it would silently zero out latency rows.
 * performance.now() is unaffected by sampling, so durationMs is always
 * accurate even when the sampler is ALWAYS_OFF.
 * ---------------------------------------------------------------------------
 *
 * No SpanProcessor is imported here, and span.duration() is never called.
 */
import { performance } from 'node:perf_hooks';
import {
  context,
  trace,
  type Attributes,
  type Span,
  type SpanStatusCode,
} from '@opentelemetry/api';

const TRACER_NAME = 'agent';
const tracer = trace.getTracer(TRACER_NAME);

export type SpanAttrs = Record<string, string | number | boolean | undefined>;

export interface WithSpanResult<T> {
  result: T;
  durationMs: number;
  span: Span;
}

export interface WithRootSpanResult<T> {
  result: T;
  durationMs: number;
  traceId: string;
}

/**
 * Wrap an async fn in an active OTel span AND measure its wall-clock duration
 * independently of the sampler. The returned `durationMs` is valid even when
 * the sampler discards the span (NonRecordingSpan).
 *
 * On rejection the original error is re-thrown; the span still records the
 * exception and ends. Callers that need durationMs on failure can read it
 * from the `span` field via a try/catch that captures the returned object —
 * but the simplest pattern is to measure latency around the await of this
 * helper itself.
 */
export async function withSpan<T>(
  name: string,
  attrs: SpanAttrs | undefined,
  fn: () => Promise<T>,
): Promise<WithSpanResult<T>> {
  const start = performance.now();
  // startActiveSpan returns the fn's resolved value synchronously-wrapped in
  // a promise; the span is ended by the callback we pass.
  return tracer.startActiveSpan(name, async (span: Span): Promise<WithSpanResult<T>> => {
    if (attrs) {
      const otelAttrs: Attributes = {};
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== undefined) otelAttrs[k] = v;
      }
      span.setAttributes(otelAttrs);
    }

    try {
      const result = await fn();
      return { result, durationMs: performance.now() - start, span };
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: 2 satisfies SpanStatusCode, // SpanStatusCode.ERROR
        message: err instanceof Error ? err.message : String(err),
      });
      throw err; // re-throw original; durationMs is observable via start/now if needed
    } finally {
      span.end();
    }
  });
}

/**
 * Like withSpan but returns the root span's traceId (stored in the metrics row
 * so a trace can be looked up from a DB row). traceId is read from
 * spanContext() which is populated even for NonRecordingSpans.
 */
export async function withRootSpan<T>(
  name: string,
  attrs: SpanAttrs | undefined,
  fn: () => Promise<T>,
): Promise<WithRootSpanResult<T>> {
  const start = performance.now();
  return tracer.startActiveSpan(name, async (span: Span): Promise<WithRootSpanResult<T>> => {
    if (attrs) {
      const otelAttrs: Attributes = {};
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== undefined) otelAttrs[k] = v;
      }
      span.setAttributes(otelAttrs);
    }

    const traceId = span.spanContext().traceId;

    try {
      const result = await fn();
      return { result, durationMs: performance.now() - start, traceId };
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: 2 satisfies SpanStatusCode,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Read the active trace id at call time (for ad-hoc correlation outside a
 * withSpan call). Returns undefined when no span is active.
 */
export function activeTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId;
}
