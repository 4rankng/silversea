// Metric Registry — P4 Semantic Metric Layer.
//
// The SINGLE SOURCE OF TRUTH for business metric definitions. Each metric here
// declares its formula, unit, provenance category, and backing computation
// source. Agent tools (data.aggregate, report.run) and eventually the reporting
// service resolve metrics via `getMetric(id)` so "lợi nhuận" means the same
// thing everywhere.
//
// Scope (P4 v0): defines the top ~15 metrics the bot actually surfaces. Not
// exhaustive — expand incrementally. The registry is the ONLY place metric math
// is documented; computation still lives in the backing services for now (the
// full refactor to make services CALL the registry is deferred — it needs
// staging golden-value parity verification per the user's staging preference).

import type { MetricDef } from './metric-types';

// ─── Registry ───────────────────────────────────────────────────────────────

const REGISTRY: Record<string, MetricDef> = {
  // ── Trip financials (per-trip, persisted to trips table) ─────────────────
  revenue_ex_vat: {
    id: 'revenue_ex_vat',
    labelVi: 'Doanh thu (chưa VAT)',
    unit: 'vnd',
    category: 'calculated',
    formula: 'freightExVat = revenue / (1 + vatRate); recordedRevenue = freightExVat - customerCommission',
    source: { service: 'shared/calculations/tripTotals', method: 'computeTripTotals' },
    entityField: { entity: 'trips', field: 'revenue' },
    driftNote: 'trip-queries.service.ts:332 sums revenue incl-VAT (no VAT strip) — HIGH drift risk vs PnL.',
  },
  gross_profit: {
    id: 'gross_profit',
    labelVi: 'Lợi nhuận gộp',
    unit: 'vnd',
    category: 'calculated',
    formula: 'OWN: recordedRevenue - totalCost; EXTERNAL: freightExVat - externalFreightCost',
    source: { service: 'shared/calculations/tripTotals', method: 'computeTripTotals' },
    entityField: { entity: 'trips', field: 'grossProfit' },
  },
  total_cost: {
    id: 'total_cost',
    labelVi: 'Tổng chi phí',
    unit: 'vnd',
    category: 'calculated',
    formula: 'OWN: fuelCost + roadAllowance + tollCost + tollsDiscount + driverSalary + bonuses; EXTERNAL: externalFreightCost',
    source: { service: 'shared/calculations/tripTotals', method: 'computeTripTotals' },
    entityField: { entity: 'trips', field: 'totalCost' },
  },

  // ── Period financials (aggregated by PnL) ────────────────────────────────
  period_revenue: {
    id: 'period_revenue',
    labelVi: 'Doanh thu kỳ',
    unit: 'vnd',
    category: 'calculated',
    formula: 'Σ(trip.revenue / (1+vat)) for OWN trips in period',
    source: { service: 'pnl.service', method: 'getPnlReport' },
    driftNote: 'trip-queries getTripsSummary uses raw SUM(revenue) without VAT strip.',
  },
  period_gross_profit: {
    id: 'period_gross_profit',
    labelVi: 'Lợi nhuận gộp kỳ',
    unit: 'vnd',
    category: 'calculated',
    formula: 'Σ(trip.grossProfit) for OWN trips',
    source: { service: 'pnl.service', method: 'getPnlReport' },
  },
  adjusted_gross_profit: {
    id: 'adjusted_gross_profit',
    labelVi: 'Lợi nhuận gộp điều chỉnh',
    unit: 'vnd',
    category: 'calculated',
    formula: 'grossProfit - totalMaintenanceExpenses',
    source: { service: 'pnl.service', method: 'getPnlReport' },
  },

  // ── Fuel ─────────────────────────────────────────────────────────────────
  fuel_liters: {
    id: 'fuel_liters',
    labelVi: 'Nhiên liệu (lít)',
    unit: 'number',
    category: 'calculated',
    formula: 'AUTO: Σ(leg.km × norm / 100) + supplements; FLAT_RATE: override + supplement; MOUNTAIN: fixed + supplement',
    source: { service: 'shared/calculations/tripTotals', method: 'computeTripTotals' },
    entityField: { entity: 'trips', field: 'fuelLiters' },
  },
  fuel_cost: {
    id: 'fuel_cost',
    labelVi: 'Tiền nhiên liệu',
    unit: 'vnd',
    category: 'calculated',
    formula: 'fuelLiters × (fuelActualUnitPrice ?? fuelUnitPrice)',
    source: { service: 'shared/calculations/tripTotals', method: 'computeTripTotals' },
  },

  // ── Road allowance ───────────────────────────────────────────────────────
  road_allowance: {
    id: 'road_allowance',
    labelVi: 'Tiền đi đường',
    unit: 'vnd',
    category: 'calculated',
    formula: 'tollsAddition > 0 ? tollsAddition + returnCargoBonus : base - (stations × 55000) + returnCargoBonus; then - tollsDiscount',
    source: { service: 'shared/calculations/tripTotals', method: 'computeRoadAllowance' },
    entityField: { entity: 'trips', field: 'totalRoadAllowance' },
  },

  // ── Driver salary ────────────────────────────────────────────────────────
  driver_salary_per_trip: {
    id: 'driver_salary_per_trip',
    labelVi: 'Lương tài xế (mỗi chuyến)',
    unit: 'vnd',
    category: 'calculated',
    formula: 'round(baseSalary / 26 × tripWageDays)',
    source: { service: 'shared/calculations/tripDriverSalary', method: 'computeTripDriverSalary' },
    entityField: { entity: 'trips', field: 'driverSalary' },
    driftNote: 'Per-trip divisor = 26 (fixed). Monthly payroll uses calendar days minus Sundays — deliberately different.',
  },
  driver_net_salary_monthly: {
    id: 'driver_net_salary_monthly',
    labelVi: 'Lương thực nhận (tháng)',
    unit: 'vnd',
    category: 'calculated',
    formula: 'baseSalary + adjustment - totalPenalties',
    source: { service: 'attendance.service', method: 'computeSalary' },
    driftNote: 'adjustment = (paidDays - standardWorkDays) × dailyRate. StandardWorkDays varies by month.',
  },

  // ── Receivables / Payables (observed from ledger) ────────────────────────
  receivables_outstanding: {
    id: 'receivables_outstanding',
    labelVi: 'Công nợ phải thu',
    unit: 'vnd',
    category: 'observed',
    formula: 'Σ(customer.totalOutstanding) via FIFO ledger aging',
    source: { service: 'aging.service', method: 'getReceivablesSummary' },
  },
  payables_outstanding: {
    id: 'payables_outstanding',
    labelVi: 'Công nợ phải trả',
    unit: 'vnd',
    category: 'observed',
    formula: 'Σ(vendor.totalOutstanding) via FIFO ledger aging',
    source: { service: 'aging.service', method: 'getPayablesSummary' },
  },

  // ── Operational (observed counts) ────────────────────────────────────────
  trip_count: {
    id: 'trip_count',
    labelVi: 'Số chuyến',
    unit: 'number',
    category: 'observed',
    formula: 'COUNT(*) WHERE status != CANCELED',
    source: { service: 'dashboard-stats.service', method: 'getDashboardStats' },
    entityField: { entity: 'trips', field: 'count' },
  },
  trucks_in_transit: {
    id: 'trucks_in_transit',
    labelVi: 'Xe đang chạy',
    unit: 'number',
    category: 'observed',
    formula: 'COUNT(trips WHERE status = IN_TRANSIT)',
    source: { service: 'dashboard-stats.service', method: 'getDashboardStats' },
  },
};

// ─── Public API ─────────────────────────────────────────────────────────────

/** Look up a metric definition by id. Returns undefined for unknown metrics. */
export function getMetric(id: string): MetricDef | undefined {
  return REGISTRY[id];
}

/** Get all registered metric definitions (for introspection / tooling). */
export function getAllMetrics(): MetricDef[] {
  return Object.values(REGISTRY);
}

/** All registered metric ids (for validation / autocomplete). */
export function getMetricIds(): string[] {
  return Object.keys(REGISTRY);
}

/** Resolve an entity-field pair to its metric definition (if registered).
 *  Used by data.aggregate to attach provenance. */
export function getMetricByEntityField(entity: string, field: string): MetricDef | undefined {
  return Object.values(REGISTRY).find(
    (m) => m.entityField?.entity === entity && m.entityField?.field === field,
  );
}
