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
  /** SỔ QUỸ (held money, ≥ 0) — the number the Sổ quỹ 'Tạm ứng OPS còn tồn'
   *  and /advance-balances read; nets the settled-through-phiếu amount. */
  remaining: number;
  /** 'Còn phải hoàn ứng' — the SIGNED settlement balance (tổng đã ứng − tổng
   *  ĐNTT đã xác nhận − tổng đã nộp lại − tổng đã tất toán qua phiếu): (+) cá
   *  nhân hoàn lại, (−) công ty trả thêm. ONE number for every surface that
   *  opens it — cột 'Còn phải hoàn ứng' của Báo cáo hoàn ứng, cột 'Số dư quỹ'
   *  của bảng Quỹ cá nhân, cửa sổ lập phiếu hoàn ứng, /advance-balances
   *  (?includeAll=true). Scoped đợt = ĐÃ ỨNG phân bổ − ĐNTT đợt. */
  remainingSigned: number;
  /** Số dư tạm ứng CÓ DẤU (card 141026230770) — the BOOKKEEPING authority:
   *  min(đã cấp, đã giải ngân) − đã tiêu − đã trả, không kẹp về 0. Khác
   *  `remainingSigned`; dùng cho nút thu hồi, không dùng cho cột hiển thị. */
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
  // Lives under `all` so the post-mutation invalidate covers the open dialogs.
  drillDown: (opsUserId: number, reconciliationId?: number) => [
    'ops-reconciliation-report', 'drill-down', opsUserId, reconciliationId ?? 0,
  ] as const,
};

// SIL-1056 QA bounce #3 (KB K2.117) — the drill-down of ONE staff's
// 'Còn phải hoàn ứng' cell: the transaction list that composes the number,
// plus the same-law footer total so the dialog can assert it khớps the cell.
export interface OpsReconciliationDrillItem {
  id: number;
  code: string | null;
  label: string;
  date: string | null;
  amount: number;
}

export interface OpsReconciliationDrillGroup {
  label: string;
  items: OpsReconciliationDrillItem[];
  total: number;
}

export interface OpsReconciliationDrillDown {
  staffId: number;
  staffName: string;
  reconciliation?: { id: number; code: string; from: string; to: string };
  law: 'CANONICAL' | 'LOT_ALLOCATION';
  groups: {
    recorded: OpsReconciliationDrillGroup;
    dntt: OpsReconciliationDrillGroup;
    returned: OpsReconciliationDrillGroup;
    settled: OpsReconciliationDrillGroup;
  };
  signedBalance: number;
}

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
  drillDown: (params: { opsUserId: number; reconciliationId?: number }) => {
    const drill = new URLSearchParams();
    drill.set('opsUserId', String(params.opsUserId));
    if (params.reconciliationId !== undefined) drill.set('reconciliationId', String(params.reconciliationId));
    return api.get<OpsReconciliationDrillDown>(`/expense-accounting/reconciliation-report/drill-down?${drill.toString()}`);
  },
};
