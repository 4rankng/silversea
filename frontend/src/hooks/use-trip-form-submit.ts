import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FuelMode, TripStatus, tripContainerBatchSchema } from '@tingting/shared';
import type { TripDetail } from '@tingting/shared';
import { api, ApiError } from '../lib/api';
import { tripClient } from '../api/tripClient';
import { qk } from '../api/keys';
import { useToast } from '../components/shared/Toast';
import type { ContainerFormRow, SealFormRow } from './useTripFormState';
import { resolveContainerCount } from './tripFormDispatchUtils';
import type { PhotoUploadedHandler } from './useTripFormPhotos';
import {
  FIELD_LABELS,
  moneyOrNull,
  moneyOrUndefined,
  moneyOrZero,
  reconcilePayload,
  TripEditConflictError,
  type ServerContainerAfterSave,
} from './tripSubmitReconcile';
import { findInvalidLeg } from './tripSubmitReconcile';
export { findInvalidLeg };


import type { SubmitOptions, TripFormSubmitParams as Params } from './tripSubmitTypes';
export type { SubmitOptions } from './tripSubmitTypes';

export function useTripFormSubmit({ state: s, isEditMode, existingTrip, legs, requiredFieldsFilled, hasOptionalData, photoUrls, flushPendingPhotos, flushPendingContainerPhotos, governanceReason, onCreditLimitBlocked }: Params): (e?: React.FormEvent, options?: SubmitOptions) => Promise<number | undefined> {
const queryClient = useQueryClient();
const { toast: showToast } = useToast();
// One key and, once confirmed, one trip ID per form session. Retrying failed
// child writes resumes that trip; an idempotency conflict never rotates the
// key and silently creates a duplicate. Clear only after all data is saved.
const createIdempotencyKeyRef = useRef<string | null>(null);
const createdTripRef = useRef<{ id: number } | null>(null);
const submittingRef = useRef(false);
const editBaselineRef = useRef({ trip: existingTrip, reset: s.resetToggle });
if (existingTrip && (editBaselineRef.current.trip?.id !== existingTrip.id || editBaselineRef.current.reset !== s.resetToggle)) {
  editBaselineRef.current = { trip: existingTrip, reset: s.resetToggle };
}
const conflictRef = useRef<{ latest: TripDetail; merged: Record<string, unknown>; fields: string[] } | null>(null);
const handleSubmit = useCallback(
  async (e?: React.FormEvent, options?: SubmitOptions): Promise<number | undefined> => {
    e?.preventDefault();
    if (submittingRef.current) return;
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
        const msg = 'Vui lòng nhập lý do điều chỉnh chuyến đã hoàn thành.';
        s.setError(msg);
        showToast({ kind: 'error', message: msg });
        focusAndScroll('governanceReason');
        return;
      }
      for (const leg of legs) {
        if (!leg.origin.trim() && !leg.destination.trim() && !leg.km.trim()) continue;
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

    submittingRef.current = true;
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
      const containerValidation = tripContainerBatchSchema.safeParse({
        containers: rowsToPersist.map(row => ({
          containerTypeId: row.containerTypeId || null,
          containerNumber: row.containerNumber.trim() || null,
          cargoWeightKg: row.cargoWeightKg === '' ? null : Number(row.cargoWeightKg),
          seals: row.seals.filter(seal => seal.sealNumber.trim()).map(seal => ({ sealNumber: seal.sealNumber.trim() })),
        })),
      });
      if (!containerValidation.success) throw new Error(containerValidation.error.issues[0]?.message ?? 'Thông tin container không hợp lệ.');
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
        if (items.length !== containers.length) {
          // A missing row in a successful response must not erase the draft
          // or its only pending image. Retain it and report incomplete save.
          throw new Error('Máy chủ chưa trả đủ container đã lưu. Bản nháp và ảnh vẫn được giữ; vui lòng thử lại.');
        }
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
        {
          const replacePreview: PhotoUploadedHandler = (preview, persisted) => {
            s.setContainerRows(previous => previous.map(row => ({
              ...row,
              photoKeys: {
                cont: row.photoKeys.cont.map(url => url === preview ? persisted : url),
                seal: row.photoKeys.seal.map(url => url === preview ? persisted : url),
              },
            })));
          };
          const swaps = await flushPendingContainerPhotos(id, rowKeyToContainerId, replacePreview);
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
        const original = editBaselineRef.current.trip ?? existingTrip;
        const payload = {
          customerId: Number(s.customerId),
          routeId: s.routeId ? Number(s.routeId) : undefined,
          departureDate: s.departureDate || undefined,
          completedAt: s.completedAt || undefined,
          // Untouched blank suggestions drop out — no invented empty endpoints.
          legs: legs
            .filter(l => l.origin.trim() || l.destination.trim() || String(l.km).trim())
            .map(l => ({ sequence: l.sequence, origin: l.origin.trim(), destination: l.destination.trim(), km: Number(l.km), loadingType: l.loadingType })),
          version: original.version,
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
          notes: s.notes.trim(),
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
        let submission: Record<string, unknown> = payload;
        let baseline = original;
        const reviewed = options?.conflictResolution;
        if (reviewed) {
          const pending = conflictRef.current;
          if (!pending || reviewed.version !== pending.latest.version || pending.fields.some(key => !reviewed.choices[key])) {
            throw new Error('Chọn giá trị cho từng trường xung đột trước khi lưu.');
          }
          baseline = pending.latest;
          submission = { ...pending.merged, version: reviewed.version };
          for (const key of pending.fields) {
            if (reviewed.choices[key] === 'server') submission[key] = pending.latest[key as keyof TripDetail];
          }
        }
        let updatedTrip: Record<string, unknown>;
        try {
          updatedTrip = await api.put<Record<string, unknown>>(endpoint, submission);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 409 && err.message.includes('Dữ liệu đã bị thay đổi bởi người khác'))) throw err;
          // KP-141: Instead of a blind full-payload retry with just a fresh
          // version, reconcile local edits against the latest server state.
          await queryClient.refetchQueries({ queryKey: qk.trips.detail(existingTrip.id) });
          const fresh = queryClient.getQueryData<TripDetail>(qk.trips.detail(existingTrip.id));
          if (!fresh || fresh.version === baseline.version) throw err;
          const { merged, conflicts } = reconcilePayload(submission, baseline, fresh);
          if (conflicts.length > 0) {
            conflictRef.current = { latest: fresh, merged, fields: conflicts };
            throw new TripEditConflictError(fresh.version, conflicts.map(key => ({
              key, label: FIELD_LABELS[key] ?? key, local: merged[key], latest: fresh[key as keyof TripDetail],
            })));
          }
          updatedTrip = await api.put<Record<string, unknown>>(endpoint, merged);
        }
        conflictRef.current = null;
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
      if (options?.creditException) {
        createPayload.creditException = options.creditException;
      }
      const postCreate = () => {
        createIdempotencyKeyRef.current ??= crypto.randomUUID();
        return api.post<{ id: number }>("/trips", createPayload, {
          headers: { 'Idempotency-Key': createIdempotencyKeyRef.current },
        });
      };
      const continuingCreatedTrip = createdTripRef.current != null;
      const trip = createdTripRef.current ?? await postCreate();
      createdTripRef.current = trip;

      // Upload any create-mode OCR photos now that we have a trip id,
      // replacing their local previews with real server URLs.
      const finalPhotoUrls = await flushPendingPhotos(trip.id);

      if (hasOptionalData || continuingCreatedTrip) {
        const legsToSubmit = legs.filter(
          (leg) => leg.origin.trim() !== '' || leg.destination.trim() !== '' || leg.km.trim() !== '',
        );

        const preDeparturePayload = {
          // A child-write retry continues the already-created trip. Keep any
          // corrections made in the open form without another POST.
          ...(continuingCreatedTrip ? createPayload : {}),
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
      createdTripRef.current = null;
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
      if (!isEditMode && createdTripRef.current) {
        msg = `Đã tạo chuyến #${createdTripRef.current.id}, nhưng chưa lưu xong dữ liệu kèm theo. ${msg} Bấm Lưu để tiếp tục trên chuyến này.`;
      }
      s.setError(msg);
      showToast({ kind: 'error', message: msg });
      return undefined;
    } finally {
      submittingRef.current = false;
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
