// Card 20260928_169 — "Báo cáo tổng hợp hoàn ứng" per staff and per đợt.
// The response mirrors the backend OpsReconciliationReport contract
// (backend/src/services/ops-reconciliation-report.service.ts); that contract
// lives backend-side, so this module owns the frontend shape and the
// query-string assembly — the same pattern expenseAccountingClient uses.
import { api } from '../lib/api';

export type OpsReconciliationDirection = 'CTY_THANH_TOAN_HOAN_UNG' | 'CTY_YEU_CAU_HOAN_TRA' | 'KHONG_CON_GI';

export interface OpsReconciliationReportRow {
  staffId: number;
  staffName: string;
  /** ĐNTT — confirmed ops costs in the period (đợt-owned when scoped). */
  dntt: number;
  /** ĐÃ ỨNG — held advances; scoped to a đợt, what that lot allocated. */
  advanced: number;
  /** Còn phải hoàn ứng = ĐNTT − ĐÃ ỨNG. + company pays back, − staff pays back. */
  remaining: number;
  direction: OpsReconciliationDirection;
  note: string;
}

export interface OpsReconciliationReport {
  from: string;
  to: string;
  /** Set when the caller scoped the report to one đợt (reconciliation lot). */
  reconciliation?: { id: number; code: string; from: string; to: string };
  rows: OpsReconciliationReportRow[];
  totals: { dntt: number; advanced: number; remaining: number };
}

export interface OpsReconciliationReportQuery {
  from?: string;
  to?: string;
  reconciliationId?: number;
  opsUserId?: number;
}

export const opsReconciliationReportKeys = {
  all: ['ops-reconciliation-report'] as const,
  list: (params: OpsReconciliationReportQuery) => [
    'ops-reconciliation-report',
    params.from ?? '',
    params.to ?? '',
    params.reconciliationId ?? 0,
    params.opsUserId ?? 0,
  ] as const,
};

function query(values: OpsReconciliationReportQuery) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  return params.toString();
}

export const opsReconciliationReportClient = {
  report: (params: OpsReconciliationReportQuery) =>
    api.get<OpsReconciliationReport>(`/expense-accounting/reconciliation-report?${query(params)}`),
};
