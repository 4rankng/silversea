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
): void {
  const roundAmount = Number(round.amount);
  const roundVat = vatForAmount(roundAmount, round.vatRate);
  const roundGross = roundAmount + roundVat;
  if (totals.net === roundAmount && totals.gross === roundGross) return;
  throw new ApiError(409,
    `Tổng Debit Note lệch với đợt chốt Lần ${round.roundNo} · ${round.periodKey} (#${round.id}): `
    + `bảng khóa lô cho ${totals.net} + VAT ${totals.tax} = ${totals.gross} ₫, đợt đã chốt ${roundAmount} + VAT ${roundVat} = ${roundGross} ₫. `
    + 'Nguyên nhân thường gặp: một lô của đợt bị khóa khi chưa có đủ số tiền cước (ô Cước thu trống trên bảng Kiểm soát lô hàng tại thời điểm khóa). '
    + 'Mở khóa lô, bảo đảm bảng đã có đủ số tiền, khóa lại rồi mới xuất Debit Note — tiền không bao giờ được đẩy thiếu so với đợt chốt.');
}
