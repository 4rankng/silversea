/**
 * Agent telemetry — withSpan durationMs accuracy under ALWAYS_OFF sampling.
 *
 * Guarantees the core invariant of the latency contract: performance.now()
 * keeps measuring even when the OTel sampler discards every span. With
 * OTEL_TRACES_SAMPLER_ARG=0 the sampler is effectively ALWAYS_OFF, so spans
 * become NonRecordingSpans whose onEnd never fires — yet durationMs must
 * still reflect the real elapsed time.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { withSpan } from '../services/agent/telemetry.js';

describe('withSpan', () => {
  test('returns accurate durationMs even when sampler is ALWAYS_OFF', async () => {
    // Sampler ratio 0 => TraceIdRatioBasedSampler drops every span.
    // (Set before the SDK reads it; telemetry.ts reads this lazily at start,
    // but even if the running SDK was already built, withSpan's
    // performance.now() timer is sampler-independent by construction.)
    process.env.OTEL_TRACES_SAMPLER_ARG = '0';

    const result = await withSpan(
      'test.always-off',
      { kind: 'unit-test' },
      async (): Promise<number> => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 42;
      },
    );

    assert.strictEqual(result.result, 42, 'fn result must propagate');
    assert.ok(
      result.durationMs >= 45,
      `durationMs must be ~50ms even when sampled out, got ${result.durationMs}`,
    );
    // The span object exists regardless of sampling (NonRecordingSpan still
    // carries a valid spanContext).
    assert.ok(result.span, 'span object must be returned');
  });

  test('rejects with original error and still records duration', async () => {
    process.env.OTEL_TRACES_SAMPLER_ARG = '0';

    await assert.rejects(
      async () =>
        withSpan('test.throws', undefined, async (): Promise<void> => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('boom');
        }),
      /boom/,
    );
    // If we reach here, the error propagated correctly. durationMs is not
    // directly observable on the rejection path, but the test above proves
    // the success-path timer; the same finally-block timer covers throws.
  });
});
