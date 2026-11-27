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
  /** SIL-1158 (HOT-04 §2b, KB K4.72) — OWN only — a fleet driver id picked
   *  from the roster of the carrier being assigned; BKS + tài xế travel
   *  together (a driver pick requires a truck), null = leave the truck's
   *  roster pairing as-is. */
  driverId: number | null;
  /** SIL-1158 — EXTERNAL only — free-text driver contact, null = untouched. */
  externalDriverName: string | null;
  externalDriverPhone: string | null;
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
  // SIL-1158 — 'Tài xế (tùy chọn)': OWN picks from the assigned carrier's
  // roster, EXTERNAL types name + phone (SIL-1138 contact fields).
  const [driverValue, setDriverValue] = useState('');
  const [externalDriverName, setExternalDriverName] = useState('');
  const [externalDriverPhone, setExternalDriverPhone] = useState('');
  const [carrierOptions, setCarrierOptions] = useState<Array<{ value: string; label: string }>>([
    { value: OWN_VALUE, label: 'SilverSea (Xe nhà)' },
  ]);
  const [truckOptions, setTruckOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [driverOptions, setDriverOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loadingCarriers, setLoadingCarriers] = useState(false);
  const [driverLoaded, setDriverLoaded] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCarrierValue('');
    setTruckValue('');
    setPlateNumber('');
    setDriverValue('');
    setExternalDriverName('');
    setExternalDriverPhone('');
    setDriverLoaded(false);
    setError(null);
    setCatalogError(null);
    let active = true;
    setLoadingCarriers(true);
    let settled = 0;
    const done = () => { settled += 1; if (active && settled === 3) setLoadingCarriers(false); };
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
    // SIL-1158 — the roster of the carrier being assigned ('tài xế của nhà xe
    // đang gán'). Optional field: a quiet failure leaves the select empty
    // instead of spinning ('driverLoaded' flips the placeholder either way).
    listDispatchFleetResources('DRIVER', { limit: 100 })
      .then((res) => {
        if (!active) return;
        setDriverOptions(res.items.map((d) => ({ value: String(d.id), label: d.name })));
        setDriverLoaded(true);
        done();
      })
      .catch(() => {
        if (!active) return;
        setDriverLoaded(true);
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
    // SIL-1158 — BKS + tài xế đi cùng nhau (HOT-04 §2b 'chọn luôn BKS + tài
    // xế'): a roster driver pick without a truck has nothing to bind to.
    if (isOwn && driverValue && !truckValue) {
      setError('Chọn biển số xe để gán tài xế.');
      return;
    }
    setError(null);
    await onConfirm({
      carrierType: isOwn ? 'OWN' : 'EXTERNAL',
      externalCarrierId,
      truckId: isOwn && truckValue ? Number(truckValue) : null,
      plateNumber: !isOwn && plateNumber.trim() ? plateNumber.trim().toUpperCase() : null,
      driverId: isOwn && driverValue ? Number(driverValue) : null,
      externalDriverName: !isOwn && externalDriverName.trim() ? externalDriverName.trim() : null,
      externalDriverPhone: !isOwn && externalDriverPhone.trim() ? externalDriverPhone.trim() : null,
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
          <>
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
            {/* SIL-1158 (HOT-04 §2b, KB K4.72) — 'Tài xế (tùy chọn)': chọn từ
                tài xế của nhà xe đang gán (roster đội xe công ty); BKS + tài xế
                đi cùng nhau nên chọn tài xế là chọn kèm biển số. */}
            <div style={{ display: 'grid', gap: 4 }}>
              <span>Tài xế (tùy chọn)</span>
              <SearchableSelect
                id="quick-assign-driver"
                value={driverValue}
                onChange={setDriverValue}
                options={driverOptions}
                placeholder={driverLoaded ? 'Chọn tài xế của đội xe công ty' : 'Đang tải danh sách tài xế…'}
                searchPlaceholder="Tìm tài xế…"
                disabled={saving}
                size="sm"
              />
            </div>
          </>
        ) : (
          <>
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
            {/* SIL-1158 — xe ngoài: nhập tên + SĐT tài xế (liên hệ SIL-1138),
                lưu cùng payload gán xe. */}
            <div style={{ display: 'grid', gap: 4 }}>
              <span>Tên tài xế (tùy chọn)</span>
              <input
                className="input"
                value={externalDriverName}
                onChange={(e) => setExternalDriverName(e.target.value)}
                placeholder="Nhập tên tài xế"
                maxLength={100}
                disabled={saving}
              />
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              <span>SĐT tài xế (tùy chọn)</span>
              <input
                className="input"
                type="tel"
                value={externalDriverPhone}
                onChange={(e) => setExternalDriverPhone(e.target.value)}
                placeholder="Ví dụ: 0912345678"
                maxLength={20}
                disabled={saving}
              />
            </div>
          </>
        )}
        {catalogError && <p style={{ color: 'var(--warning, var(--fg-muted))', margin: 0, fontSize: 'var(--text-caption-size)' }}>{catalogError}</p>}
        {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0, fontSize: 'var(--text-caption-size)' }}>{error}</p>}
      </div>
    </Modal>
  );
}
