import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FuelMode, TripStatus } from '@tingting/shared';
import type { TripDetail } from '@tingting/shared';
import { api, ApiError } from '../lib/api';
import { tripClient } from '../api/tripClient';
import { qk } from '../api/keys';
import { useToast } from '../components/shared/Toast';
import type { FormLeg } from './useTripFormLegs';
import type { UseTripFormStateReturn, ContainerFormRow, SealFormRow } from './useTripFormState';
import { resolveContainerCount } from './tripFormDispatchUtils';
import { moneyInputToNumber } from '../lib/moneyInput';

function moneyOrZero(value: string): number { return moneyInputToNumber(value) ?? 0; }
function moneyOrUndefined(value: string): number | undefined { return moneyInputToNumber(value); }
function moneyOrNull(value: string): number | null { return moneyInputToNumber(value) ?? null; }

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
type ServerContainerAfterSave = { id: number; containerTypeId?: number | null; containerNumber?: string | null; sealNumber?: string | null; cargoWeightKg?: string | number | null; notes?: string | null; seals?: Array<{ id: number; sealNumber: string; sealType?: string | null; notes?: string | null }>; photos?: Array<{ id: number; type: 'CONTAINER' | 'SEAL'; storageKey: string; uploadedAt: string }> };

// ─── KP-141: 409 Conflict Reconciliation ──────────────────────────────────
// When a PUT returns409 (version conflict), compare the user's local edits
// against the latest server version. Non-overlapping fields merge
// automatically; overlapping fields surface an explicit conflict error.

/** Each reconcilable field maps a payload key to its TripDetail counterpart
 *  and a normaliser so string ↔ number / null ↔ undefined differences
 *  don't false-positive as changes. */
