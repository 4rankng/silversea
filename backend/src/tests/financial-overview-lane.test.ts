import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { agentResponseSchema } from '@tingting/shared';
import { buildFinancialOverviewResponse } from '../services/agent/financial-overview-lane.js';

const base = {
  period: { month: 7, year: 2026 },
  revenue: 500_000_000,
  totalCosts: 420_000_000,
  grossProfit: 80_000_000,
  netProfit: 60_000_000,
  tripCount: 24,
  receivables: 140_000_000,
  overdueReceivables: 30_000_000,
  overdueCustomers: 2,
  payables: 50_000_000,
  overdueSuppliers: 1,
};

describe('financial overview card', () => {
  test('builds a schema-valid profitable card with canonical navigation', () => {
    const response = buildFinancialOverviewResponse(base);
    assert.equal(agentResponseSchema.safeParse(response).success, true);
    assert.equal(response.type, 'insight_card');
    if (response.type !== 'insight_card') return;
    assert.match(response.summary, /có lãi/i);
    assert.deepEqual(response.actions?.map((action) =>
      action.directive.kind === 'navigate' ? action.directive.routeKey : ''),
    ['finance', 'debt', 'payables']);
  });

  test('reports a loss without reversing the sign', () => {
    const response = buildFinancialOverviewResponse({ ...base, netProfit: -25_000_000 });
    assert.equal(response.type, 'insight_card');
    if (response.type !== 'insight_card') return;
    assert.match(response.summary, /đang lỗ 25\.000\.000 ₫/i);
    const anomalies = response.widgets.find((widget) => widget.type === 'anomaly_list');
    assert.ok(anomalies && anomalies.type === 'anomaly_list');
    assert.equal(anomalies.items[0]?.severity, 'high');
  });

  test('handles zero revenue without producing an invalid percentage', () => {
    const response = buildFinancialOverviewResponse({ ...base, revenue: 0, netProfit: 0 });
    assert.equal(agentResponseSchema.safeParse(response).success, true);
    assert.equal(response.type, 'insight_card');
    if (response.type !== 'insight_card') return;
    const kpis = response.widgets.find((widget) => widget.type === 'kpi_grid');
    assert.ok(kpis && kpis.type === 'kpi_grid');
    assert.equal(kpis.items.find((item) => item.label === 'Biên lợi nhuận ròng')?.value, 0);
  });

  test('annotates the title as month-to-date when asOfDay is set', () => {
    const response = buildFinancialOverviewResponse({ ...base, asOfDay: 14 });
    if (response.type !== 'insight_card') { assert.fail('expected insight_card'); return; }
    // A mid-month P&L must not read as a full-month result.
    assert.match(response.title, /tính đến 14\/7/);
  });

  test('omits the month-to-date suffix when asOfDay is absent (backward-compat)', () => {
    const response = buildFinancialOverviewResponse(base);
    if (response.type !== 'insight_card') { assert.fail('expected insight_card'); return; }
    assert.doesNotMatch(response.title, /tính đến/);
    assert.match(response.title, /tháng 7\/2026/);
  });

  test('ignores an out-of-range asOfDay (defensive)', () => {
    const response = buildFinancialOverviewResponse({ ...base, asOfDay: 0 });
    if (response.type !== 'insight_card') { assert.fail('expected insight_card'); return; }
    assert.doesNotMatch(response.title, /tính đến/);
  });
});
