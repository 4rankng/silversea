// TanStack Query hooks for the ADMIN chatbot performance dashboard.
//
// Each endpoint is a separate query so the dashboard sections can render
// independently as their data arrives (the summary card doesn't wait on the
// timeseries chart, etc.). staleTime of 60s matches the cadence the metrics
// API refreshes its aggregations — finer polling just burns tokens for no new
// signal. See useDashboardQueries.ts for the same useQuery + qk pattern.
import { useQuery } from '@tanstack/react-query';
import { chatbotMetricsClient } from '../api/chatbotMetricsClient';
import { qk } from '../api/keys';
import type {
  ChatbotMetricSummary,
  ChatbotLatencyBreakdown,
  ChatbotToolStat,
  ChatbotMetricDay,
  ChatbotRecentTurn,
} from '@tingting/shared';

const STALE_TIME = 60_000;

export function useChatbotMetricsSummary(range: string) {
  return useQuery<ChatbotMetricSummary>({
    queryKey: qk.chatbotMetrics.summary(range),
    queryFn: () => chatbotMetricsClient.getSummary(range),
    staleTime: STALE_TIME,
  });
}

export function useChatbotLatencyBreakdown(range: string) {
  return useQuery<ChatbotLatencyBreakdown>({
    queryKey: qk.chatbotMetrics.latency(range),
    queryFn: () => chatbotMetricsClient.getLatency(range),
    staleTime: STALE_TIME,
  });
}

export function useChatbotTools(range: string) {
  return useQuery<ChatbotToolStat[]>({
    queryKey: qk.chatbotMetrics.tools(range),
    queryFn: () => chatbotMetricsClient.getTools(range),
    staleTime: STALE_TIME,
  });
}

export function useChatbotTimeseries(range: string) {
  return useQuery<ChatbotMetricDay[]>({
    queryKey: qk.chatbotMetrics.timeseries(range),
    queryFn: () => chatbotMetricsClient.getTimeseries(range),
    staleTime: STALE_TIME,
  });
}

export function useChatbotRecent({
  range,
  sort,
  limit,
}: {
  range: string;
  sort: string;
  limit: number;
}) {
  return useQuery<ChatbotRecentTurn[]>({
    queryKey: qk.chatbotMetrics.recent(range, sort, limit),
    queryFn: () => chatbotMetricsClient.getRecent({ range, sort, limit }),
    staleTime: STALE_TIME,
  });
}
