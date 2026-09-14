import type { TripDetail } from '@tingting/shared';
import type { FormLeg } from './useTripFormLegs';
import { moneyInputToNumber } from '../lib/moneyInput';

export function moneyOrZero(value: string): number { return moneyInputToNumber(value) ?? 0; }
export function moneyOrUndefined(value: string): number | undefined { return moneyInputToNumber(value); }
export function moneyOrNull(value: string): number | null { return moneyInputToNumber(value) ?? null; }

/** Pre-create leg validation: a leg with any field filled must carry both
 *  endpoints and a non-negative numeric distance. Pure and shared with the
 *  form's readiness bar so submit-time errors and the bar can never
 *  disagree about the same legs. Fully-empty rows are exempt (they are
 *  filtered out of the submission). */
export function findInvalidLeg(legs: FormLeg[]): FormLeg | null {
  for (const leg of legs) {
    const filled = leg.origin.trim() !== '' || leg.destination.trim() !== '' || leg.km.trim() !== '';
    if (!filled) continue;
    const kmNum = leg.km.trim() === '' ? 0 : Number(leg.km);
    if (!leg.origin.trim() || !leg.destination.trim() || Number.isNaN(kmNum) || kmNum < 0) return leg;
  }
  return null;
}
export type ServerContainerAfterSave = { id: number; containerTypeId?: number | null; containerNumber?: string | null; sealNumber?: string | null; cargoWeightKg?: string | number | null; notes?: string | null; seals?: Array<{ id: number; sealNumber: string; sealType?: string | null; notes?: string | null }>; photos?: Array<{ id: number; type: 'CONTAINER' | 'SEAL'; storageKey: string; uploadedAt: string }> };

// ─── KP-141: 409 Conflict Reconciliation ──────────────────────────────────
// When a PUT returns409 (version conflict), compare the user's local edits
// against the latest server version. Non-overlapping fields merge
// automatically; overlapping fields surface an explicit conflict error.

/** Each reconcilable field maps a payload key to its TripDetail counterpart
 *  and a normaliser so string ↔ number / null ↔ undefined differences
 *  don't false-positive as changes. */
export const RECONCILABLE_FIELDS: ReadonlyArray<{
  payloadKey: string;
  tripKey: keyof TripDetail;
  normalize: (v: unknown) => unknown;
}> = [
  { payloadKey: 'customerId', tripKey: 'customerId', normalize: Number },
  { payloadKey: 'routeId', tripKey: 'routeId', normalize: Number },
  { payloadKey: 'departureDate', tripKey: 'departureDate', normalize: v => v ?? null },
  { payloadKey: 'completedAt', tripKey: 'completedAt', normalize: v => v ?? null },
  { payloadKey: 'fuelMode', tripKey: 'fuelMode', normalize: v => v ?? null },
  { payloadKey: 'fuelLitersOverride', tripKey: 'fuelLitersOverride', normalize: v => v == null ? null : Number(v) },
  { payloadKey: 'fuelSupplementLiters', tripKey: 'fuelSupplementLiters', normalize: v => v == null ? 0 : Number(v) },
  { payloadKey: 'fuelSupplementReason', tripKey: 'fuelSupplementReason', normalize: v => v ?? null },
  { payloadKey: 'tollsDiscount', tripKey: 'tollsDiscount', normalize: v => Number(v ?? 0) },
  { payloadKey: 'tollsAddition', tripKey: 'tollsAddition', normalize: v => Number(v ?? 0) },
  { payloadKey: 'tollsStations', tripKey: 'tollsStations', normalize: Number },
  { payloadKey: 'hasReturnCargo', tripKey: 'hasReturnCargo', normalize: Boolean },
  { payloadKey: 'driverSalary', tripKey: 'driverSalary', normalize: v => v == null ? null : Number(v) },
  { payloadKey: 'twoPointDeliveryBonus', tripKey: 'twoPointDeliveryBonus', normalize: v => Number(v ?? 0) },
  { payloadKey: 'vehicleShiftAllowance', tripKey: 'vehicleShiftAllowance', normalize: v => Number(v ?? 0) },
  { payloadKey: 'revenueEmptyReturn', tripKey: 'revenueEmptyReturn', normalize: v => v == null ? null : Number(v) },
  { payloadKey: 'revenueCombine', tripKey: 'revenueCombine', normalize: v => v == null ? null : Number(v) },
  { payloadKey: 'notes', tripKey: 'notes', normalize: v => v ?? null },
  { payloadKey: 'roadAllowanceOverride', tripKey: 'roadAllowanceOverride', normalize: v => v == null ? null : Number(v) },
  { payloadKey: 'fuelActualUnitPrice', tripKey: 'fuelActualUnitPrice', normalize: v => v == null ? null : Number(v) },
  { payloadKey: 'fuelSupplierId', tripKey: 'fuelSupplierId', normalize: v => v ?? null },
  { payloadKey: 'customerCommission', tripKey: 'customerCommission', normalize: v => Number(v ?? 0) },
  { payloadKey: 'tripWageDays', tripKey: 'tripWageDays', normalize: v => v ?? null },
  { payloadKey: 'carrierType', tripKey: 'carrierType', normalize: v => v ?? null },
  { payloadKey: 'externalCarrierId', tripKey: 'externalCarrierId', normalize: v => v ?? null },
  { payloadKey: 'externalFreightCost', tripKey: 'externalFreightCost', normalize: v => v == null ? null : Number(v) },
  { payloadKey: 'externalPlateNumber', tripKey: 'externalPlateNumber', normalize: v => v ?? null },
  { payloadKey: 'externalDriverName', tripKey: 'externalDriverName', normalize: v => v ?? null },
  { payloadKey: 'externalDriverPhone', tripKey: 'externalDriverPhone', normalize: v => v ?? null },
  { payloadKey: 'truckId', tripKey: 'truckId', normalize: v => v ?? null },
  { payloadKey: 'driverId', tripKey: 'driverId', normalize: v => v ?? null },
  { payloadKey: 'trailerType', tripKey: 'trailerType', normalize: v => v ?? null },
];

