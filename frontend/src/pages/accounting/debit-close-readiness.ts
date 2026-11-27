// SIL-1096 (KB §3.1.3, K3.5 / K2.69) — the four debit-note readiness
// conditions (hàng hóa · giá · chứng từ · điều kiện kỳ) derived PURELY from
// data that already exists: the board row (containers, routeName, money
// nulls, formula hint) + the lot's detail wire (documentSet Lớp 2, e-POD
// Lớp 1, nhận phơi Lớp 3, freightRate.latest trace ids, costFacts). No
// business rule is re-derived here that the backend does not already own —
// a missing condition names EVERY missing part (KB: "nêu đủ từng lý do") +
// HOW to complete it; a satisfied condition still renders its tick (Đủ) so
// nothing answers with silence.
//
// SIL-1096 (same ticket, KB "nêu đủ từng lý do" only over KNOWN facts) —
// "chưa có dữ liệu" ≠ "thiếu điều kiện": while the lot's detail wire is
// still loading (or failed), a detail-derived condition may NOT claim a
// missing reason — it says the verdict is not known yet, the same law
// SIL-1095's lot-status block keeps (a lane the wire does not carry yet
// reads '—' instead of vanishing). The board row's own reasons (chưa có
// tuyến, chưa chốt tiền) are definite — they do not depend on the wire, so
// they still answer while it is in flight.

import {
  DEBIT_CLOSE_CONDITION_LABELS,
  DebitCloseCondition,
} from '@tingting/shared';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import type { ShipmentDetail } from '../../api/shipmentClient';

const THU_COST_FIELDS = ['cuocThu', 'lachHuyen', 'phuPs', 'phatSinhCus', 'tongThu'] as const;
const TRA_COST_FIELDS = ['cuocTraDv', 'lachHuyenDv', 'phatSinhDv', 'phiRu', 'tong1'] as const;

/** True when the row still has ≥1 missing money field ("Thiếu chi phí") —
 *  the same field list the Lô column's dot predicate (KT8) reads. Lives here
 *  so the readiness derivation and the column share ONE predicate without a
 *  React import cycle. */
export function hasMissingCost(row: AccountingDebitBoardRow): boolean {
  return THU_COST_FIELDS.some((field) => row.thu[field] == null)
    || TRA_COST_FIELDS.some((field) => row.tra[field] == null);
}

/** The lot's detail wire as this derivation sees it — THREE states, because
 *  "chưa có dữ liệu" and "không tải được dữ liệu" are different facts and
 *  the panel must not paint them the same (SIL-1096). */
export type DebitReadinessDetailState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; detail: ShipmentDetail };

export interface DebitReadinessItem {
  key: DebitCloseCondition;
  label: string;
  ok: boolean;
  /** WHY the condition is not met — names every missing part. */
  reason: string | null;
  /** HOW to complete it (where / who). */
  howTo: string | null;
  /** The verdict is NOT known yet — the lot's detail wire is still loading
   *  (or failed). Neither 'Đủ' nor a missing reason may be claimed; the
   *  panel renders the line neutral, never a false red failure (SIL-1096). */
  loading?: boolean;
}

const THU_COST_LABELS: Record<string, string> = {
  cuocThu: 'cước thu',
  lachHuyen: 'lệch tuyến',
  phuPs: 'phụ phát sinh',
  phatSinhCus: 'phát sinh khách',
  tongThu: 'tổng thu',
};
const TRA_COST_LABELS: Record<string, string> = {
  cuocTraDv: 'cước trả DV',
  lachHuyenDv: 'lệch tuyến DV',
  phatSinhDv: 'phát sinh DV',
  phiRu: 'phí RU',
  tong1: 'tổng 1',
};

function missingMoneyNames(row: AccountingDebitBoardRow): string[] {
  const missing: string[] = [];
  for (const [field, label] of Object.entries(THU_COST_LABELS)) {
    if (row.thu[field as keyof typeof row.thu] == null) missing.push(label);
  }
  for (const [field, label] of Object.entries(TRA_COST_LABELS)) {
    if (row.tra[field as keyof typeof row.tra] == null) missing.push(label);
  }
  return missing;
}

function assembleItem(
  key: DebitCloseCondition,
  reasons: string[],
  howTos: string[],
): DebitReadinessItem {
  if (reasons.length === 0) {
    return { key, label: DEBIT_CLOSE_CONDITION_LABELS[key], ok: true, reason: null, howTo: null };
  }
  return {
    key,
    label: DEBIT_CLOSE_CONDITION_LABELS[key],
    ok: false,
    reason: reasons.join('; '),
    howTo: howTos.join('; '),
  };
}

