// SIL-1095 (KB §1.4.3, K1.13) — the five-lane lot status summary, PURE.
//
// Split out of the detail reads so the unit tree can pin the law without a db
// import (2026-10-19 owner ruling), the same seam as lcl-effective-freight.
// Every lane derives its value from EXISTING facts — no new DB state. The
// five lanes are never merged into one summary state; the KB wording is the
// vocabulary (SHIPMENT_LOT_STATUS_LABELS).
//
//   (1) Ghi nhận chi phí   — cost grid: khoản chưa xác nhận / chưa có.
//   (2) Thiếu chứng từ     — Lớp 2 document-set facts + Lớp 1 e-POD + Lớp 3
//                            nhận phơi (the three layers never infer each
//                            other; the lane READS all three).
//   (3) Hoàn thành vận chuyển — trip statuses (trips COMPLETED).
//   (4) Đã thanh toán      — receivable obligations (đã trả đủ / còn nợ /
//                            quá hạn).
//   (5) Đã khóa kỳ         — the accounting period lock (period_locks
//                            DEBIT_NOTE via the settlement round's
//                            periodKey), NOT the lô cost lock.

import {
  SHIPMENT_DOCUMENT_SET_STATUS_LABELS,
  SHIPMENT_LOT_STATUS_LABELS,
  TRIP_POD_STATUS_LABELS,
  ShipmentDocumentSetStatus,
  ShipmentLotStatus,
  TripPodStatus,
  round2dp,
  type ShipmentLotStatusEntry,
  type ShipmentLotStatusSummary,
} from '@tingting/shared';

/** Live cost rows of the lot's grid (post `costRowIsLive`). */
export interface LotStatusCostFacts {
  total: number;
  /** Rows still `Chưa xác nhận` (confirmedAt null). */
  unconfirmed: number;
  /** Rows settled into a phiếu quyết toán (reconciliationId set). */
  vouchered: number;
}

export interface LotStatusDocumentFacts {
  documentSet: { status: ShipmentDocumentSetStatus; missingDocuments: string[] };
  /** e-POD (Lớp 1) per REQUIRED, non-canceled review item; null = not started. */
  podStatuses: Array<TripPodStatus | null>;
  /** Nhận phơi (Lớp 3) per trip. The free-text take status is ride-along
   *  detail only — the state is binary on phoiTakenDate (phoiStateOf law). */
  phoiRows: Array<{ phoiTakenDate: string | null }>;
}

export interface LotStatusTransportFacts {
  /** Live trips: deleted_at null, status != CANCELED. */
  liveTrips: number;
  completedTrips: number;
}

export interface LotStatusPaymentFacts {
  /** Receivable obligations whose sourceTripIds cover this lot's trips. */
  obligations: Array<{ outstanding: number; effectiveDueDate: string | null }>;
  /** Vietnam business date (YYYY-MM-DD) the overdue check compares against. */
  asOfDate: string;
}

export interface LotStatusPeriodFacts {
  /** The settlement round's periodKey (debit_settlement_round_lots → round). */
  roundPeriodKey: string | null;
  /** period_locks row for (DEBIT_NOTE, CUSTOMER, periodKey); null = no row. */
  roundLockStatus: 'CLOSED' | 'REOPENED' | null;
  /** Periods the lot's Debit Note drew source lines from
   *  (billing_document_source_period_locks) — the legacy path for lots whose
   *  document predates the settlement-round flow. */
  sourceLocks: Array<{ periodKey: string; status: 'CLOSED' | 'REOPENED' }>;
}

export interface LotStatusFacts {
  cost: LotStatusCostFacts;
  documents: LotStatusDocumentFacts;
  transport: LotStatusTransportFacts;
  payment: LotStatusPaymentFacts;
  period: LotStatusPeriodFacts;
}

