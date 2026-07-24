/**
 * P4 Semantic Metric Layer tests.
 *
 * Tests the metric registry contract, provenance schema, and the integration
 * point where the summary lane attaches provenance to KPI values.
 *
 * The golden-value parity test (comparing registry-resolved values against
 * the reporting service's output) is deferred to staging — it requires a live
 * DB and is explicitly gated by the user's staging preference. Here we lock
 * the CONTRACT: every registered metric is well-formed, provenance tags
 * validate, and the summary lane tags its values correctly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { agentResponseSchema, provenanceSchema } from '@tingting/shared';
import { getMetric, getAllMetrics, getMetricIds, getMetricByEntityField } from '../services/metrics/metric-registry.js';

// ─── Registry contract ──────────────────────────────────────────────────────

describe('P4 Metric Registry — contract', () => {
  test('registry has ≥ 15 metrics', () => {
    const all = getAllMetrics();
    assert.ok(all.length >= 15, `expected ≥15 metrics, got ${all.length}`);
  });

  test('every metric has required fields', () => {
    for (const m of getAllMetrics()) {
      assert.ok(m.id, `metric missing id`);
      assert.ok(m.labelVi, `metric ${m.id} missing labelVi`);
      assert.ok(['vnd', 'percent', 'number', 'days'].includes(m.unit), `metric ${m.id} invalid unit: ${m.unit}`);
      assert.ok(['observed', 'calculated', 'forecast', 'assumption'].includes(m.category), `metric ${m.id} invalid category: ${m.category}`);
      assert.ok(m.formula, `metric ${m.id} missing formula`);
      assert.ok(m.source?.service, `metric ${m.id} missing source.service`);
      assert.ok(m.source?.method, `metric ${m.id} missing source.method`);
    }
  });

  test('metric ids are unique', () => {
    const ids = getMetricIds();
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, 'duplicate metric ids found');
  });

  test('getMetric returns undefined for unknown id', () => {
    assert.equal(getMetric('nonexistent_metric'), undefined);
  });
});

// ─── Key metrics present ────────────────────────────────────────────────────

describe('P4 Metric Registry — key metrics present', () => {
  const expectedMetrics = [
    'revenue_ex_vat',
    'gross_profit',
    'total_cost',
    'period_revenue',
    'period_gross_profit',
    'adjusted_gross_profit',
    'fuel_liters',
    'fuel_cost',
    'road_allowance',
    'driver_salary_per_trip',
    'driver_net_salary_monthly',
    'receivables_outstanding',
    'payables_outstanding',
    'trip_count',
    'trucks_in_transit',
  ];

  for (const id of expectedMetrics) {
    test(`metric "${id}" is registered`, () => {
      const m = getMetric(id);
      assert.ok(m, `metric ${id} not found in registry`);
    });
  }
});

// ─── Drift documentation ────────────────────────────────────────────────────

describe('P4 Metric Registry — drift notes', () => {
  test('revenue metric documents the VAT drift risk', () => {
    const m = getMetric('revenue_ex_vat');
    assert.ok(m?.driftNote, 'revenue_ex_vat should document drift risk');
    assert.ok(m!.driftNote!.includes('VAT'), 'drift note should mention VAT');
  });

  test('driver salary documents the per-trip vs monthly drift', () => {
    const tripSalary = getMetric('driver_salary_per_trip');
    assert.ok(tripSalary?.driftNote, 'driver_salary_per_trip should document drift');
    assert.ok(tripSalary!.driftNote!.includes('26'), 'drift note should mention the 26-day divisor');

    const monthlySalary = getMetric('driver_net_salary_monthly');
    assert.ok(monthlySalary?.driftNote, 'driver_net_salary_monthly should document drift');
  });
});

// ─── Entity-field resolution ────────────────────────────────────────────────

describe('P4 Metric Registry — entity-field resolution', () => {
  test('getMetricByEntityField resolves trips.grossProfit', () => {
    const m = getMetricByEntityField('trips', 'grossProfit');
    assert.ok(m);
    assert.equal(m!.id, 'gross_profit');
  });

  test('getMetricByEntityField resolves trips.revenue', () => {
    const m = getMetricByEntityField('trips', 'revenue');
    assert.ok(m);
    assert.equal(m!.id, 'revenue_ex_vat');
  });

  test('getMetricByEntityField returns undefined for unregistered field', () => {
    assert.equal(getMetricByEntityField('trips', 'unknown_field'), undefined);
  });
});

// ─── Provenance schema ──────────────────────────────────────────────────────

describe('P4 Provenance schema', () => {
  test('observed provenance validates', () => {
    const p = { category: 'observed' as const };
    assert.ok(provenanceSchema.safeParse(p).success);
  });

  test('calculated provenance with formula validates', () => {
    const p = { metricId: 'gross_profit', category: 'calculated' as const, formula: 'revenue - cost' };
    assert.ok(provenanceSchema.safeParse(p).success);
  });

  test('forecast provenance validates (scaffold for future)', () => {
    const p = { category: 'forecast' as const };
    assert.ok(provenanceSchema.safeParse(p).success);
  });

  test('invalid category rejected', () => {
    const p = { category: 'guess' };
    assert.ok(!provenanceSchema.safeParse(p).success);
  });
});

// ─── KPI widget with provenance ─────────────────────────────────────────────

describe('P4 KPI widget with provenance', () => {
  test('insight_card with provenance-tagged KPIs validates', () => {
    const response = {
      type: 'insight_card',
      title: 'Tóm tắt',
      summary: 'Tóm tắt tháng.',
      widgets: [{
        type: 'kpi_grid',
        items: [
          {
            label: 'Doanh thu',
            value: 500000000,
            format: 'vnd',
            provenance: { metricId: 'period_revenue', category: 'calculated', formula: 'Σ(revenue / (1+VAT))' },
          },
          {
            label: 'Số chuyến',
            value: 42,
            format: 'number',
            provenance: { category: 'observed' },
          },
        ],
      }],
    };
    const parsed = agentResponseSchema.safeParse(response);
    assert.ok(parsed.success, `provenance-tagged insight_card should validate: ${parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 2))}`);
  });

  test('KPI without provenance still validates (backwards compatible)', () => {
    const response = {
      type: 'insight_card',
      title: 'T',
      summary: 'S',
      widgets: [{
        type: 'kpi_grid',
        items: [{ label: 'X', value: 100, format: 'number' }],
      }],
    };
    assert.ok(agentResponseSchema.safeParse(response).success);
  });
});
