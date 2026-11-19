// Card 20260928_169 — "Báo cáo tổng hợp hoàn ứng" per staff and per đợt.
// The response mirrors the backend OpsReconciliationReport contract
// (backend/src/services/ops-reconciliation-report.service.ts); that contract
// lives backend-side, so this module owns the frontend shape and the
// query-string assembly — the same pattern expenseAccountingClient uses.
import { api } from '../lib/api';

export type OpsReconciliationDirection = 'CTY_THANH_TOAN_HOAN_UNG' | 'CTY_YEU_CAU_HOAN_TRA' | 'CTY_YEU_CAU_THU_TIEN_UNG' | 'KHONG_CON_GI';

export interface OpsReconciliationReportRow {
  staffId: number;
  staffName: string;
  /** ĐNTT — confirmed ops costs in the period (đợt-owned when scoped). */
  dntt: number;
  /** ĐÃ ỨNG — held advances; scoped to a đợt, what that lot allocated. */
  advanced: number;
  /** SIL-806 — ĐÃ ỨNG (đã ghi nhận): tổng phiếu tạm ứng đã giải ngân trong
   *  kỳ, không net. SIL-839 — the Báo cáo hoàn ứng column + rail read THIS
   *  number too, so both screens share one query (khớp 100% với Quỹ cá nhân
   *  tại /accounting/hoan-ung). */
  advancedRecorded: number;
  /** Còn phải hoàn ứng = sổ quỹ closing number (lệnh PM 2026-09-29), ≥ 0. */
  remaining: number;
  /** BỔ SUNG CTO 19/11 — Còn phải hoàn ứng CÓ DẤU: (+) cá nhân hoàn lại,
   *  (−) công ty trả thêm. Unscoped = số dư ĐÃ ỨNG − ĐÃ DUYỆT − ĐÃ TẤT TOÁN
   *  (đúng `outstandingSigned` — khớp 100% ví/sổ quỹ); scoped đợt = ĐÃ ỨNG
   *  phân bổ − ĐNTT đợt. Supersedes spec chữ cũ "ĐNTT − ĐÃ ỨNG". */
  remainingSigned: number;
  /** Số dư tạm ứng CÓ DẤU (card 141026230770): min(đã cấp, đã giải ngân) − đã
   *  tiêu − đã trả, không kẹp về 0. Âm = nhân viên đã tiêu/trả vượt số được cấp. */
  outstandingSigned: number;
  /** Âm và nhân viên còn nắm tiền đã cấp — đề nghị thu tiền ứng. */
  needsCollection: boolean;
  direction: OpsReconciliationDirection;
  note: string;
}

export interface OpsReconciliationReport {
  from: string;
  to: string;
  /** Set when the caller scoped the report to one đợt (reconciliation lot). */
  reconciliation?: { id: number; code: string; from: string; to: string };
  rows: OpsReconciliationReportRow[];
  totals: { dntt: number; advanced: number; advancedRecorded: number; remaining: number; remainingSigned: number };
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