function entry(
  status: ShipmentLotStatus,
  state: string,
  detail: string | null,
  tone: ShipmentLotStatusEntry['tone'],
): ShipmentLotStatusEntry {
  return { status, label: SHIPMENT_LOT_STATUS_LABELS[status], state, detail, tone };
}

/** (1) — the cost grid's confirmation axis (costReviewProgressOf law). */
function buildCostLane(facts: LotStatusCostFacts): ShipmentLotStatusEntry {
  if (facts.total === 0) {
    return entry(ShipmentLotStatus.GHI_NHAN_CHI_PHI, 'Chưa có khoản chi', null, 'neutral');
  }
  if (facts.unconfirmed > 0) {
    return entry(
      ShipmentLotStatus.GHI_NHAN_CHI_PHI,
      'Chưa xác nhận',
      `${facts.unconfirmed}/${facts.total} khoản chi`,
      'warn',
    );
  }
  return entry(
    ShipmentLotStatus.GHI_NHAN_CHI_PHI,
    'Đã xác nhận',
    facts.vouchered > 0 ? `Đã lập ${facts.vouchered}/${facts.total} phiếu quyết toán` : null,
    'ok',
  );
}

/** (2) — READS Lớp 2 + Lớp 1 + Lớp 3; the layers never infer each other,
 *  so the detail names every layer's own fact whenever the lane is open. */
function buildDocumentsLane(facts: LotStatusDocumentFacts): ShipmentLotStatusEntry {
  const l2Label = SHIPMENT_DOCUMENT_SET_STATUS_LABELS[facts.documentSet.status];
  const podStatuses = facts.podStatuses.map((status) => status ?? TripPodStatus.DRAFT);
  const podComplete = podStatuses.every((status) => status === TripPodStatus.ACCEPTED);
  const phoiRows = facts.phoiRows;
  const phoiComplete = phoiRows.every((row) => row.phoiTakenDate != null);
  const allComplete = facts.documentSet.status === ShipmentDocumentSetStatus.COMPLETE
    && podComplete
    && phoiComplete;

  if (allComplete) {
    return entry(ShipmentLotStatus.THIEU_CHUNG_TU, 'Đã đủ', null, 'ok');
  }

  const parts: string[] = [];
  const names = facts.documentSet.missingDocuments.filter((name) => name.trim() !== '');
  if (names.length > 0) {
    parts.push(`Hồ sơ gốc: ${l2Label} — Thiếu: ${names.join(', ')}`);
  } else if (facts.documentSet.status === ShipmentDocumentSetStatus.MISSING) {
    parts.push(`Hồ sơ gốc: ${l2Label} — Chưa ghi nhận danh mục`);
  } else {
    parts.push(`Hồ sơ gốc: ${l2Label}`);
  }
  if (podStatuses.length > 0) {
    const byStatus = new Map<TripPodStatus, number>();
    for (const status of podStatuses) byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    const podLine = [...byStatus.entries()]
      .map(([status, count]) => (count > 1 ? `${count} ${TRIP_POD_STATUS_LABELS[status]}` : TRIP_POD_STATUS_LABELS[status]))
      .join(' · ');
    parts.push(`e-POD: ${podLine}`);
  }
  if (phoiRows.length > 0) {
    const missing = phoiRows.filter((row) => row.phoiTakenDate == null).length;
    parts.push(missing > 0 ? `Phơi: Chưa nhận phơi ${missing}/${phoiRows.length}` : 'Phơi: Đã nhận phơi');
  }

  const state = facts.documentSet.status === ShipmentDocumentSetStatus.COMPLETE
    ? 'Còn thiếu'
    : l2Label;
  return entry(ShipmentLotStatus.THIEU_CHUNG_TU, state, parts.join(' · '), 'warn');
}

