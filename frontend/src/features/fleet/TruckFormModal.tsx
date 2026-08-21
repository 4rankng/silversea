import { useState, useEffect } from 'react';
import { Save, X, Loader2 } from 'lucide-react';
import { Modal } from '../../components/UI';
import { DateInput } from '../../design-system/forms/DateInput';
import { TrailerType, TRAILER_TYPE_LABELS, computeVehicleAlerts } from '@tingting/shared';
import type { Truck as TruckType, VehicleAlert } from '@tingting/shared';
import { TRUCK_STATUS } from './constants';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';

/**
 * TruckForm rendered inside a Modal — the previous tr-based inline edit row
 * was visually cramped and easy to miss when toggled. Modal gives the form
 * proper breathing room, focused labels, and an obvious save/cancel footer.
 *
 * N5 / A12: includes three user-keyed compliance/service date fields
 * (inspection / insurance / oil). Each shows a live alert badge derived from
 * computeVehicleAlerts — red (overdue) or amber (due within 30 days).
 */
export function TruckFormModal({ saving, item, trailers, onsave, oncancel, isOpen }: {
  saving: boolean;
  item?: TruckType;
  trailers: Array<{ id: number; licensePlate: string; type: string }>;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  isOpen: boolean;
}) {
  const [plate, setPlate] = useState(item?.licensePlate || '');
  const [currentTrailerId, setCurrentTrailerId] = useState<number | null>(item?.currentTrailerId ?? null);
  const [status, setStatus] = useState(item?.status || 'ACTIVE');
  // N5: date fields kept as '' when empty so <input type="date"> is controlled.
  const [nextInspectionDate, setNextInspectionDate] = useState(item?.nextInspectionDate ?? '');
  const [insuranceExpiryDate, setInsuranceExpiryDate] = useState(item?.insuranceExpiryDate ?? '');
  const [lastOilServiceDate, setLastOilServiceDate] = useState(item?.lastOilServiceDate ?? '');
  // Oil helper inputs (NOT persisted): last change date + interval months. When
  // both are set they compute a next-due that overwrites lastOilServiceDate.
  // Managers can also ignore these and type next-due directly.
  const [lastOilChangeDate, setLastOilChangeDate] = useState('');
  const [oilIntervalMonths, setOilIntervalMonths] = useState(0);
  useEffect(() => {
    if (isOpen) {
      setPlate(item?.licensePlate || '');
      setCurrentTrailerId(item?.currentTrailerId ?? null);
      setStatus(item?.status || 'ACTIVE');
      setNextInspectionDate(item?.nextInspectionDate ?? '');
      setInsuranceExpiryDate(item?.insuranceExpiryDate ?? '');
      setLastOilServiceDate(item?.lastOilServiceDate ?? '');
      // Clear the oil helper so a stale computed value doesn't carry over.
      setLastOilChangeDate('');
      setOilIntervalMonths(0);
    }
    // Reset form fields only when the modal opens or switches item; field-level
    // deps intentionally omitted to avoid clobbering in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id]);

  // Live alert badges for the in-form values (fall back to the persisted item
  // when the field hasn't been touched yet, so opening the modal still shows
  // the current alert state).
  const alerts = computeVehicleAlerts({
    nextInspectionDate: (nextInspectionDate || item?.nextInspectionDate) ?? null,
    insuranceExpiryDate: (insuranceExpiryDate || item?.insuranceExpiryDate) ?? null,
    lastOilServiceDate: (lastOilServiceDate || item?.lastOilServiceDate) ?? null,
  });
  const alertFor = (field: 'nextInspectionDate' | 'insuranceExpiryDate' | 'lastOilServiceDate') =>
    alerts.find(a => a.field === field);

  const handleSave = () => {
    if (!plate.trim()) return;
    onsave({
      licensePlate: plate.trim(),
      currentTrailerId,
      status,
      // Empty string → null so the backend stores NULL (clears the date)
      // rather than failing the YYYY-MM-DD regex.
      nextInspectionDate: nextInspectionDate || null,
      insuranceExpiryDate: insuranceExpiryDate || null,
      lastOilServiceDate: lastOilServiceDate || null,
    });
  };
  return (
    <Modal
      isOpen={isOpen}
      title={item ? `Sửa xe ${item.licensePlate}` : 'Thêm xe đầu kéo'}
      onClose={oncancel}
      onConfirm={handleSave}
      maxWidth={680}
      footer={
        <div className="fleet-form-actions">
          <button className="btn btn--ghost btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button className="btn btn--primary btn--sm" disabled={saving || !plate.trim()} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm xe'}
          </button>
        </div>
      }
    >
      <div className="fleet-form">
        <section className="fleet-form__section fleet-form__section--identity">
          <div className="fleet-form__section-head">
            <div>
              <h4>Thông tin xe</h4>
              <p>Biển số, rơ-moóc đang ghép và trạng thái vận hành.</p>
            </div>
          </div>
          <div className="fleet-form__grid fleet-form__grid--truck">
            <div className="field fleet-form__field fleet-form__field--wide">
              <label htmlFor="truck-plate">
                Biển số xe đầu kéo <span>*</span>
              </label>
              <input
                id="truck-plate"
                className="input"
                value={plate}
                onChange={e => setPlate(e.target.value)}
                placeholder="Ví dụ: 60C-12345"
                autoFocus
              />
            </div>
            <div className="field fleet-form__field">
              <label htmlFor="trailer-select">Rơ-moóc hiện tại</label>
              <UuiSelectField
                id="trailer-select"
                label="Rơ-moóc hiện tại"
                value={String(currentTrailerId ?? '')}
                onChange={(e) => setCurrentTrailerId(e.target.value ? Number(e.target.value) : null)}
                options={[
                  { value: '', label: '— Không có —' },
                  ...trailers.map((t) => ({
                    value: String(t.id),
                    label: `${t.licensePlate} (${TRAILER_TYPE_LABELS[t.type as TrailerType] || t.type})`,
                  })),
                ]}
                wrapperClassName="input"
              />
            </div>
            <div className="field fleet-form__field">
              <label htmlFor="truck-status">Trạng thái</label>
              <UuiSelectField
                id="truck-status"
                label="Trạng thái"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={Object.entries(TRUCK_STATUS).map(([k, v]) => ({ value: k, label: v }))}
                wrapperClassName="input"
              />
            </div>
          </div>
        </section>

        {/* N5 / A12: compliance & service date reminders. type=date gives a native
            picker; the badge surfaces overdue/due state next to each field. */}
        <section className="fleet-form__section">
          <div className="fleet-form__section-head">
            <div>
              <h4>Mốc nhắc việc</h4>
              <p>Theo dõi đăng kiểm, bảo hiểm và lịch thay dầu.</p>
            </div>
          </div>
          <div className="truck-alert-fields">
            <TruckDateField
              id="truck-inspection"
              label="Hạn đăng kiểm"
              value={nextInspectionDate}
              onChange={setNextInspectionDate}
              alert={alertFor('nextInspectionDate')}
            />
            <TruckDateField
              id="truck-insurance"
              label="Hạn bảo hiểm"
              value={insuranceExpiryDate}
              onChange={setInsuranceExpiryDate}
              alert={alertFor('insuranceExpiryDate')}
            />
            <TruckDateField
              id="truck-oil"
              label="Thay dầu kế tiếp"
              value={lastOilServiceDate}
              onChange={setLastOilServiceDate}
              alert={alertFor('lastOilServiceDate')}
            />
            {/* Oil next-due can also be DERIVED from a last-change date + an
                interval (months). Selecting both writes the computed next-due
                into the field above; nothing extra is persisted. */}
            <div className="field truck-alert-field truck-alert-field--wide">
              <label htmlFor="truck-oil-last" className="truck-alert-field__label">
                Tính từ lần thay dầu gần nhất
              </label>
              <div className="fleet-form__inline">
                <DateInput
                  id="truck-oil-last"
                  className="input"
                  aria-label="Lần thay dầu gần nhất"
                  value={lastOilChangeDate}
                  onChange={(v) => {
                    setLastOilChangeDate(v);
                    if (v && oilIntervalMonths) {
                      const next = addMonthsIso(v, oilIntervalMonths);
                      if (next) setLastOilServiceDate(next);
                    }
                  }}
                />
                <UuiSelectField
                  id="truck-oil-interval"
                  label="Chu kỳ thay dầu (tháng)"
                  aria-label="Chu kỳ thay dầu (tháng)"
                  value={oilIntervalMonths ? String(oilIntervalMonths) : ''}
                  onChange={(e) => {
                    const n = e.target.value ? Number(e.target.value) : 0;
                    setOilIntervalMonths(n);
                    if (lastOilChangeDate && n) {
                      const next = addMonthsIso(lastOilChangeDate, n);
                      if (next) setLastOilServiceDate(next);
                    }
                  }}
                  options={[
                    { value: '', label: 'Chu kỳ…' },
                    { value: '3', label: '3 tháng' },
                    { value: '6', label: '6 tháng' },
                    { value: '9', label: '9 tháng' },
                    { value: '12', label: '12 tháng' },
                  ]}
                  controlClassName="fleet-form__interval"
                  hideLabel
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}

/**
 * Add `months` to an ISO 'YYYY-MM-DD' date, clamping the day to the target
 * month's length (e.g. Jan 31 + 1 month → Feb 28). Returns null for invalid /
 * partial input. Pure — no Date.now()/string parsing side effects.
 */
function addMonthsIso(iso: string, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1; // 1-12
  // day 0 of (month+1) → last day of `month`. month is 1-based here.
  const lastDay = new Date(year, month, 0).getDate();
  const dd = String(Math.min(Number(m[3]), lastDay)).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** One labelled date input with an optional overdue/due badge. */
function TruckDateField({ id, label, value, onChange, alert }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  // computeVehicleAlerts only returns non-'ok' entries, so this is always
  // overdue/due — typed as the full VehicleAlert for simplicity.
  alert?: VehicleAlert;
}) {
  const badgeText = alert
    ? alert.daysUntil < 0
      ? `Quá hạn ${Math.abs(alert.daysUntil)} ngày`
      : `Còn ${alert.daysUntil} ngày`
    : null;
  return (
    <div className="field truck-alert-field">
      <label htmlFor={id} className="truck-alert-field__label">
        {label}
        {badgeText && (
          <span className={`truck-alert-badge truck-alert-badge--${alert!.status}`}>
            {badgeText}
          </span>
        )}
      </label>
      <DateInput
        id={id}
        className="input"
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
