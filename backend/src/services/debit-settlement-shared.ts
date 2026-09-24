// Card 20260923_12 — shared nhà xe identity derivation for the chot-debit
// board and the Chọn Debit settlement service. Its own module so the board
// assembly and the settlement guards share ONE derivation with no
// service→service import cycle.

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