/** A condition whose verdict the detail wire has NOT delivered — the reason
 *  says WHY (đang tải / không tải được), never a fabricated gap.
 *  `loading` marks the verdict as still unknown: the panel renders the line
 *  neutral instead of a false red failure (SIL-1096). */
function pendingItem(
  key: DebitCloseCondition,
  reason: string,
  howTo: string | null,
  loading: boolean,
): DebitReadinessItem {
  return {
    key,
    label: DEBIT_CLOSE_CONDITION_LABELS[key],
    ok: false,
    reason,
    howTo,
    loading,
  };
}

/** (1) Hàng hóa — the goods declaration: FCL containers, or the LCL lot's
 *  own params (`row.lcl.label` — an LCL row carries NO container rows). */
function buildHangHoaItem(row: AccountingDebitBoardRow): DebitReadinessItem {
  if (row.containers.length > 0 || row.lcl != null) {
    return assembleItem(DebitCloseCondition.HANG_HOA, [], []);
  }
  return assembleItem(
    DebitCloseCondition.HANG_HOA,
    ['Chưa khai báo container / hàng hóa'],
    ['thêm container trên chi tiết lô (FCL) hoặc nhập thông số hàng lẻ (LCL)'],
  );
}

/** (2) Giá — route, pricing terms (trace ids), chốt money, phí chưa duyệt. */
function buildGiaItem(
  row: AccountingDebitBoardRow,
  state: DebitReadinessDetailState,
): DebitReadinessItem {
  const reasons: string[] = [];
  const howTos: string[] = [];
  if (row.routeName == null || row.routeName.trim() === '') {
    reasons.push('Chưa có tuyến');
    howTos.push('chọn tuyến trên chi tiết lô');
  }
  if (state.status === 'ready') {
    const latest = state.detail.freightRate?.latest ?? null;
    if (latest == null || latest.rateTermsId === 0 || latest.pricingTableId === 0) {
      reasons.push('Thiếu điều khoản cước / bảng giá');
      howTos.push('nhập tay giá tại ô cước hoặc cấu hình danh mục giá');
    }
  }
  if (hasMissingCost(row)) {
    reasons.push(`Chưa chốt: ${missingMoneyNames(row).join(', ')}`);
    howTos.push('nhập các khoản còn trống trên dòng');
  }
  if (state.status === 'ready') {
    const costFacts = state.detail.statusSummary?.costFacts;
    if (costFacts != null && costFacts.unconfirmed > 0) {
      // SIL-883/1072 — fees saved but still missing the Kế toán confirm stamp.
      reasons.push(`Còn ${costFacts.unconfirmed} khoản phí chưa được Kế toán duyệt`);
      howTos.push('Kế toán duyệt chi phí (Tab Chi phí Ops)');
    }
    return assembleItem(DebitCloseCondition.GIA, reasons, howTos);
  }
  // The price facts (điều khoản cước / bảng giá, phí chưa duyệt) live on the
  // detail wire: while it is not ready they are UNKNOWN, never "missing" —
  // "Thiếu điều khoản cước" read off an empty wire is a false reason
  // (SIL-1096: "chưa có dữ liệu" ≠ "thiếu điều kiện"). The board row's own
  // reasons (chưa có tuyến, chưa chốt tiền) do not depend on the wire, so
  // they still answer.
  if (state.status === 'error') {
    const note = 'Không tải được dữ liệu giá của lô — thử lại sau.';
    return reasons.length === 0
      ? pendingItem(DebitCloseCondition.GIA, note, null, false)
      : pendingItem(DebitCloseCondition.GIA, [...reasons, note].join('; '), howTos.join('; '), false);
  }
  return reasons.length === 0
    ? pendingItem(DebitCloseCondition.GIA, 'Đang tải dữ liệu giá của lô…', null, true)
    : pendingItem(DebitCloseCondition.GIA, reasons.join('; '), howTos.join('; '), true);
}

/** (3) Chứng từ — Lớp 2 (document-set facts) + Lớp 1 (e-POD) + Lớp 3
 *  (nhận phơi). The three layers never infer each other: every open layer
 *  names its own fact. */
