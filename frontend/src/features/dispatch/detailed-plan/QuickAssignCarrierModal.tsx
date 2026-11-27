import { useEffect, useState } from 'react';
import { Modal, Btn } from '../../../components/UI';
import { SearchableSelect } from '../../../design-system';
import {
  listDispatchFleetResources,
  type DispatchDetailPlanRow,
} from '../../../api/dispatchPlanningClient';

const OWN_VALUE = 'OWN';
const EXTERNAL_PREFIX = 'EXT:';

export interface QuickAssignCarrierPayload {
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  /** OWN only — a fleet truck id; null assigns the fleet identity alone ('Chờ chọn xe'). */
  truckId: number | null;
  /** EXTERNAL only — free-text plate; OWN plates must ride a fleet truck (BE law). */
  plateNumber: string | null;
}

/**
 * HOT-04 (CR-011.2) — In-place quick carrier assignment modal for 1..N selected
 * rows on /dispatch-detail. Uses the same carrier catalog as /dispatch (own
 * fleet SilverSea + external carriers including KHÁCH TỰ VC) and optional plate;
 * saving writes to shipment_fulfillments so /dispatch allocations stay 100% in sync.
 *
 * OWN law (backend resolveDispatchVehicleAssignment): a plate for the own fleet
 * must come from the company truck list (truckId) — a free-text plate 400s. The
 * truck select is therefore the only plate affordance for SilverSea, and leaving
 * it empty saves the carrier-only allocation ('SilverSea' + 'Chờ chọn xe').
 */
export function QuickAssignCarrierModal({
  open,
  rows,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  rows: DispatchDetailPlanRow[];
  saving: boolean;
  onClose: () => void;
  onConfirm: (payload: QuickAssignCarrierPayload) => Promise<void>;
}) {
  const [carrierValue, setCarrierValue] = useState('');
  const [truckValue, setTruckValue] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [carrierOptions, setCarrierOptions] = useState<Array<{ value: string; label: string }>>([
    { value: OWN_VALUE, label: 'SilverSea (Xe nhà)' },
  ]);
  const [truckOptions, setTruckOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loadingCarriers, setLoadingCarriers] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCarrierValue('');
    setTruckValue('');
    setPlateNumber('');
    setError(null);
    setCatalogError(null);
    let active = true;
    setLoadingCarriers(true);
    let settled = 0;
    const done = () => { settled += 1; if (active && settled === 2) setLoadingCarriers(false); };
    listDispatchFleetResources('EXTERNAL_CARRIER', { limit: 100 })
      .then((res) => {
        if (!active) return;
        setCarrierOptions([
          { value: OWN_VALUE, label: 'SilverSea (Xe nhà)' },
          ...res.items.map((c) => ({ value: `${EXTERNAL_PREFIX}${c.id}`, label: c.name })),
        ]);
        done();
      })
      .catch(() => {
        if (!active) return;
        setCarrierOptions([{ value: OWN_VALUE, label: 'SilverSea (Xe nhà)' }]);
        setCatalogError('Không tải được danh mục nhà thầu ngoài — chỉ gán được Xe nhà. Đóng rồi mở lại để thử lần nữa.');
        done();
      });
    listDispatchFleetResources('TRUCK', { limit: 200 })
      .then((res) => {
        if (!active) return;
        setTruckOptions(res.items.map((t) => ({ value: String(t.id), label: t.licensePlate })));
        done();
      })
      .catch(() => {
        if (!active) return;
        setCatalogError((prev) => prev ?? 'Không tải được đội xe công ty — gán SilverSea không chọn biển (bổ sung biển sau) vẫn lưu được.');
        done();
      });
    return () => { active = false; };
  }, [open]);

  async function handleSubmit() {
    if (saving) return;
    if (!carrierValue) {
      setError('Vui lòng chọn nhà xe trước khi lưu.');
      return;
    }
    const isOwn = carrierValue === OWN_VALUE;
    const externalCarrierId = isOwn ? null : Number(carrierValue.slice(EXTERNAL_PREFIX.length));
    if (!isOwn && (!Number.isInteger(externalCarrierId) || (externalCarrierId ?? 0) <= 0)) {
      setError('Nhà xe đã chọn không hợp lệ.');
      return;
    }
    if (isOwn && truckValue && !truckOptions.some((t) => t.value === truckValue)) {
      setError('Biển số xe phải chọn từ đội xe công ty.');
      return;
    }
    setError(null);
    await onConfirm({
      carrierType: isOwn ? 'OWN' : 'EXTERNAL',
      externalCarrierId,
      truckId: isOwn && truckValue ? Number(truckValue) : null,
      plateNumber: !isOwn && plateNumber.trim() ? plateNumber.trim().toUpperCase() : null,
    });
  }

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`Gán nhà xe nhanh (${rows.length} dòng)`}
      footer={(
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={saving}>Hủy</Btn>
          <Btn variant="primary" size="sm" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Lưu gán xe'}
          </Btn>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <span>Nhà xe <span style={{ color: 'var(--danger)' }}>*</span></span>
          <SearchableSelect
            id="quick-assign-carrier"
            value={carrierValue}
            onChange={setCarrierValue}
            options={carrierOptions}
            placeholder={loadingCarriers ? 'Đang tải nhà xe…' : 'Chọn SilverSea hoặc nhà thầu ngoài'}
            searchPlaceholder="Tìm nhà xe…"
            disabled={saving}
            size="sm"
          />
        </div>
        {carrierValue === OWN_VALUE ? (
          <div style={{ display: 'grid', gap: 4 }}>
            <span>Biển số xe — đội xe công ty (tùy chọn)</span>
            <SearchableSelect
              id="quick-assign-truck"
              value={truckValue}
              onChange={setTruckValue}
              options={truckOptions}
              placeholder={truckOptions.length > 0 ? 'Để trống nếu chỉ gán SilverSea trước (Chờ chọn xe)' : 'Đang tải đội xe…'}
              searchPlaceholder="Tìm biển số…"
              disabled={saving}
              size="sm"
            />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            <span>Biển số xe (tùy chọn)</span>
            <input
              className="input"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              placeholder="Để trống nếu chỉ gán nhà xe trước"
              maxLength={20}
              disabled={saving}
            />
          </div>
        )}
        {catalogError && <p style={{ color: 'var(--warning, var(--fg-muted))', margin: 0, fontSize: 'var(--text-caption-size)' }}>{catalogError}</p>}
        {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0, fontSize: 'var(--text-caption-size)' }}>{error}</p>}
      </div>
    </Modal>
  );
}
