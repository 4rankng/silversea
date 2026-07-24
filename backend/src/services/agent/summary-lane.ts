// Summary Lane (P3) — role-aware "daily work assistant" with ZERO LLM calls.
//
// When the intent router detects a summary intent ("tóm tắt việc hôm nay",
// "cần làm gì", "tình hình"), this lane calls getDashboardStats() (which already
// aggregates everything in parallel) and formats the result into an insight_card
// with KPI widgets + an anomaly list + action chips.
//
// This is BETTER than the plan's original "parallel tools + 1 fast synthesis"
// design: by reusing the existing dashboard aggregation (which the human
// dashboard already uses at acceptable latency), we avoid ANY LLM call. The
// summary is deterministic, fast, and always traceable to real tool data.
//
// Role-awareness: ACCOUNTANT sees receivables/payables/settlements;
// MANAGER sees dispatch/profit/fleet; ADMIN sees the superset.

import type { AgentResponse, AgentWidget, AgentRouteKey } from '@tingting/shared';
import type { DashboardStats, DashboardDecisionItem, DashboardDecisionKind } from '@tingting/shared';
import { AGENT_ROUTE_KEYS, PAGE_CATALOG } from '@tingting/shared';
import { getDashboardStats } from '../dashboard-stats.service.js';
import { getMetric } from '../metrics/metric-registry.js';
import { toProvenance } from '../metrics/metric-types.js';

// ─── Role → decision-kind filter ────────────────────────────────────────────
// Each role sees the decision items relevant to their daily work. This mirrors
// the HLD §10 daily-work-assistant personas.

const ROLE_DECISION_FILTERS: Record<string, DashboardDecisionKind[] | 'all'> = {
  // ACCOUNTANT: money-focused — receivables, payables, trip data, renewals.
  ACCOUNTANT: ['receivables', 'trip-data', 'renewal', 'fuel', 'profit-close'],
  // MANAGER: operations-focused — dispatch, trip-lock, profit, receivables.
  MANAGER: ['dispatch', 'trip-lock', 'receivables', 'profit-close', 'fuel'],
  // ADMIN: sees everything.
  ADMIN: 'all',
};

/** Filter decision items by role, sorted by priority (lower = more urgent). */
function filterByRole(items: DashboardDecisionItem[], role: string): DashboardDecisionItem[] {
  const filter = ROLE_DECISION_FILTERS[role] ?? 'all';
  const filtered = filter === 'all' ? items : items.filter((it) => filter.includes(it.kind));
  return filtered.sort((a, b) => a.priority - b.priority).slice(0, 6);
}

// ─── Severity → anomaly severity mapping ────────────────────────────────────
const SEVERITY_MAP: Record<string, 'low' | 'med' | 'high'> = {
  critical: 'high',
  warning: 'med',
  info: 'low',
  success: 'low',
};

// ─── Action chips from decision items ────────────────────────────────────────
// Each decision item may carry a `route` (SPA path). Convert navigable ones to
// action chips so the user can jump directly to the relevant page.

/** Try to match a SPA path to a known routeKey. Returns the routeKey or null. */
function pathToRouteKey(path: string | undefined): AgentRouteKey | null {
  if (!path) return null;
  // The dashboard decision items use SPA paths like '/debt', '/trips', etc.
  // Match against the static portion of known route paths.
  const staticPart = '/' + path.split('/').filter(Boolean)[0];
  for (const k of AGENT_ROUTE_KEYS) {
    const entry = PAGE_CATALOG[k];
    const entryPath = typeof entry.path === 'string' ? entry.path : '';
    if (entryPath === staticPart || entryPath === path) return k;
  }
  return null;
}