function buildChungTuItem(state: DebitReadinessDetailState): DebitReadinessItem {
  if (state.status !== 'ready') {
    // The document layers (Lớp 1/2/3) live on the detail wire: until it
    // answers, "hồ sơ gốc còn thiếu" is a claim without evidence (SIL-1096).
    return state.status === 'error'
      ? pendingItem(
        DebitCloseCondition.CHUNG_TU,
        'Không tải được dữ liệu chứng từ của lô — thử lại sau.',
        null,
        false,
      )
      : pendingItem(
        DebitCloseCondition.CHUNG_TU,
        'Đang tải dữ liệu chứng từ của lô…',
        null,
        true,
      );
  }
  const detail = state.detail;
  const reasons: string[] = [];
  const howTos: string[] = [];
  const documentSet = detail.documentSet;
  if (documentSet.status !== 'COMPLETE') {
    const names = documentSet.missingDocuments.filter((name) => name.trim() !== '');
    reasons.push(names.length > 0
      ? `Hồ sơ gốc còn thiếu: ${names.join(', ')}`
      : 'Hồ sơ gốc còn thiếu — Chưa ghi nhận danh mục');
    howTos.push('bổ sung tại hồ sơ gốc lô (màn Nợ chứng từ)');
  }
  const podPending = detail.podReviews.filter(
    (item) => item.required && item.canceledAt == null && item.currentSubmission?.status !== 'ACCEPTED',
  );
  if (podPending.length > 0) {
    reasons.push(`e-POD chưa xác nhận: ${podPending.length} chuyến`);
    howTos.push('chờ khách xác nhận e-POD trên chuyến');
  }
  const phoiFacts = detail.statusSummary?.phoiFacts;
  if (phoiFacts != null && phoiFacts.taken < phoiFacts.total) {
    reasons.push(`Chưa nhận phơi: ${phoiFacts.total - phoiFacts.taken}/${phoiFacts.total} chuyến`);
    howTos.push('nhận phơi và ghi ngày lấy phơi (bảng Kiểm soát phơi phiếu)');
  }
  return assembleItem(DebitCloseCondition.CHUNG_TU, reasons, howTos);
}

/** (4) Điều kiện kỳ — the fuel price period + fuel norm the engine priced
 *  against (the formula hint's own named gaps), and who settles each. */
function buildDieuKienKyItem(state: DebitReadinessDetailState): DebitReadinessItem {
  if (state.status !== 'ready') {
    // The fuel period + fuel norm live on the detail wire: until it answers,
    // "không tìm thấy kỳ giá dầu hiệu lực" is a claim without evidence
    // (SIL-1096) — the condition is UNKNOWN, not missing.
    return state.status === 'error'
      ? pendingItem(
        DebitCloseCondition.DIEU_KIEN_KY,
        'Không tải được dữ liệu điều kiện kỳ của lô — thử lại sau.',
        null,
        false,
      )
      : pendingItem(
        DebitCloseCondition.DIEU_KIEN_KY,
        'Đang tải dữ liệu điều kiện kỳ của lô…',
        null,
        true,
      );
  }
  const latest = state.detail.freightRate?.latest ?? null;
  const reasons: string[] = [];
  const howTos: string[] = [];
  if (latest == null || latest.fuelPricePeriodId === 0) {
    reasons.push('Không tìm thấy kỳ giá dầu hiệu lực (kiểm tra số ngày trễ giá)');
    howTos.push('Kế toán/Admin kiểm tra số ngày trễ giá (fuelLagDays) và phê duyệt kỳ giá dầu hiệu lực');
    howTos.push('khách chốt độ trễ giá dầu / ngưỡng biến động, cập nhật tại Danh mục điều khoản cước');
  }
  if (latest != null && latest.fuelNormId === 0) {
    reasons.push('Thiếu định mức tiêu hao dầu cho loại xe — cần nhập tay');
    howTos.push('cập nhật định mức tiêu hao dầu cho loại xe tại danh mục định mức');
  }
  return assembleItem(DebitCloseCondition.DIEU_KIEN_KY, reasons, howTos);
}

/** The four conditions in KB order — hàng hóa · giá · chứng từ · điều kiện kỳ. */
export function deriveDebitCloseReadiness(
  row: AccountingDebitBoardRow,
  state: DebitReadinessDetailState,
): DebitReadinessItem[] {
  return [
    buildHangHoaItem(row),
    buildGiaItem(row, state),
    buildChungTuItem(state),
    buildDieuKienKyItem(state),
  ];
}
