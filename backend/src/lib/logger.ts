/**
 * Pino structured logger.
 *
 * Each log line mixes in trace_id + span_id from the currently active OTel
 * span (when any), so log records correlate with traces. In development we
 * route through pino-pretty; in production we emit newline-delimited JSON.
 */
import pino, { type LoggerOptions } from 'pino';
import { trace, type Span } from '@opentelemetry/api';

function traceMixin(): { trace_id?: string; span_id?: string } {
  const span: Span | undefined = trace.getActiveSpan();
  if (!span) return {};
  const ctx = span.spanContext();
  // Non-recording (sampled-out) spans still expose ids; include them so logs
  // remain correlatable even when traces are dropped.
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  mixin: () => traceMixin(),
};

// Pretty transport owns a worker thread. Keep it out of test workers and
// redirected/CI output; those consumers expect plain structured logs and must
// be able to terminate without waiting for a development-only transport.
const usePretty = process.env.NODE_ENV !== 'production'
  && process.env.NODE_ENV !== 'test'
  && process.env.NODE_TEST_CONTEXT == null
  && process.stdout.isTTY === true;

const options: LoggerOptions = usePretty
  ? {
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    }
  : baseOptions;

const logger = pino(options);

export default logger;
