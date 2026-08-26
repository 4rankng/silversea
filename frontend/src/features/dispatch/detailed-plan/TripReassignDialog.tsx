import { useEffect, useRef, useState } from 'react';
import { Loader2, Shuffle, X } from 'lucide-react';
import { tripClient } from '../../../api/tripClient';
import { useCatalogs } from '../../../hooks/useCatalogs';
import { useTrucksAndDrivers } from '../../../hooks/useCatalogQueries';
import { useTripDetail } from '../../../hooks/useTripQueries';
import { Modal } from '../../../components/UI';
import { TextField, UuiSelectField } from '../../../design-system';

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
  const { data: trip, isLoading: loadingTrip } = useTripDetail(tripId != null ? String(tripId) : undefined);
  const { data: trucksDriversData } = useTrucksAndDrivers({ enabled: tripId != null });
  const { data: catalogData } = useCatalogs();
  const trucks = trucksDriversData?.trucks ?? [];
  const drivers = trucksDriversData?.drivers ?? [];
  const carrierCustomers = catalogData?.customers.filter((c) => c.isCarrier).map((c) => ({ id: c.id, label: c.name })) ?? [];

  const [carrierType, setCarrierType] = useState<'OWN' | 'EXTERNAL'>('OWN');
  const [truckId, setTruckId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [externalCarrierId, setExternalCarrierId] = useState('');
  const [externalPlateNumber, setExternalPlateNumber] = useState('');
  const [externalDriverName, setExternalDriverName] = useState('');
  const [externalDriverPhone, setExternalDriverPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Seed the draft once per open trip — a background refetch of the trip
  // while the dialog is open must not clobber in-progress edits.
  const initializedForRef = useRef<number | null>(null);
  useEffect(() => {
    if (tripId == null) {
      initializedForRef.current = null;
      return;
    }
    if (!trip || trip.id !== tripId || initializedForRef.current === tripId) return;
    initializedForRef.current = tripId;
    setCarrierType(trip.carrierType || 'OWN');
    setTruckId(String(trip.truckId ?? ''));
    setDriverId(String(trip.driverId ?? ''));
    setExternalCarrierId(String(trip.externalCarrierId ?? ''));
    setExternalPlateNumber(trip.externalPlateNumber ?? '');
    setExternalDriverName(trip.externalDriverName ?? '');
    setExternalDriverPhone(trip.externalDriverPhone ?? '');
    setError('');
  }, [trip, tripId]);

  async function handleSave() {
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
    setSaving(true);
    setError('');
    try {
      await tripClient.reassignTrip(tripId, {
        carrierType,
        truckId: truckId ? Number(truckId) : null,
        driverId: driverId ? Number(driverId) : null,
        externalCarrierId: externalCarrierId ? Number(externalCarrierId) : null,
        externalPlateNumber,
        externalDriverName,
        externalDriverPhone,
        expectedVersion: trip.version,
      });
      onReassigned();
      onClose();
    } catch (reassignError) {
      setError(reassignError instanceof Error && reassignError.message ? reassignError.message : 'Lỗi khi phân xe lại');
    } finally {
      setSaving(false);
    }
  }

  const confirmDisabled = saving || !trip
    || (carrierType === 'OWN' ? (!truckId || !driverId) : (!externalCarrierId && !externalPlateNumber));

  return (
    <Modal
      isOpen={tripId != null}
      title="Phân xe lại"
      onClose={onClose}
      onConfirm={handleSave}
      maxWidth={440}
      footer={(
        <>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={saving}>
            <X size={14} aria-hidden="true" /> Hủy
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void handleSave()} disabled={confirmDisabled}>
            {saving ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Shuffle size={14} aria-hidden="true" />}
            Xác nhận phân xe lại
          </button>
        </>
      )}
    >
      {loadingTrip || !trip ? (
        <p>Đang tải…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <p className="dispatch-assignment-dialog__error" role="alert">{error}</p>}
          <UuiSelectField
            label="Loại xe"
            value={carrierType}
            onChange={(event) => setCarrierType(event.target.value as 'OWN' | 'EXTERNAL')}
            options={[
              { value: 'OWN', label: 'Xe nhà' },
              { value: 'EXTERNAL', label: 'Xe ngoài' },
            ]}
            disabled={saving}
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
                disabled={saving}
                options={[{ value: '', label: '-- Chọn lái xe --' }, ...drivers.map((d) => ({ value: String(d.id), label: d.name }))]}
                wrapperClassName="field"
              />
            </>
          ) : (
            <>
              <UuiSelectField
                label="Đối tác xe ngoài"
                value={externalCarrierId}
                onChange={(event) => setExternalCarrierId(event.target.value)}
                disabled={saving}
                options={[{ value: '', label: '-- Chọn đối tác --' }, ...carrierCustomers.map((c) => ({ value: String(c.id), label: c.label }))]}
                wrapperClassName="field"
              />
              <TextField
                label="Biển số xe"
                placeholder="Ví dụ: 15C-12345"
                value={externalPlateNumber}
                onChange={(event) => setExternalPlateNumber(event.target.value)}
                disabled={saving}
              />
              <TextField
                label="Tên lái xe"
                placeholder="Tên lái xe ngoài"
                value={externalDriverName}
                onChange={(event) => setExternalDriverName(event.target.value)}
                disabled={saving}
              />
              <TextField
                label="SĐT lái xe"
                type="tel"
                autoComplete="tel"
                placeholder="SĐT lái xe"
                value={externalDriverPhone}
                onChange={(event) => setExternalDriverPhone(event.target.value)}
                disabled={saving}
              />
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