export const FIELD_LABELS: Record<string, string> = {
  customerId: 'Khách hàng', routeId: 'Tuyến đường', departureDate: 'Ngày khởi hành',
  completedAt: 'Ngày hoàn thành', fuelMode: 'Loại nhiên liệu', fuelLitersOverride: 'Định mức nhiên liệu',
  fuelSupplementLiters: 'Phụ trội nhiên liệu', fuelSupplementReason: 'Lý do phụ trội',
  tollsDiscount: 'Giảm phí cầu đường', tollsAddition: 'Phụ phí cầu đường', tollsStations: 'Số trạm',
  hasReturnCargo: 'Hàng trả về', driverSalary: 'Lái xe lương', twoPointDeliveryBonus: 'Thưởng 2 điểm',
  vehicleShiftAllowance: 'Phụ cấp chuyến', revenueEmptyReturn: 'Doanh thu chạy rỗng',
  revenueCombine: 'Doanh thu gộp', notes: 'Ghi chú', roadAllowanceOverride: 'Phụ cấp đường bộ',
  fuelActualUnitPrice: 'Đơn giá nhiên liệu', fuelSupplierId: 'Nhà cung cấp nhiên liệu',
  customerCommission: 'Hoa hồng KH', tripWageDays: 'Số ngày công', carrierType: 'Loại vận tải',
  externalCarrierId: 'Nhà vận tải', externalFreightCost: 'Cước vận tải ngoài',
  externalPlateNumber: 'Biển số xe ngoài', externalDriverName: 'Lái xe ngoài',
  externalDriverPhone: 'SĐT lái xe ngoài', truckId: 'Xe đầu kéo', driverId: 'Lái xe',
  trailerType: 'Loại rơ moóc', legs: 'Chặng hành trình',
};

/** Normalise legs to a canonical sorted JSON string for 3-way comparison. */
export function normalizeLegsKey(legs: unknown): string {
  if (!Array.isArray(legs)) return '[]';
  return JSON.stringify(
    legs
      .map((l: Record<string, unknown>) => ({
        sequence: Number(l.sequence),
        origin: String(l.origin ?? '').trim(),
        destination: String(l.destination ?? '').trim(),
        km: Number(l.km),
        loadingType: String(l.loadingType ?? ''),
      }))
      .sort((a, b) => a.sequence - b.sequence),
  );
}

/**
 * 3-way merge: compare user's local payload against original (the snapshot
 * the user started editing) and latest (the current server state).
 * Non-overlapping changes merge automatically; overlapping → conflict list.
 */
export function reconcilePayload(
  payload: Record<string, unknown>,
  original: TripDetail,
  latest: TripDetail,
): { merged: Record<string, unknown>; conflicts: string[] } {
  const merged: Record<string, unknown> = { ...payload, version: latest.version };
  const conflicts: string[] = [];

  for (const f of RECONCILABLE_FIELDS) {
    const localNorm = f.normalize(payload[f.payloadKey]);
    const originalNorm = f.normalize(original[f.tripKey]);
    const latestNorm = f.normalize(latest[f.tripKey]);

    const userChanged = !Object.is(localNorm, originalNorm);
    const serverChanged = !Object.is(latestNorm, originalNorm);

    if (userChanged && serverChanged) {
      conflicts.push(f.payloadKey);
    } else if (serverChanged) {
      // Only the server changed this field — accept its value.
      merged[f.payloadKey] = (latest as unknown as Record<string, unknown>)[f.tripKey];
    }
    // If only the user changed (or neither), keep the payload value.
  }

  // Legs: compare as sorted JSON arrays of comparable sub-fields.
  const localLegsKey = normalizeLegsKey(payload.legs);
  const originalLegsKey = normalizeLegsKey(original.legs);
  const latestLegsKey = normalizeLegsKey(latest.legs);

  if (localLegsKey !== originalLegsKey && latestLegsKey !== originalLegsKey) {
    conflicts.push('legs');
  } else if (latestLegsKey !== originalLegsKey) {
    merged.legs = latest.legs.map(l => ({
      sequence: l.sequence, origin: l.origin, destination: l.destination,
      km: l.km, loadingType: l.loadingType,
    }));
  }

  return { merged, conflicts };
}