const RECONCILABLE_FIELDS: ReadonlyArray<{
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

const FIELD_LABELS: Record<string, string> = {
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
function normalizeLegsKey(legs: unknown): string {
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
function reconcilePayload(
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

interface SubmitOptions {
  creditApprovalRequestId?: number | null;
}

interface Params {
  state: UseTripFormStateReturn;
  isEditMode: boolean;
  existingTrip: TripDetail | undefined;
  legs: FormLeg[];
  requiredFieldsFilled: number;
  hasOptionalData: boolean;
  photoUrls: string[];
  flushPendingPhotos: (tripId: number) => Promise<string[]>;
  flushPendingContainerPhotos: (tripId: number, rowKeyToContainerId: Map<string, number>) => Promise<Map<string, string>>;
  governanceReason?: string;
  onCreditLimitBlocked?: (details: { message: string; customerId: number; proposedAmount: number }) => void;
}
export function useTripFormSubmit({ state: s, isEditMode, existingTrip, legs, requiredFieldsFilled, hasOptionalData, photoUrls, flushPendingPhotos, flushPendingContainerPhotos, governanceReason, onCreditLimitBlocked }: Params): (e?: React.FormEvent, options?: SubmitOptions) => Promise<number | undefined> {
const queryClient = useQueryClient();
const { toast: showToast } = useToast();
// One create idempotency key per form session: a retry of the SAME payload
// replays the same trip server-side instead of duplicating it (the create
// endpoint already persists an Idempotency-Key ledger). If the user edits
// the form after a stranded create and retries, the old key 409s ("nội dung
// khác"); that conflict mints a fresh key once so the corrected submission
// is never stuck. Cleared on success — an intentional second create must
// never replay the first.
const createIdempotencyKeyRef = useRef<string | null>(null);
const handleSubmit = useCallback(
  async (e?: React.FormEvent, options?: SubmitOptions): Promise<number | undefined> => {
    e?.preventDefault();
    s.setError("");

    const focusAndScroll = (id: string) => {
      const el = document.getElementById(id);
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    // Compulsory fields check
    if (!s.customerId) {
      const msg = "Customer is required.";
      s.setError(msg);
      showToast({ kind: 'error', message: msg });
      focusAndScroll("customerId");
      return;
    }
    if (!s.routeId) {
      const msg = "Route is required.";
      s.setError(msg);
      showToast({ kind: 'error', message: msg });
      focusAndScroll("routeId");
      return;
    }
    if (!isEditMode && !s.cargoTypeId) {
      const msg = "Loại hàng là bắt buộc.";
      s.setError(msg);
      showToast({ kind: 'error', message: msg });
      focusAndScroll("cargoTypeId");
      return;
    }
    if (!s.plannedContainerTypeId && !s.containerRows.some(r => r.containerTypeId)) {
      const msg = "Loại container là bắt buộc.";
      s.setError(msg);
      showToast({ kind: 'error', message: msg });
      focusAndScroll("plannedContainerTypeId");
      return;
    }
    if (!s.departureDate) {
      const msg = "Ngày khởi hành là bắt buộc.";
      s.setError(msg);
      showToast({ kind: 'error', message: msg });
      focusAndScroll("departureDate");
      return;
    }
    if (s.carrierType === 'OWN') {
      if (!s.truckId) {
        const msg = "Xe đầu kéo là bắt buộc.";
        s.setError(msg);
        showToast({ kind: 'error', message: msg });
        focusAndScroll("truckId");
        return;
      }
      if (!s.trailerType) {
        const msg = "Loại rơ moóc là bắt buộc.";
        s.setError(msg);
        showToast({ kind: 'error', message: msg });
        focusAndScroll("trailerType");
        return;
      }
      if (!s.driverId) {
        const msg = "Lái xe là bắt buộc.";
        s.setError(msg);
        showToast({ kind: 'error', message: msg });
        focusAndScroll("driverId");
        return;
      }
    }
    // EXTERNAL carrier trips: freight cost, plate, driver name and phone are
    // optional at creation — the user may fill them in later. Only the carrier
    // partner identity is required, and that is enforced by the backend schema.

    if (isEditMode) {
      if (existingTrip?.status === TripStatus.COMPLETED && !governanceReason?.trim()) {
        const msg = 'Vui lòng nhập lý do đề nghị thay đổi chuyến đã hoàn thành.';
        s.setError(msg);
        showToast({ kind: 'error', message: msg });
        focusAndScroll('governanceReason');
        return;
      }
      if (legs.length === 0) {
        const msg = 'At least one journey leg is required.';
        s.setError(msg);
        showToast({ kind: 'error', message: msg });
        return;
      }
      for (const leg of legs) {
        if (!leg.origin.trim() || !leg.destination.trim()) {
          const msg = `Leg ${leg.sequence}: Both origin and destination are required.`;
          s.setError(msg);
          showToast({ kind: 'error', message: msg });
          return;
        }
        const kmRaw = (leg.km ?? '').toString().trim();
        if (kmRaw !== '' && (isNaN(Number(kmRaw)) || Number(kmRaw) < 0)) {
          const msg = `Leg ${leg.sequence}: Distance must be a non-negative number.`;
          s.setError(msg);
          showToast({ kind: 'error', message: msg });
          return;
        }
      }
      const supplementNum = Number(s.fuelSupplementLiters);
      if (supplementNum > 0 && !s.fuelSupplementReason.trim()) {
        const msg = 'Please enter a reason for fuel supplement.';
        s.setError(msg);
        showToast({ kind: 'error', message: msg });
        focusAndScroll("fuelSupplementReason");
        return;
      }
    }

    s.setSubmitting(true);
    try {
      // Container type is planning data and must be preserved even when the
      // operational actuals (container number, seals, photos) are not known yet.
      const rowShouldPersist = (r: ContainerFormRow) => Boolean(
        r.containerTypeId ||
        r.containerNumber.trim() ||
        r.seals.some(sl => sl.sealNumber.trim()) ||
        r.cargoWeightKg ||
        r.notes.trim() ||
        r.photoKeys.cont.length > 0 ||
        r.photoKeys.seal.length > 0,
      );
      const rowsToPersist = s.containerRows.filter(rowShouldPersist);
      for (const r of rowsToPersist) {
        // No half-filled seal rows: if any seal field is present, the number is required.
        for (const sl of r.seals) {
          const hasPartial = sl.sealNumber.trim() || sl.sealType.trim() || sl.notes.trim();
          if (hasPartial && !sl.sealNumber.trim()) {
            const msg = 'Each seal must have a seal number. Delete empty seals if not entered.';
            s.setError(msg);
            showToast({ kind: 'error', message: msg });
            return;
          }
        }
      }

      // Persist container instances as part of the unified save (the
      // standalone "Lưu danh sách container" button was removed). Full
      // reconcile: insert/update by id, delete rows not in the list.
      const saveContainers = async (id: number) => {
        const containers = s.containerRows
          .filter(rowShouldPersist)
          .map(r => ({
            id: r.id,
            containerTypeId: r.containerTypeId === '' ? null : Number(r.containerTypeId),
            containerNumber: r.containerNumber.trim() || null,
            // seals[] is the source of truth; backend mirrors seals[0] into legacy sealNumber.
            seals: r.seals
              .filter(sl => sl.sealNumber.trim())
              .map(sl => ({
                id: sl.id,
                sealNumber: sl.sealNumber.trim(),
                sealType: sl.sealType.trim() || null,
                notes: sl.notes.trim() || null,
              })),
            cargoWeightKg: r.cargoWeightKg === '' ? null : Number(r.cargoWeightKg),
            notes: r.notes.trim() || null,
          }));
        const result = await api.put<{ items: ServerContainerAfterSave[] }>(`/trips/${id}/containers`, { containers });
        await queryClient.invalidateQueries({ queryKey: qk.tripForm.tripContainers(id) });

        const items = Array.isArray(result?.items) ? result.items : [];
        const usedKeys = new Set<string>();
        const usedSealKeys = new Set<string>();
        // Track `_key` per post-save item so the flush below can build a
        // map from pre-save `_key` → server-assigned container id (needed
        // for create mode where pre-save ids are all undefined).
        const itemToKey: Array<{ key: string; containerId: number }> = [];
        // Match containers by id first, then containerNumber when present, then
        // a same-type unused blank row. Blank container numbers are allowed, so
        // number-only matching is not enough to preserve _key + buffered photos.
        // Match seals within each container by sealNumber (preserve seal _key).
        s.setContainerRows(items.map((c): ContainerFormRow => {
          const serverNumber = (c.containerNumber ?? '').trim().toUpperCase();
          const serverTypeId = c.containerTypeId ?? '';
          const match = s.containerRows.find(r => !usedKeys.has(r._key) && r.id === c.id)
            ?? (serverNumber
              ? s.containerRows.find(r =>
                  !usedKeys.has(r._key) &&
                  r.containerNumber.trim().toUpperCase() === serverNumber,
                )
              : undefined)
            ?? s.containerRows.find(r =>
              !usedKeys.has(r._key) &&
              !r.containerNumber.trim() &&
              (r.containerTypeId || '') === serverTypeId,
            );
          const _key = match?._key ?? Math.random().toString(36).slice(2, 9);
          if (match) usedKeys.add(_key);
          itemToKey.push({ key: _key, containerId: c.id });
          // Build seals, matching by sealNumber to preserve client _key.
          const serverSeals = c.seals ?? [];
          const seals: SealFormRow[] = serverSeals.map((sl): SealFormRow => {
            const matchedSeal = match?.seals.find(x =>
              !usedSealKeys.has(x._key) &&
              x.sealNumber.trim().toUpperCase() === (sl.sealNumber ?? '').toUpperCase(),
            );
            const sealKey = matchedSeal?._key ?? Math.random().toString(36).slice(2, 9);
            if (matchedSeal) usedSealKeys.add(sealKey);
            return {
              id: sl.id,
              _key: sealKey,
              sealNumber: sl.sealNumber ?? '',
              sealType: sl.sealType ?? '',
              notes: sl.notes ?? '',
            };
          });
          // Group server photos by type into photoKeys, then carry over any
          // `blob:` previews that were captured before this row was saved.
          // The pre-save `match.photoKeys` still has them (form state is
          // closure-captured at handleSubmit time). Carry-over is safe
          // because `revokeRowPhotos` already removed deleted rows' pending
          // entries from the buffer — so a blob here is still buffered and
          // will be flushed below. Without this, the subsequent swap would
          // miss (post-save rows only have server keys, not the blob keys
          // the swap map uses as lookup keys).
          const photos = c.photos ?? [];
          const pendingBlobsCont = (match?.photoKeys.cont ?? []).filter(u => u.startsWith('blob:'));
          const pendingBlobsSeal = (match?.photoKeys.seal ?? []).filter(u => u.startsWith('blob:'));
          const photoKeys = {
            cont: [
              ...photos.filter(p => p.type === 'CONTAINER').map(p => p.storageKey),
              ...pendingBlobsCont,
            ],
            seal: [
              ...photos.filter(p => p.type === 'SEAL').map(p => p.storageKey),
              ...pendingBlobsSeal,
            ],
          };
          return {
            id: c.id,
            _key,
            containerTypeId: c.containerTypeId ?? '',
            containerNumber: c.containerNumber ?? '',
            sealNumber: seals[0]?.sealNumber ?? '',
            cargoWeightKg: c.cargoWeightKg != null ? String(c.cargoWeightKg) : '',
            notes: c.notes ?? '',
            seals,
            photoKeys,
          };
        }));

        // Flush per-container photos captured before the row had an id.
        // Build the map from the post-save items (which carry the new
        // server-assigned ids) — using the pre-save `s.containerRows`
        // snapshot would miss ids in create mode (where pre-save ids are
        // all undefined).
        const rowKeyToContainerId = new Map<string, number>();
        for (const { key, containerId } of itemToKey) {
          rowKeyToContainerId.set(key, containerId);
        }
        if (rowKeyToContainerId.size > 0) {
          const swaps = await flushPendingContainerPhotos(id, rowKeyToContainerId);
          if (swaps.size > 0) {
            s.setContainerRows(prev => prev.map(r => ({
              ...r,
              photoKeys: {
                cont: r.photoKeys.cont.map(u => swaps.get(u) ?? u),
                seal: r.photoKeys.seal.map(u => swaps.get(u) ?? u),
              },
            })));
          }
        }
      };

      if (isEditMode && existingTrip) {
        const payload = {
          customerId: Number(s.customerId),
          routeId: s.routeId ? Number(s.routeId) : undefined,
          departureDate: s.departureDate || undefined,
          completedAt: s.completedAt || undefined,
          // Untouched blank suggestions drop out — no invented empty endpoints.
          legs: legs
            .filter(l => l.origin.trim() || l.destination.trim() || String(l.km).trim())
            .map(l => ({ sequence: l.sequence, origin: l.origin.trim(), destination: l.destination.trim(), km: Number(l.km), loadingType: l.loadingType })),
          version: existingTrip.version,
          fuelMode: s.fuelMode,
          fuelLitersOverride: s.fuelMode === FuelMode.FLAT_RATE ? (s.fuelLitersOverride ? Number(s.fuelLitersOverride) : 0) : undefined,
          fuelSupplementLiters: s.fuelSupplementLiters ? Number(s.fuelSupplementLiters) : 0,
          fuelSupplementReason: s.fuelSupplementReason.trim() || undefined,
          tollsDiscount: moneyOrZero(s.tollsDiscount),
          tollsAddition: moneyOrZero(s.tollsAddition),
          tollsStations: s.tollsStations ? Number(s.tollsStations) : 0,
          hasReturnCargo: s.hasReturnCargo,
          driverSalary: moneyOrUndefined(s.driverSalary),
          twoPointDeliveryBonus: moneyOrZero(s.twoPointDeliveryBonus),
          vehicleShiftAllowance: moneyOrZero(s.vehicleShiftAllowance),
          // Revenue is split-based; `revenue` is derived and recomputed
          // server-side from the splits. Send splits as `undefined` when
          // untouched (NOT 0) so resolveRevenue preserves stored revenue, and
          // omit the derived `revenue` copy — sending it would zero stored
          // revenue whenever both splits are blank. feedback202606 A3 §9.
          revenueEmptyReturn: moneyOrUndefined(s.revenueEmptyReturn),
          revenueCombine: moneyOrUndefined(s.revenueCombine),
          notes: s.notes.trim() || undefined,
          roadAllowanceOverride: moneyOrNull(s.roadAllowanceOverride),
          fuelActualUnitPrice: moneyOrNull(s.fuelActualUnitPrice),
          fuelSupplierId: s.fuelSupplierId !== null ? s.fuelSupplierId : null,
          customerCommission: moneyOrZero(s.customerCommission),
          tripWageDays: s.tripWageDays ? Number(s.tripWageDays) : undefined,
          carrierType: s.carrierType,
          externalCarrierId: s.carrierType === 'EXTERNAL' ? (s.externalCarrierId ?? null) : null,
          externalFreightCost: s.carrierType === 'EXTERNAL' ? moneyOrNull(s.externalFreightCost) : null,
          externalPlateNumber: s.carrierType === 'EXTERNAL' ? (s.externalPlateNumber.trim() || null) : null,
          externalDriverName: s.carrierType === 'EXTERNAL' ? (s.externalDriverName.trim() || null) : null,
          externalDriverPhone: s.carrierType === 'EXTERNAL' ? (s.externalDriverPhone.trim() || null) : null,
          truckId: s.carrierType === 'OWN' ? (s.truckId ? Number(s.truckId) : null) : null,
          driverId: s.carrierType === 'OWN' ? (s.driverId ? Number(s.driverId) : null) : null,
          trailerType: s.carrierType === 'OWN' ? (s.trailerType || null) : null,
          governanceReason: existingTrip.status === TripStatus.COMPLETED
            ? governanceReason!.trim()
            : undefined,
        };

        const endpoint = existingTrip.status === TripStatus.CREATED ? `/trips/${existingTrip.id}/pre-departure` : `/trips/${existingTrip.id}/actuals`;
        const putFigures = (version: number) =>
          api.put<Record<string, unknown>>(endpoint, { ...payload, version });
        let updatedTrip: Record<string, unknown>;
        try {
          updatedTrip = await putFigures(existingTrip.version);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 409)) throw err;
          // KP-141: Instead of a blind full-payload retry with just a fresh
          // version, reconcile local edits against the latest server state.
          await queryClient.refetchQueries({ queryKey: qk.trips.detail(existingTrip.id) });
          const fresh = queryClient.getQueryData<TripDetail>(qk.trips.detail(existingTrip.id));
          if (!fresh) throw err;
          const { merged, conflicts } = reconcilePayload(payload, existingTrip, fresh);
          if (conflicts.length > 0) {
            const labels = conflicts.map(c => FIELD_LABELS[c] ?? c);
            throw new ApiError(409, null, `Xung đột thay đổi trên: ${labels.join(', ')}. Vui lòng tải lại trang.`);
          }
          updatedTrip = await api.put<Record<string, unknown>>(endpoint, merged);
        }
        queryClient.invalidateQueries({ queryKey: qk.trips.all });
        queryClient.setQueryData(qk.trips.detail(existingTrip.id), updatedTrip);
        queryClient.invalidateQueries({ queryKey: qk.trips.detail(existingTrip.id) });
        queryClient.invalidateQueries({ queryKey: qk.trips.adjustments(existingTrip.id) });
        showToast({ kind: 'success', message: 'Đã lưu thay đổi.' });

        await saveContainers(existingTrip.id);
        // Manager-authored contact + guidance (N2 / B1.3) — persisted via the
        // existing PUT /api/trips/:id/instructions route. Always called so
        // a manager can blank a previously-typed contact. The trip figures
        // above are already committed, so this is best-effort and must never
        // roll them back — but if it fails we surface the error and stay on
        // the page (return undefined) so the manager actually sees it and can
        // retry. Navigating to the detail page on success would otherwise
        // discard the message before it renders.
        try {
          await tripClient.upsertTripInstructions(existingTrip.id, {
            contactName: s.contactName.trim() || null,
            contactPhone: s.contactPhone.trim() || null,
            notes: s.instructionsNotes.trim() || null,
          });
        } catch (instErr) {
          console.error('Trip instructions upsert failed:', instErr);
          const msg = instErr instanceof ApiError
            ? `Instructions not saved: ${instErr.message}`
            : 'Instructions not saved. Please try again.';
          s.setError(msg);
          showToast({ kind: 'error', message: msg });
          return undefined;
        }
        return existingTrip.id;
      }

      // Validate the optional block BEFORE creating anything. The old flow
      // POSTed the base trip first and validated legs after — an invalid leg
      // stranded a "Mới tạo" trip and the corrected retry duplicated it.
      if (hasOptionalData) {
        const invalidLeg = findInvalidLeg(legs);
        if (invalidLeg) {
          throw new Error(
            `Leg ${invalidLeg.sequence} is invalid (Both origin and destination are required; Distance must be a non-negative number).`,
          );
        }
        const supplementNum = Number(s.fuelSupplementLiters);
        if (supplementNum > 0 && !s.fuelSupplementReason.trim()) {
          throw new Error("Please enter a reason for fuel supplement.");
        }
      }

      const createPayload: Record<string, unknown> = {
        customerId: Number(s.customerId),
        routeId: Number(s.routeId),
        cargoTypeId: Number(s.cargoTypeId),
        departureDate: s.departureDate,
        fuelMode: s.fuelMode,
        carrierType: s.carrierType,
        vatRate: s.vatRate,
        fuelSupplierId: s.carrierType === 'OWN' ? (s.fuelSupplierId ?? null) : null,
        // Per-trip actual pump price — only OWN trips consume fuel. Blank
        // (null) falls back to the config snapshot server-side.
        fuelActualUnitPrice: s.carrierType === 'OWN' ? moneyOrNull(s.fuelActualUnitPrice) : null,
      };
      if (s.carrierType === 'OWN') {
        createPayload.truckId = Number(s.truckId);
        createPayload.trailerType = s.trailerType || undefined;
        createPayload.driverId = Number(s.driverId);
      } else {
        createPayload.truckId = null;
        createPayload.driverId = null;
        createPayload.externalCarrierId = s.externalCarrierId ?? undefined;
        createPayload.externalFreightCost = moneyOrUndefined(s.externalFreightCost);
        createPayload.externalPlateNumber = s.externalPlateNumber.trim() || undefined;
        createPayload.externalDriverName = s.externalDriverName.trim() || undefined;
        createPayload.externalDriverPhone = s.externalDriverPhone.trim() || undefined;
      }
      if (s.customerReference.trim()) {
        createPayload.customerReference = s.customerReference.trim();
      }
      const count = resolveContainerCount(s.containerCount);
      createPayload.containerCount = count;
      createPayload.containerTypeId = Number(s.plannedContainerTypeId || s.containerRows.find(r => r.containerTypeId)?.containerTypeId);
      const effectiveCreditApprovalRequestId = options?.creditApprovalRequestId ?? null;
      if (effectiveCreditApprovalRequestId != null) {
        createPayload.creditApprovalRequestId = effectiveCreditApprovalRequestId;
      }
      const postCreate = () => {
        createIdempotencyKeyRef.current ??= crypto.randomUUID();
        return api.post<{ id: number }>("/trips", createPayload, {
          headers: { 'Idempotency-Key': createIdempotencyKeyRef.current },
        });
      };
      let trip: { id: number };
      try {
        trip = await postCreate();
      } catch (keyError) {
        const keyConflict = keyError instanceof ApiError
          && keyError.status === 409
          && keyError.message.includes('mã giao dịch');
        if (!keyConflict) throw keyError;
        // Same form-session key, different payload (the form was edited
        // after a stranded create): the server refuses the replay — mint a
        // fresh key and retry once so the corrected submission proceeds.
        console.warn('Trip create idempotency key conflict — regenerating key and retrying once.', keyError.message);
        createIdempotencyKeyRef.current = crypto.randomUUID();
        trip = await postCreate();
      }

      // Upload any create-mode OCR photos now that we have a trip id,
      // replacing their local previews with real server URLs.
      let finalPhotoUrls = photoUrls;
      try {
        finalPhotoUrls = await flushPendingPhotos(trip.id);
      } catch {
        // Photos are optional — don't abort the freshly-created trip.
      }

      if (hasOptionalData) {
        const legsToSubmit = legs.filter(
          (leg) => leg.origin.trim() !== '' || leg.destination.trim() !== '' || leg.km.trim() !== '',
        );

        if (legsToSubmit.length === 0) {
          createIdempotencyKeyRef.current = null;
          return trip.id;
        }

        const preDeparturePayload = {
          legs: legsToSubmit.map((l) => ({
            sequence: l.sequence,
            origin: l.origin.trim(),
            destination: l.destination.trim(),
            km: Number(l.km),
            loadingType: l.loadingType,
          })),
          fuelMode: s.fuelMode,
          fuelLitersOverride:
            s.fuelMode === FuelMode.FLAT_RATE
              ? s.fuelLitersOverride
                ? Number(s.fuelLitersOverride)
                : 0
              : undefined,
          fuelSupplementLiters: s.fuelSupplementLiters
            ? Number(s.fuelSupplementLiters)
            : 0,
          fuelSupplementReason: s.fuelSupplementReason.trim() || undefined,
          tollsDiscount: moneyOrZero(s.tollsDiscount),
          tollsAddition: moneyOrZero(s.tollsAddition),
          tollsStations: s.tollsStations ? Number(s.tollsStations) : 0,
          hasReturnCargo: s.hasReturnCargo,
          driverSalary: moneyOrUndefined(s.driverSalary),
          twoPointDeliveryBonus: moneyOrZero(s.twoPointDeliveryBonus),
          vehicleShiftAllowance: moneyOrZero(s.vehicleShiftAllowance),
          // Revenue is split-based; `revenue` is derived and recomputed
          // server-side from the splits. Send splits as `undefined` when
          // untouched (NOT 0) so resolveRevenue preserves stored revenue, and
          // omit the derived `revenue` copy — sending it would zero stored
          // revenue whenever both splits are blank. feedback202606 A3 §9.
          revenueEmptyReturn: moneyOrUndefined(s.revenueEmptyReturn),
          revenueCombine: moneyOrUndefined(s.revenueCombine),
          notes: s.notes.trim() || undefined,
          photoUrls: finalPhotoUrls,
          fuelActualUnitPrice: moneyOrNull(s.fuelActualUnitPrice),
          fuelSupplierId: s.fuelSupplierId !== null ? s.fuelSupplierId : null,
          customerCommission: moneyOrZero(s.customerCommission),
          tripWageDays: s.tripWageDays ? Number(s.tripWageDays) : undefined,
        };
        await api.put(`/trips/${trip.id}/pre-departure`, preDeparturePayload);
      }
      await saveContainers(trip.id);
      // Skip the instructions upsert in the create flow — TripCreatePage
      // doesn't mount the instructions card, so the fields are guaranteed
      // empty and a no-op upsert would still create an empty row + an
      // audit entry. The user fills the instructions later on the edit
      // page, where the upsert runs.
      createIdempotencyKeyRef.current = null;
      await queryClient.invalidateQueries({ queryKey: qk.trips.all });
      return trip.id;
    } catch (err) {
      if (
        !isEditMode
        && err instanceof ApiError
        && err.status === 403
        && err.message.includes('Khách hàng đã vượt hạn mức tín dụng')
      ) {
        onCreditLimitBlocked?.({
          message: err.message,
          customerId: Number(s.customerId),
          proposedAmount: (Number(s.revenueEmptyReturn || 0) + Number(s.revenueCombine || 0)) || 0,
        });
      }
      if (isEditMode && err instanceof ApiError && err.status === 409) {
        const msg = err.message || "Version conflict: your local data is stale. Please reload.";
        s.setError(msg);
        showToast({ kind: 'error', message: msg });
        throw err;
      }
      let msg = "An error occurred. Please try again.";
      if (err instanceof ApiError) {
        msg = err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      s.setError(msg);
      showToast({ kind: 'error', message: msg });
      return undefined;
    } finally {
      s.setSubmitting(false);
    }
  },
  // 's' object omitted: individual s.* fields listed below are the correct
  // granularity for this submit handler.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [
    isEditMode, existingTrip, requiredFieldsFilled, s.containerRows,
    s.customerId, s.routeId, s.truckId, s.trailerType,
    s.driverId, s.cargoTypeId, s.departureDate, s.customerReference, s.containerCount,
    s.plannedContainerTypeId,
    hasOptionalData, legs, s.fuelMode, s.fuelLitersOverride,
    s.fuelSupplementLiters, s.fuelSupplementReason, s.tollsDiscount,
    s.tollsAddition, s.tollsStations, s.hasReturnCargo, s.driverSalary,
    s.roadAllowanceOverride,
    s.fuelActualUnitPrice,
    s.fuelSupplierId,
    s.customerCommission, s.tripWageDays,
    s.twoPointDeliveryBonus, s.vehicleShiftAllowance,
    s.revenue, s.revenueEmptyReturn, s.revenueCombine, s.notes, photoUrls,
    s.contactName, s.contactPhone, s.instructionsNotes,
    flushPendingPhotos,
    flushPendingContainerPhotos,
    onCreditLimitBlocked,
    s.carrierType, s.vatRate, s.externalCarrierId, s.externalFreightCost,
    s.externalPlateNumber, s.externalDriverName, s.externalDriverPhone,
    queryClient,
  ],
);
return handleSubmit;
}
