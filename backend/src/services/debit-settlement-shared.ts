// Card 20260923_12 — shared nhà xe identity derivation for the chot-debit
// board and the Chọn Debit settlement service. Its own module so the board
// assembly and the settlement guards share ONE derivation with no
// service→service import cycle.
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