/** Build action chips from decision items that have a route. */
function buildActionChips(items: DashboardDecisionItem[]): { label: string; directive: { kind: 'navigate'; routeKey: AgentRouteKey } }[] {
  const chips: { label: string; directive: { kind: 'navigate'; routeKey: AgentRouteKey } }[] = [];
  for (const item of items) {
    if (!item.actionLabel || !item.route) continue;
    const routeKey = pathToRouteKey(item.route);
    if (routeKey) {
      chips.push({ label: item.actionLabel, directive: { kind: 'navigate', routeKey } });
    }
  }
  // Deduplicate by routeKey (keep first).
  const seen = new Set<string>();
  return chips.filter((c) => {
    const key = c.directive.routeKey;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

// ─── KPI widget builder ─────────────────────────────────────────────────────

/** P4 — resolve provenance from the metric registry, falling back to observed. */
function metricProv(metricId: string): { metricId?: string; category: 'observed' | 'calculated' | 'forecast' | 'assumption'; formula?: string } {
  const def = getMetric(metricId);
  if (def) return toProvenance(def);
  return { metricId, category: 'observed' };
}

function buildKpiWidget(stats: DashboardStats): AgentWidget {
  return {
    type: 'kpi_grid',
    items: [
      // P4: provenance resolved from the metric registry.
      {
        label: 'Doanh thu tháng',
        value: Number(stats.revenue || 0),
        format: 'vnd',
        provenance: metricProv('period_revenue'),
      },
      {
        label: 'Lợi nhuận gộp',
        value: Number(stats.grossProfit || 0),
        format: 'vnd',
        provenance: metricProv('period_gross_profit'),
      },
      {
        label: 'Chạy trong tháng',
        value: Number(stats.tripCount || 0),
        format: 'number',
        provenance: metricProv('trip_count'),
      },
      {
        label: 'Đang chạy',
        value: Number(stats.inTransitTrips || 0),
        format: 'number',
        provenance: metricProv('trucks_in_transit'),
      },
      {
        label: 'Hoàn thành',
        value: Number(stats.completedTrips || 0),
        format: 'number',
        provenance: { category: 'observed' },
      },
      {
        label: 'Đã chốt',
        value: Number(stats.lockedTrips || 0),
        format: 'number',
        provenance: { category: 'observed' },
      },
    ],
  };
}

/** Build an anomaly_list widget from the role-filtered decision items. */
function buildAnomalyWidget(items: DashboardDecisionItem[]): AgentWidget | null {
  if (items.length === 0) return null;
  return {
    type: 'anomaly_list',
    items: items.map((item) => ({
      label: item.title,
      detail: item.subtitle,
      severity: SEVERITY_MAP[item.severity] ?? 'low',
    })),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface SummaryResult {
  response: AgentResponse;
  lookupMs: number;
}

/**
 * Run the summary lane: fetch dashboard stats (parallel-aggregated internally),
 * filter by role, format into an insight_card. ZERO LLM calls.
 *
 * @param role The user's role (ACCOUNTANT/MANAGER/ADMIN).
 */
export async function runSummary(role: string): Promise<SummaryResult> {
  const start = performance.now();
  const stats = await getDashboardStats();
  const roleItems = filterByRole(stats.decisionItems ?? [], role);

  const widgets: AgentWidget[] = [buildKpiWidget(stats)];
  const anomalyWidget = buildAnomalyWidget(roleItems);
  if (anomalyWidget) widgets.push(anomalyWidget);

  // Build a concise Vietnamese summary line based on the top decision items.
  const topItem = roleItems[0];
  const criticalCount = roleItems.filter((i) => i.severity === 'critical').length;
  const warningCount = roleItems.filter((i) => i.severity === 'warning').length;
  const summary = !topItem || topItem.kind === 'all-clear'
    ? 'Mọi thứ ổn định — không có việc cấp bách hôm nay.'
    : `${criticalCount} việc cấp bách, ${warningCount} cần theo dõi.`;

  const actions = buildActionChips(roleItems);

  const response: AgentResponse = {
    type: 'insight_card',
    title: 'Tóm tắt việc hôm nay',
    summary,
    widgets,
    ...(actions.length > 0 ? { actions } : {}),
  };

  return { response, lookupMs: performance.now() - start };
}
