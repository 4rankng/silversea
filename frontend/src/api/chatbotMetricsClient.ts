// Typed API client for the ADMIN chatbot performance-monitoring endpoints.
//
// All paths come from the shared CHATBOT_METRICS_PATHS constant so the wire
// contract is defined once in @tingting/shared (alongside the response types).
// The `api` wrapper handles the JWT (Authorization header) + base URL + JSON
// parsing; we only build the query string for the `range` / `sort` / `limit`
// params the aggregation API accepts. See reportClient.ts for the same
// `api.get` + toQuery pattern.
import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { CHATBOT_METRICS_PATHS } from '@tingting/shared';
import type {
  ChatbotMetricSummary,
  ChatbotLatencyBreakdown,
  ChatbotToolStat,
  ChatbotMetricDay,
  ChatbotRecentTurn,
} from '@tingting/shared';

export const chatbotMetricsClient = {
  /** Top-level summary card (turns, p50/p95/p99, error rates, tokens, SLA). */
  getSummary: (range: string) =>
    api.get<ChatbotMetricSummary>(
      `${CHATBOT_METRICS_PATHS.metrics}${toQuery({ range })}`,
    ),

  /** Average of each pipeline stage latency (llm / tools / final / ack / persist). */
  getLatency: (range: string) =>
    api.get<ChatbotLatencyBreakdown>(
      `${CHATBOT_METRICS_PATHS.latency}${toQuery({ range })}`,
    ),

  /** Per-tool aggregate (calls, p95, errorRate). */
  getTools: (range: string) =>
    api.get<ChatbotToolStat[]>(
      `${CHATBOT_METRICS_PATHS.tools}${toQuery({ range })}`,
    ),

  /** Daily aggregation for the timeseries chart. */
  getTimeseries: (range: string) =>
    api.get<ChatbotMetricDay[]>(
      `${CHATBOT_METRICS_PATHS.timeseries}${toQuery({ range })}`,
    ),

  /** Recent individual turns (newest first) for the audit table. */
  getRecent: ({ range, sort, limit }: { range: string; sort: string; limit: number }) =>
    api.get<ChatbotRecentTurn[]>(
      `${CHATBOT_METRICS_PATHS.recent}${toQuery({ range, sort, limit })}`,
    ),
};