/** (3) — trip completion, nothing else (tripStatus law). */
function buildTransportLane(facts: LotStatusTransportFacts): ShipmentLotStatusEntry {
  if (facts.liveTrips === 0) {
    return entry(ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN, 'Chưa có chuyến vận chuyển', null, 'neutral');
  }
  if (facts.completedTrips >= facts.liveTrips) {
    return entry(ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN, 'Hoàn thành', null, 'ok');
  }
  return entry(
    ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN,
    'Đang vận chuyển',
    `${facts.completedTrips}/${facts.liveTrips} chuyến hoàn thành`,
    'neutral',
  );
}

/** (4) — receivable obligations (đã trả đủ = outstanding 0). Overdue =
 *  past the effective due date (processingDueDate ?? originalDueDate). */
function buildPaymentLane(facts: LotStatusPaymentFacts): ShipmentLotStatusEntry {
  const obligations = facts.obligations;
  if (obligations.length === 0) {
    return entry(ShipmentLotStatus.DA_THANH_TOAN, 'Chưa phát sinh công nợ', null, 'neutral');
  }
  const outstanding = round2dp(obligations.reduce((sum, item) => sum + item.outstanding, 0));
  if (outstanding <= 0) {
    return entry(ShipmentLotStatus.DA_THANH_TOAN, 'Đã thanh toán', null, 'ok');
  }
  const overdue = obligations.some(
    (item) => item.outstanding > 0 && item.effectiveDueDate != null && item.effectiveDueDate < facts.asOfDate,
  );
  return entry(
    ShipmentLotStatus.DA_THANH_TOAN,
    overdue ? 'Nợ quá hạn' : 'Chưa thanh toán',
    `Còn nợ ${outstanding.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ₫`,
    overdue ? 'danger' : 'warn',
  );
}

/** (5) — the accounting PERIOD lock ('Đã khóa kỳ X' / 'Chưa vào kỳ nào'),
 *  never the lô cost lock. A reopened period is named as such. */
function buildPeriodLane(facts: LotStatusPeriodFacts): ShipmentLotStatusEntry {
  const roundKey = facts.roundPeriodKey;
  if (roundKey != null && facts.roundLockStatus === 'CLOSED') {
    return entry(ShipmentLotStatus.DA_KHOA_KY, `Đã khóa kỳ ${roundKey}`, null, 'ok');
  }
  const sourceClosed = facts.sourceLocks
    .filter((lock) => lock.status === 'CLOSED')
    .map((lock) => lock.periodKey)
    .sort();
  const sourceKey = sourceClosed[sourceClosed.length - 1] ?? null;
  if (sourceKey != null) {
    return entry(ShipmentLotStatus.DA_KHOA_KY, `Đã khóa kỳ ${sourceKey}`, null, 'ok');
  }
  if (roundKey != null && facts.roundLockStatus === 'REOPENED') {
    return entry(ShipmentLotStatus.DA_KHOA_KY, `Kỳ ${roundKey} đã mở lại`, null, 'warn');
  }
  if (roundKey != null) {
    return entry(ShipmentLotStatus.DA_KHOA_KY, `Đã vào kỳ ${roundKey} — chưa khóa`, null, 'neutral');
  }
  return entry(ShipmentLotStatus.DA_KHOA_KY, 'Chưa vào kỳ nào', null, 'neutral');
}

/** The five lanes in KB §1.4.3 order — five statuses, never merged. */
export function buildLotStatusSummary(facts: LotStatusFacts): ShipmentLotStatusSummary {
  return {
    entries: [
      buildCostLane(facts.cost),
      buildDocumentsLane(facts.documents),
      buildTransportLane(facts.transport),
      buildPaymentLane(facts.payment),
      buildPeriodLane(facts.period),
    ],
    // SIL-1096 — structured facts for the readiness popover.
    phoiFacts: {
      total: facts.documents.phoiRows.length,
      taken: facts.documents.phoiRows.filter((row) => row.phoiTakenDate != null).length,
    },
    costFacts: {
      total: facts.cost.total,
      unconfirmed: facts.cost.unconfirmed,
    },
  };
}
