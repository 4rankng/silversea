import { useEffect, useRef, useState } from 'react';
import { Loader2, Shuffle, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { tripClient } from '../../../api/tripClient';
import {
  listDispatchFleetResources,
  type DispatchCarrierVehicle,
} from '../../../api/dispatchPlanningClient';
import { qk } from '../../../api/keys';
import { useCatalogs } from '../../../hooks/useCatalogs';
import { useTrucksAndDrivers } from '../../../hooks/useCatalogQueries';
import { useTripDetail } from '../../../hooks/useTripQueries';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { Modal, useConfirm } from '../../../components/UI';
import { TextField, UuiSelectField } from '../../../design-system';
import { USearchableField } from '../../shipments/create/uui-fields';

interface TripReassignDialogProps {
  /** Trip to reassign, or null to keep the dialog closed. */
  tripId: number | null;
  onClose: () => void;
  /** Called after a successful reassign so the caller can refetch its list. */
  onReassigned: () => void;
}

/**
 * Governed vehicle/driver reassignment for an already-issued trip, rendered
 * as an overlay on whichever page opens it (dispatch detail-plan grid, etc.)
 * — it fetches its own trip/truck/driver data by id instead of relying on
 * being mounted inside /trips/:id, so opening it never navigates away from
 * the caller's page.
 */
export function TripReassignDialog({ tripId, onClose, onReassigned }: TripReassignDialogProps) {
  const queryClient = useQueryClient();
  // Card 061026172804 warn-once contract (FB-038 / ticket 101026043000): a
  // completed-trip overlap refuses once and the confirmed retry proceeds —
  // the same confirm presentation DispatchPlanEditorCell uses for this code.
  const { confirm, dialog: overlapConfirmDialog } = useConfirm();
  const { data: trip, isLoading: loadingTrip, error: tripError, refetch: refetchTrip } = useTripDetail(tripId != null ? String(tripId) : undefined);
  const { data: trucksDriversData } = useTrucksAndDrivers({ enabled: tripId != null });
  const { data: catalogData } = useCatalogs();
  const trucks = trucksDriversData?.trucks ?? [];
  const drivers = trucksDriversData?.drivers ?? [];
  const carrierCustomers = catalogData?.externalCarriers?.map((c) => ({ id: c.id, label: c.name })) ?? [];

  const [carrierType, setCarrierType] = useState<'OWN' | 'EXTERNAL'>('OWN');
  const [truckId, setTruckId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [externalCarrierId, setExternalCarrierId] = useState('');
  const [externalPlateNumber, setExternalPlateNumber] = useState('');
  // Round 19 (Đổi nhà xe + biển): the plate field is a picker fed by the
  // SELECTED carrier's fleet — picking a listed plate resolves its vehicle
  // id so the governed write re-links carrier_fleet_vehicles; an unlisted
  // plate stays free text (id null, plate text rides).
  const [carrierVehicles, setCarrierVehicles] = useState<DispatchCarrierVehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclesError, setVehiclesError] = useState(false);
  const [vehiclesRetryNonce, setVehiclesRetryNonce] = useState(0);
  const [externalDriverName, setExternalDriverName] = useState('');
  const [externalDriverPhone, setExternalDriverPhone] = useState('');
  // Card 20261006_389 — per-trip trailer override; '' = the (selected)
  // tractor's current coupling, resolved server-side exactly as before.
  const [trailerOverride, setTrailerOverride] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Seed the draft once per trip version — a background refetch that comes
  // back unchanged must not clobber in-progress edits, but a version bump
  // (the trip was reassigned elsewhere, or by a previous open of this very
  // dialog) must reseed; otherwise reopening right after a reassign shows
  // the stale pre-reassign snapshot react-query serves from cache while it
  // refetches.
  const initializedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (tripId == null) {
      initializedForRef.current = null;
      return;
    }
    if (!trip || trip.id !== tripId) return;
    const seedKey = `${tripId}:${trip.version}`;
    if (initializedForRef.current === seedKey) return;
    initializedForRef.current = seedKey;
    setCarrierType(trip.carrierType || 'OWN');
    setTruckId(String(trip.truckId ?? ''));
    setDriverId(String(trip.driverId ?? ''));
    setExternalCarrierId(String(trip.externalCarrierId ?? ''));
    setExternalPlateNumber(trip.externalPlateNumber ?? '');
    setExternalDriverName(trip.externalDriverName ?? '');
    setExternalDriverPhone(trip.externalDriverPhone ?? '');
    setTrailerOverride('');
    setReason('');
    setError('');
  }, [trip, tripId]);

  // Acceptance mode (card 091026190520, FB-081 option b) — mirrors the
  // server guard: an IN_TRANSIT trip whose driver acknowledged
  // (ORDER_RECEIVED) may only be corrected on the VEHICLE side (truck/trailer
  // for OWN, carrier/plate for EXTERNAL); the driver keeps the job they
  // accepted. CREATED trips stay fully reassignable (pre-acceptance right).
  const lockedByAcceptance = trip?.status === 'IN_TRANSIT' && trip?.driverAccepted === true;

  // Load the selected external carrier's vehicles for the plate picker. The
  // dialog's own carrier list is catalog-based; the fleet list is per
  // carrier, so it refreshes whenever the dispatcher picks a different
  // nhà xe (round 19).
  const selectedExternalCarrierId = carrierType === 'EXTERNAL' && externalCarrierId && /^\d+$/.test(externalCarrierId)
    ? Number(externalCarrierId)
    : null;
  useEffect(() => {
    if (tripId == null || selectedExternalCarrierId == null) {
      setCarrierVehicles([]);
      setVehiclesError(false);
      return undefined;
    }
    let cancelled = false;
    setVehiclesLoading(true);
    // First page only (50 plates, round-19 scope): a carrier with a longer
    // fleet falls back to free-text for unlisted plates — acceptable today,
    // and the fixed-catalog card owns proper pagination if fleets grow.
    listDispatchFleetResources('EXTERNAL_VEHICLE', { carrierId: selectedExternalCarrierId, limit: 50 })
      .then((response) => {
        if (cancelled) return;
        setCarrierVehicles(response.items as DispatchCarrierVehicle[]);
        setVehiclesError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setCarrierVehicles([]);
        setVehiclesError(true);
      })
      .finally(() => { if (!cancelled) setVehiclesLoading(false); });
    return () => { cancelled = true; };
  }, [tripId, selectedExternalCarrierId, vehiclesRetryNonce]);

  const matchedVehicle = selectedExternalCarrierId != null && externalPlateNumber.trim()
    ? carrierVehicles.find((vehicle) => vehicle.licensePlate.localeCompare(externalPlateNumber.trim(), 'vi', { sensitivity: 'base' }) === 0) ?? null
    : null;

  async function handleSave(extra: { rigOverlapCompletedConfirmed?: boolean } = {}) {
    if (!trip || tripId == null || saving) return;
    if (carrierType === 'OWN') {
      if (!truckId || !driverId) {
        setError('Vui lòng chọn xe và lái xe');
        return;
      }
    } else if (!externalCarrierId && !externalPlateNumber) {
      setError('Vui lòng chọn đối tác hoặc nhập biển số');
      return;
    }
    if (!reason.trim()) {
      setError('Lý do điều chuyển là bắt buộc');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const freshTrip = await tripClient.reassignTrip(tripId, {
        carrierType,
        truckId: truckId ? Number(truckId) : null,
        driverId: driverId ? Number(driverId) : null,
        // Card 20261006_389 — the override rides only when picked; omitted
        // otherwise so the backend resolves the tractor's coupling as before.
        ...(carrierType === 'OWN' && trailerOverride ? { trailerId: Number(trailerOverride) } : {}),
        externalCarrierId: externalCarrierId ? Number(externalCarrierId) : null,
        // Round 19: a listed plate carries its carrier_fleet_vehicles id so
        // the governed write re-links the new carrier's vehicle; a free-text
        // plate ships null and the typed text rides (the route no longer
        // forces the previously-issued vehicle over either).
        externalCarrierVehicleId: carrierType === 'EXTERNAL' ? matchedVehicle?.id ?? null : null,
        externalPlateNumber,
        externalDriverName,
        externalDriverPhone,
        reason: reason.trim(),
        expectedVersion: trip.version,
        rigOverlapCompletedConfirmed: extra.rigOverlapCompletedConfirmed === true,
      });
      // Prime the trip-detail cache with the reassign response: with the
      // default 5-minute staleTime, reopening this dialog would otherwise
      // seed from the stale pre-reassign snapshot until a full reload. The
      // fresh entry seeds the saved defaults immediately; the invalidation
      // converges any other mounted trip-detail observer.
      queryClient.setQueryData(qk.trips.detail(String(tripId)), freshTrip);
      void queryClient.invalidateQueries({ queryKey: qk.trips.detail(String(tripId)) });
      onReassigned();
      onClose();
    } catch (reassignError) {
      const err = reassignError as { status?: number; message?: string; raw?: { code?: string } };
      const message = err?.message || 'Lỗi khi phân xe lại';
      // Card 061026172804 (FB-038 / ticket 101026043000): a completed-trip
      // overlap refuses once so the dispatcher confirms before the save
      // proceeds (chạy gối đầu lên chuyến đã xong is legal). Declining keeps
      // this dialog open with the explanation inline. Without this branch the
      // warn became a dead-end block with no way on.
      if (err?.status === 409 && err?.raw?.code === 'RIG_OVERLAP_COMPLETED') {
        const proceed = await confirm(message);
        if (proceed) {
          setSaving(false);
          await handleSave({ rigOverlapCompletedConfirmed: true });
          return;
        }
      }
      setError(message);
      // A late conflict usually means the driver accepted while the dialog
      // was open — refetch so the fresh acceptance flips this dialog into
      // the read-only lock instead of inviting a futile retry.
      void refetchTrip();
    } finally {
      setSaving(false);
    }
  }

  const confirmDisabled = saving || !trip
    || (carrierType === 'OWN' ? !truckId : (!externalCarrierId && !externalPlateNumber));

  // Sweep (card 20261008_1): both footer buttons used to disable silently —
  // each disable cause now carries its own aria-described reason
  // (DisabledActionTip) instead of a bare `disabled`. The acceptance-locked
  // trip is NOT a disabled-control case: the confirm control is removed and
  // the body explains the lock (kept as-is).
  const cancelDisabledReason = saving ? 'Đang lưu phân xe lại — chưa hủy được.' : null;
  const confirmDisabledReason = saving
    ? 'Đang lưu phân xe lại…'
    : !trip
      ? 'Chưa tải được thông tin chuyến.'
      : carrierType === 'OWN'
        ? (!truckId ? 'Chọn xe đầu kéo để xác nhận.' : null)
        : (!externalCarrierId && !externalPlateNumber ? 'Chọn đối tác hoặc nhập biển số xe.' : null);

  return (
    <>
      <Modal
      isOpen={tripId != null}
      title="Phân xe lại"
      onClose={onClose}
      onConfirm={handleSave}
      maxWidth={440}
      footer={(
        <>
          <DisabledActionTip id="trip-reassign-cancel" reason={cancelDisabledReason}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => { if (saving) return; onClose(); }}
              aria-disabled={saving || undefined}
            >
              <X size={14} aria-hidden="true" /> Hủy
            </button>
          </DisabledActionTip>
          {(
            <DisabledActionTip id="trip-reassign-confirm" reason={confirmDisabledReason}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => { if (confirmDisabledReason) return; void handleSave(); }}
                aria-disabled={confirmDisabled || undefined}
              >
                {saving ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Shuffle size={14} aria-hidden="true" />}
                Xác nhận phân xe lại
              </button>
            </DisabledActionTip>
          )}
        </>
      )}
    >
      {/* A failed trip fetch must never render as an eternal "Đang tải…":
          the 2026-09-10 staging QA block was exactly that (fetch error +
          no error branch). Show the spinner only while actually loading. */}
      {loadingTrip || (!trip && !tripError) ? (
        <p>Đang tải…</p>
      ) : !trip ? (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="dispatch-assignment-dialog__error" style={{ margin: 0 }}>
            Không tải được chuyến đi. Vui lòng thử lại.
          </p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void refetchTrip()}>
            Thử lại
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {lockedByAcceptance && (
            <p className="dispatch-assignment-dialog__error" role="status">
              Lái xe đã nhận việc — chỉ được đổi xe (xe đầu kéo/moóc, hoặc nhà xe/biển số với xe ngoài), giữ nguyên lái xe
              {' '}({trip.carrierType === 'EXTERNAL' ? `${trip.externalPlateNumber || '—'} · ${trip.externalDriverName || '—'}` : `${trip.truck?.licensePlate || '—'} · ${trip.driver?.name || '—'}`}).
            </p>
          )}
          {error && <p className="dispatch-assignment-dialog__error" role="alert">{error}</p>}
          <UuiSelectField
            label="Loại xe"
            value={carrierType}
            onChange={(event) => setCarrierType(event.target.value as 'OWN' | 'EXTERNAL')}
            options={[
              { value: 'OWN', label: 'Xe nhà' },
              { value: 'EXTERNAL', label: 'Xe ngoài' },
            ]}
            disabled={saving || lockedByAcceptance}
            wrapperClassName="field"
          />
          {carrierType === 'OWN' ? (
            <>
              <UuiSelectField
                label="Xe đầu kéo"
                value={truckId}
                onChange={(event) => setTruckId(event.target.value)}
                disabled={saving}
                options={[{ value: '', label: '-- Chọn xe --' }, ...trucks.map((t) => ({ value: String(t.id), label: t.licensePlate }))]}
                wrapperClassName="field"
              />
              <UuiSelectField
                label="Lái xe"
                value={driverId}
                onChange={(event) => setDriverId(event.target.value)}
                disabled={saving || lockedByAcceptance}
                options={[{ value: '', label: '-- Chọn lái xe --' }, ...drivers.map((d) => ({ value: String(d.id), label: d.name }))]}
                wrapperClassName="field"
              />
              {/* Card 20261006_389 — the tractor's coupling is the default
                  trailer; the override names both plates when it differs. */}
              {(() => {
                const selectedTruck = trucks.find((t) => String(t.id) === truckId) ?? null;
                const couplingId = selectedTruck?.currentTrailerId ?? null;
                const catalogTrailers = catalogData?.trailers ?? [];
                const activeTrailers = catalogTrailers.filter((t) => t.status === 'ACTIVE');
                const coupling = couplingId != null
                  ? {
                    id: couplingId,
                    plate: catalogTrailers.find((t) => t.id === couplingId)?.licensePlate ?? 'chưa rõ biển số',
                    type: catalogTrailers.find((t) => t.id === couplingId)?.type ?? selectedTruck?.trailerType ?? null,
                  }
                  : null;
                const overridePlate = trailerOverride
                  ? catalogTrailers.find((t) => t.id === Number(trailerOverride))?.licensePlate ?? 'moóc đã chọn'
                  : null;
                return (
                  <>
                    <p style={{ margin: 0, fontSize: 'var(--text-data-size)', color: 'var(--ink-3)' }}>
                      Moóc đang ghép: {coupling
                        ? `${coupling.plate}${coupling.type ? ` · ${coupling.type}` : ''}`
                        : 'chưa ghép moóc — chọn moóc bên dưới'}
                    </p>
                    <UuiSelectField
                      label="Moóc cho chuyến (ghi đè)"
                      value={trailerOverride}
                      onChange={(event) => setTrailerOverride(event.target.value)}
                      disabled={saving}
                      options={[
                        { value: '', label: coupling
                          ? `Dùng moóc đang ghép (${coupling.plate})`
                          : '— Chọn moóc —' },
                        ...activeTrailers.map((t) => ({
                          value: String(t.id),
                          label: `${t.licensePlate}${t.type ? ` · ${t.type}` : ''}`,
                        })),
                        ...(coupling && !activeTrailers.some((t) => t.id === coupling.id)
                          ? [{ value: String(coupling.id), label: `${coupling.plate} (moóc đang ghép)` }]
                          : []),
                      ]}
                      wrapperClassName="field"
                    />
                    {overridePlate && coupling && Number(trailerOverride) !== coupling.id && (
                      <p style={{ margin: 0, fontSize: 'var(--text-data-size)', color: 'var(--ink-3)' }}>
                        Ghi đè moóc: {overridePlate} thay cho moóc đang ghép {coupling.plate}.
                      </p>
                    )}
                  </>
                );
              })()}
            </>
          ) : (
            <>
              <UuiSelectField
                label="Đối tác xe ngoài"
                value={externalCarrierId}
                onChange={(event) => {
                  // A different nhà xe means a different fleet: drop the old
                  // plate so the picker reloads and cannot silently carry the
                  // previous carrier's vehicle (round 19).
                  if (event.target.value !== externalCarrierId) setExternalPlateNumber('');
                  setExternalCarrierId(event.target.value);
                }}
                disabled={saving}
                options={[{ value: '', label: '-- Chọn đối tác --' }, ...carrierCustomers.map((c) => ({ value: String(c.id), label: c.label }))]}
                wrapperClassName="field"
              />
              {/* Round 19: the plate is a SELECTOR over the selected carrier's
                  fleet (mirroring the detail-plan editor's plate picker),
                  with free text for a plate the catalog does not carry. */}
              <USearchableField
                id="trip-reassign-external-plate"
                label="Biển số xe"
                value={externalPlateNumber}
                onChange={(plate) => setExternalPlateNumber(plate.toUpperCase().slice(0, 20))}
                onCustomValue={(text) => setExternalPlateNumber(text.toUpperCase().slice(0, 20))}
                options={carrierVehicles.map((vehicle) => ({ value: vehicle.licensePlate, label: vehicle.licensePlate }))}
                placeholder={vehiclesLoading ? 'Đang tải biển số…' : 'Chọn hoặc nhập biển số'}
                disabled={saving}
                searchable
                allowsCustomValue
              />
              {matchedVehicle && (
                <p style={{ margin: 0, fontSize: 'var(--text-data-size)', color: 'var(--ink-3)' }}>
                  Xe đã đăng ký của nhà xe ({matchedVehicle.licensePlate}) — sẽ gán lại đúng xe trong danh mục.
                </p>
              )}
              {vehiclesError && (
                <p style={{ margin: 0, fontSize: 'var(--text-data-size)', color: 'var(--danger, #b3261e)' }} role="status">
                  Không tải được danh sách biển số của nhà xe.{' '}
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setVehiclesRetryNonce((nonce) => nonce + 1)}>Thử lại</button>
                  {' '}Vẫn nhập được biển số trực tiếp.
                </p>
              )}
              <TextField
                label="Tên lái xe"
                placeholder="Tên lái xe ngoài"
                value={externalDriverName}
                onChange={(event) => setExternalDriverName(event.target.value)}
                disabled={saving || lockedByAcceptance}
              />
              <TextField
                label="SĐT lái xe"
                type="tel"
                autoComplete="tel"
                placeholder="SĐT lái xe"
                value={externalDriverPhone}
                onChange={(event) => setExternalDriverPhone(event.target.value)}
                disabled={saving || lockedByAcceptance}
              />
            </>
          )}
          <TextField
            label="Lý do điều chuyển *"
            placeholder="Bắt buộc — ghi vào nhật ký nghiệp vụ cùng người thực hiện và thời gian"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={saving}
          />
        </div>
      )}
      </Modal>
      {overlapConfirmDialog}
    </>
  );
}
