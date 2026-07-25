/**
 * OpenTelemetry SDK bootstrap.
 *
 * MUST be the first import in src/index.ts: under ESM + tsx watch, auto-
 * instrumentation can only patch modules it sees loaded AFTER this file
 * initializes, so it must run before express/pg/ioredis are imported.
 *
 * Exporter + sampler are env-configurable:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  -> OTLP HTTP trace exporter (else Console)
 *   OTEL_TRACES_SAMPLER_ARG      -> TraceIdRatioBased ratio 0..1 (default 0.1)
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import {
  ConsoleSpanExporter,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/** Read the trace-sampler ratio (0..1) from OTEL_TRACES_SAMPLER_ARG. */
export function readSamplerRatio(): number {
  const raw = process.env.OTEL_TRACES_SAMPLER_ARG;
  if (raw === undefined || raw === '') return 0.1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0.1;
  return parsed;
}

// Surface SDK diagnostic warnings in dev only.
if (process.env.NODE_ENV !== 'production') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

function buildExporter() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint && endpoint.trim() !== '') {
    return new OTLPTraceExporter({ url: endpoint });
  }
  return new ConsoleSpanExporter();
}

let startedSdk: NodeSDK | undefined;

function startSdk(): NodeSDK {
  if (startedSdk) return startedSdk;

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'transting-backend',
    }),
    traceExporter: buildExporter(),
    // Disable metrics: the SDK otherwise defaults OTEL_METRICS_EXPORTER to
    // 'otlp' and spins up a PeriodicExportingMetricReader pointing at
    // http://localhost:4318/v1/metrics, which fails with AggregateError on
    // every interval when no collector is running. We don't record any
    // metrics, so opt out explicitly.
    metricReaders: [],
    sampler: new TraceIdRatioBasedSampler(readSamplerRatio()),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  startedSdk = sdk;

  const shutdown = async (): Promise<void> => {
    try {
      await sdk.shutdown();
    } catch {
      // Best-effort flush on shutdown; ignore failures during teardown.
    }
  };

  // Graceful flush on normal exit (no signal) + on SIGTERM/SIGINT. `beforeExit`
  // is an EVENT, not a method — register it via `.on`, not a call.
  process.on('beforeExit', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  return sdk;
}

/** Started NodeSDK instance (idempotent across re-imports). */
export const sdk: NodeSDK = startSdk();
