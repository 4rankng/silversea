// Card 20260923_12 — shared nhà xe identity derivation for the chot-debit
// board and the Chọn Debit settlement service. Its own module so the board
// assembly and the settlement guards share ONE derivation with no
// service→service import cycle.
import { vatForAmount } from '@tingting/shared';
import { ApiError } from '../errors';

export interface CarrierDerivationEntry {
  plate: string | null;      // own-fleet plate (truck without a carrier owner)
  carrierId: number | null;  // trucks.carrier_id (subcontracted tractor)
  externalId: number | null; // external entity id when type is CUSTOMER
  externalPlate: string | null;
}

export function normalizeCarrierPlate(plate: string): string {
  return plate.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** One canonical key per nhà xe identity; null = no identifiable carrier. */
export function carrierKeyForEntry(entry: CarrierDerivationEntry): string | null {
  if (entry.carrierId != null) return `CUST:${entry.carrierId}`;
  if (entry.externalId != null) return `CUST:${entry.externalId}`;
  if (entry.externalPlate) return `PLATE:${normalizeCarrierPlate(entry.externalPlate)}`;
  if (entry.plate) return 'OWN';
  return null;
}

/** Distinct keys for one lot's trips, first-seen order. */
export function carrierKeysForLot(entries: CarrierDerivationEntry[]): string[] {
  const keys: string[] = [];
  for (const entry of entries) {
    const key = carrierKeyForEntry(entry);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

// ─── Ticket 18/11 Task 2.4 (SIL-855) — Debit Note ↔ đợt chốt ───────────────

/** A Debit Note (công nợ phải thu khách) may only attach a THU round of the
 *  SAME customer: a TRA round settles with the nhà xe, not the customer
 *  invoice run. Lives on this db-free module so the chốt service, the
 *  issuance service and the unit pin share ONE law with no import cycle. */
export function assertRoundAttachableToDebitNote(
  round: { customerId: number; direction: string; roundNo: number; periodKey: string },
  customerId: number,
): void {
  if (round.customerId !== customerId) {
    throw new ApiError(409, `Đợt chốt Lần ${round.roundNo} · ${round.periodKey} không cùng khách hàng với các lô được xuất Debit Note.`);
  }
  if (round.direction !== 'THU') {
    throw new ApiError(400, `Debit Note phải thu khách chỉ gắn đợt chiều THU — đợt Lần ${round.roundNo} · ${round.periodKey} là chiều TRA (trả nhà xe), không phát sinh công nợ phải thu.`);
  }
}

/** SIL-855 QA 23/11 (round 5 = 8.536.320 ₫, Công nợ chỉ nhận 4.268.160 ₫) —
 *  the MONEY LAW of a đợt-scoped Debit Note: what the preview shows and what
 *  [Lưu] posts must equal the round record exactly. The đợt's amount is the
 *  board's server-derived Tổng-thu sum at [Chốt đợt] time; the note's lines
 *  come from a DIFFERENT basis (the frozen lock snapshots), so any freeze
 *  that lost a lot's money (R3P-677-C froze null freight) used to slide
 *  through both the preview and the issuance silently. Net is exact (VND
 *  integers, never rounded); gross must equal amount + vatForAmount — the
 *  same whole-base VAT the TỔNG HỢP table prints. A mismatch 409s BEFORE any
 *  document exists, naming the designed remedy (fix the freeze, re-lock,
 *  re-issue) instead of half-posting. Lives beside
 *  assertRoundAttachableToDebitNote so the preview, the issuance and the
 *  unit pin share ONE law with no import cycle. */
export function assertRoundIssuanceTotals(
  totals: { net: number; tax: number; gross: number },
  round: { id: number; roundNo: number; periodKey: string; amount: string | number; vatRate: number },
  remedyHint?: string,
): void {
  const roundAmount = Number(round.amount);
  const roundVat = vatForAmount(roundAmount, round.vatRate);
  const roundGross = roundAmount + roundVat;
  if (totals.net === roundAmount && totals.gross === roundGross) return;
  throw new ApiError(409,
    `Tổng Debit Note lệch với đợt chốt Lần ${round.roundNo} · ${round.periodKey} (#${round.id}): `
    + `bảng khóa lô cho ${totals.net} + VAT ${totals.tax} = ${totals.gross} ₫, đợt đã chốt ${roundAmount} + VAT ${roundVat} = ${roundGross} ₫. `
    + 'Nguyên nhân thường gặp: một lô của đợt bị khóa khi chưa có đủ số tiền cước (ô Cước thu trống trên bảng Kiểm soát lô hàng tại thời điểm khóa). '
    + 'Mở khóa lô, bảo đảm bảng đã có đủ số tiền, khóa lại rồi mới xuất Debit Note — tiền không bao giờ được đẩy thiếu so với đợt chốt.'
    + (remedyHint ? ` ${remedyHint}` : ''));
}

// ─── FIN-01 (QA 28/11, đợt Lần 12 · 2026-11): per-line variance read ────────
// The mismatch alert above names only the two aggregates (bảng khóa lô cho X,
// đợt đã chốt Y) — the accountant cannot see WHICH line drifted. These pure
// types + builder turn the two bases into a per-lot table: the export basis
// (what the preview/[Lưu]/XLSX print) against the per-lot money the đợt
// recorded at chốt time. Lives beside assertRoundIssuanceTotals so the
// service read and the unit pins share ONE law with no import cycle.

/** One đợt lot's two money bases. A missing basis is `null` — never a
 *  fabricated 0₫ (the money-state law): an unlocked lot has no frozen basis,
 *  a board cell that never summed has no ladder value. */
export interface DebitRoundVarianceLineInput {
  shipmentId: number;
  billOrBooking: string | null;
  /** What the export path prints for this lot today (THU: the frozen lock
   *  snapshot's net; TRA: the board's Tổng 1). */
  exportNet: number | null;
  /** What the đợt recorded for this lot at chốt time (the per-lot amount the
   *  chốt summed; legacy rows predate the column → the live-board fallback
   *  the caller resolves). */
  closedNet: number | null;
  /** Why the export basis is missing (lô chưa khóa / ô chưa có số / bản khóa
   *  không đọc được) — surfaced verbatim, never swallowed. */
  basisError?: string | null;
}

export interface DebitRoundVarianceLine extends DebitRoundVarianceLineInput {
  /** exportNet − closedNet; null when either basis is missing. */
  diff: number | null;
  exportVat: number | null;
  closedVat: number | null;
  mismatch: boolean;
}

export interface DebitRoundVarianceReport {
  round: {
    id: number;
    roundNo: number;
    periodKey: string;
    direction: 'THU' | 'TRA';
    vatRate: number;
    /** The đợt's recorded closed money (the record of truth the export gate
     *  asserts against), with its VAT spread at the đợt's rate. */
    closedAmount: number;
    closedVat: number;
    closedGross: number;
  };
  items: DebitRoundVarianceLine[];
  totals: {
    /** Σ export basis; null when ANY line lacks its export basis — the
     *  aggregate is never summed over holes (that is how half-money shipped
     *  in R3P-677-C). */
    exportNet: number | null;
    closedTotal: number;
    varianceNet: number | null;
  };
  mismatchCount: number;
  /** true ⇔ the export gate would pass: every line prints a basis and the
   *  sum equals the recorded total. The dialog keys its Save/XLSX unlock to
   *  the preview 409 clearing, which is this same law server-side. */
  reconciled: boolean;
  /** Where the per-lot closed money came from: the chốt-time column when the
   *  round recorded it, else the live board ladder (legacy rows) — labeled so
   *  a fallback line is never mistaken for a recorded figure. */
  closedBasis: 'CHOT_RECORDED' | 'BOARD_FALLBACK';
}

export function buildDebitRoundVarianceReport(input: {
  round: { id: number; roundNo: number; periodKey: string; direction: 'THU' | 'TRA'; vatRate: number; amount: string | number };
  lines: DebitRoundVarianceLineInput[];
  /** The caller knows which source fed the per-lot closed money (stored
   *  chốt column vs live-board fallback) — declared, not guessed. */
  closedBasis: 'CHOT_RECORDED' | 'BOARD_FALLBACK';
}): DebitRoundVarianceReport {
  const closedTotal = Number(input.round.amount);
  const items: DebitRoundVarianceLine[] = input.lines.map((line) => {
    const diff = line.exportNet != null && line.closedNet != null ? line.exportNet - line.closedNet : null;
    return {
      ...line,
      diff,
      exportVat: line.exportNet == null ? null : vatForAmount(line.exportNet, input.round.vatRate),
      closedVat: line.closedNet == null ? null : vatForAmount(line.closedNet, input.round.vatRate),
      mismatch: diff != null && diff !== 0,
    };
  });
  const exportTotal = items.every((item) => item.exportNet != null)
    ? items.reduce((sum, item) => sum + (item.exportNet ?? 0), 0)
    : null;
  const varianceNet = exportTotal == null ? null : exportTotal - closedTotal;
  return {
    round: {
      id: input.round.id,
      roundNo: input.round.roundNo,
      periodKey: input.round.periodKey,
      direction: input.round.direction,
      vatRate: input.round.vatRate,
      closedAmount: closedTotal,
      closedVat: vatForAmount(closedTotal, input.round.vatRate),
      closedGross: closedTotal + vatForAmount(closedTotal, input.round.vatRate),
    },
    items,
    totals: { exportNet: exportTotal, closedTotal, varianceNet },
    mismatchCount: items.filter((item) => item.mismatch).length,
    reconciled: varianceNet != null && varianceNet === 0 && items.every((item) => item.exportNet != null),
    closedBasis: input.closedBasis,
  };
}
