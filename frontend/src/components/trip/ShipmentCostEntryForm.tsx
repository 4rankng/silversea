import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Info,
  Loader2,
  Lock,
  Plus,
  ReceiptText,
} from 'lucide-react';
import {
  DRIVER_EDITABLE_COST_TYPES,
  DRIVER_INCIDENTAL_COST_LABELS,
  DriverIncidentalCostType,
} from '@tingting/shared';
import { driverClient } from '../../api/driverClient';
import { buildIdempotencyKey } from '../../lib/idempotency';
import { SelectField, NumberField, DateField } from '../../design-system';
import { formatCurrency, formatISODate, businessDateISO } from '../../lib/format';
import { photoSrc } from '../../lib/api/photo';
import './ShipmentCostEntryForm.css';

interface IncidentalCostEntry {
  id: number;
  tripId: number;
  driverId: number;
  costType: DriverIncidentalCostType;
  amount: string;
  occurredAt: string;
  note: string | null;
  receiptStorageKey: string | null;
  createdAt: string;
}

export interface ShipmentCostEntryFormProps {
  /** Trip id — the incidental-costs API is trip-scoped, not fulfillment-scoped. */
  tripId: number;
  /** Auto-filled `Tiền đường` for this trip. Read-only; comes from
   *  `trips.totalRoadAllowance` (27.8 — "Hệ thống tự động ghi nhận theo
   *  database up lên, không được điền tay"). */
  totalRoadAllowance: string | null;
  /** Pickup + drop port / warehouse names. Used to decide whether the
   *  Lạch Huyện 50.000đ read-only default applies (27.8 — "với những
   *  cont hàng cus/điều vận nhập nâng hạ tại phía Lạch Huyện, hệ thống
   *  ghi nhận mặc định phí nâng hạ 50.000đ"). */
  pickupLocation: string | null;
  deliveryLocation: string | null;
  pickupPortName?: string | null;
  dropPortName?: string | null;
  pickupWarehouseName?: string | null;
  dropWarehouseName?: string | null;
  /** 27.8 cost-section Ghi chú — driver-written note for accounting to
   *  re-check the auto-recorded costs. Server-seeded initial value
   *  (NULL on new trips). Distinct from per-line `note` on each cost
   *  entry (which explains an individual line). */
  costSubmissionNote?: string | null;
}

// FUEL has its own dedicated report (FuelRefillReportForm, same flag) per the
// driver-app spec — excluded here so a refill isn't entered twice or shown in
// both forms' lists. Both forms write to the same driver_incidental_costs
// table; each form only lists/creates its own slice of cost types.
// LIFT_DROP_LACH_HUYEN + ROAD_ALLOWANCE are also excluded from the picker —
// they're seeded server-side and only displayed as read-only rows below.
const COST_TYPE_OPTIONS = DRIVER_EDITABLE_COST_TYPES;

const LACH_HUYEN_DEFAULT_AMOUNT = 50000;
const LACH_HUYEN_MATCHER = /l[aá]ch\s*huy[eê]n/i;

function routeTouchesLachHuyen(props: ShipmentCostEntryFormProps): boolean {
  const candidates = [
    props.pickupLocation,
    props.deliveryLocation,
    props.pickupPortName,
    props.dropPortName,
    props.pickupWarehouseName,
    props.dropWarehouseName,
  ];
  return candidates.some((value) => typeof value === 'string' && LACH_HUYEN_MATCHER.test(value));
}

function parseAmount(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ShipmentCostEntryForm({
  tripId,
  totalRoadAllowance,
  pickupLocation,
  deliveryLocation,
  pickupPortName,
  dropPortName,
  pickupWarehouseName,
  dropWarehouseName,
  costSubmissionNote: initialCostSubmissionNote = null,
}: ShipmentCostEntryFormProps) {
  const [entries, setEntries] = useState<IncidentalCostEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [costType, setCostType] = useState<DriverIncidentalCostType>(COST_TYPE_OPTIONS[0]);
  const [amount, setAmount] = useState<number | ''>('');
  const [occurredAt, setOccurredAt] = useState(() => businessDateISO());
  const [note, setNote] = useState('');
  const [receiptStorageKey, setReceiptStorageKey] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 27.8 cost-section Ghi chú — driver-written note for accounting re-check
  // of the auto-recorded costs (Tiền đường / Phí Lạch Huyện). Autosaves on
  // blur with a 600ms debounce so the driver can finish typing without
  // hammering the API. Initial value is server-seeded (NULL on new trips).
  const [costSubmissionNote, setCostSubmissionNote] = useState(initialCostSubmissionNote ?? '');
  const [costSubmissionNoteSaving, setCostSubmissionNoteSaving] = useState(false);
  const [costSubmissionNoteSavedAt, setCostSubmissionNoteSavedAt] = useState<string | null>(
    initialCostSubmissionNote ? new Date().toISOString() : null,
  );
  const [costSubmissionNoteError, setCostSubmissionNoteError] = useState<string | null>(null);

  // Read-only auto rows (27.8 spec). Detected from fulfillment route.
  const lachHuyenApplies = useMemo(
    () => routeTouchesLachHuyen({
      tripId,
      totalRoadAllowance,
      pickupLocation,
      deliveryLocation,
      pickupPortName,
      dropPortName,
      pickupWarehouseName,
      dropWarehouseName,
    }),
    [
      tripId,
      totalRoadAllowance,
      pickupLocation,
      deliveryLocation,
      pickupPortName,
      dropPortName,
      pickupWarehouseName,
      dropWarehouseName,
    ],
  );
  const roadAllowanceAmount = useMemo(() => parseAmount(totalRoadAllowance), [totalRoadAllowance]);
  const existingLachHuyenEntry = useMemo(
    () => entries.find((entry) => entry.costType === DriverIncidentalCostType.LIFT_DROP_LACH_HUYEN) ?? null,
    [entries],
  );
  const existingRoadAllowanceEntry = useMemo(
    () => entries.find((entry) => entry.costType === DriverIncidentalCostType.ROAD_ALLOWANCE) ?? null,
    [entries],
  );

  const refresh = useCallback(async () => {
    try {
      const items = await driverClient.listIncidentalCosts(tripId);
      setEntries(
        items.filter(
          (item) =>
            item.costType !== DriverIncidentalCostType.FUEL,
        ),
      );
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Không thể tải danh sách chi phí.');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Section-level Ghi chú autosave. Debounced — only fires if the value
  // actually changed since the last saved snapshot. Whitespace-only is
  // normalized to empty string so the server stores NULL.
  useEffect(() => {
    const initial = (initialCostSubmissionNote ?? '').trim();
    if ((costSubmissionNote.trim() || '') === initial) {
      return;
    }
    const handle = setTimeout(() => {
      setCostSubmissionNoteSaving(true);
      setCostSubmissionNoteError(null);
      driverClient
        .updateCostSubmissionNote(tripId, costSubmissionNote)
        .then(() => {
          setCostSubmissionNoteSavedAt(new Date().toISOString());
        })
        .catch((err) => {
          setCostSubmissionNoteError(
            err instanceof Error ? err.message : 'Không thể lưu ghi chú. Vui lòng thử lại.',
          );
        })
        .finally(() => {
          setCostSubmissionNoteSaving(false);
        });
    }, 600);
    return () => clearTimeout(handle);
  }, [costSubmissionNote, initialCostSubmissionNote, tripId]);

  function resetForm() {
    setCostType(COST_TYPE_OPTIONS[0]);
    setAmount('');
    setOccurredAt(businessDateISO());
    setNote('');
    setReceiptStorageKey(null);
    setFormError(null);
  }

  async function handleCaptureReceipt(file: File) {
    setUploadingReceipt(true);
    setFormError(null);
    try {
      const { storageKey } = await driverClient.uploadReceiptPhoto({ tripId, file });
      setReceiptStorageKey(storageKey);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể tải ảnh hóa đơn.');
    } finally {
      setUploadingReceipt(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (amount === '' || !Number.isInteger(amount) || amount <= 0) {
      setFormError('Vui lòng nhập số tiền hợp lệ (số nguyên dương).');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const idempotencyKey = buildIdempotencyKey(
        'incidental-cost',
        tripId,
        costType,
        occurredAt,
        amount,
        Date.now(),
      );
      await driverClient.createIncidentalCost(
        tripId,
        {
          costType,
          amount,
          occurredAt,
          note: note.trim() || undefined,
          receiptStorageKey: receiptStorageKey ?? undefined,
        },
        idempotencyKey,
      );
      resetForm();
      setFormOpen(false);
      await refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Không thể lưu chi phí. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    resetForm();
    setFormOpen(false);
  }

  return (
    <div className="shipment-cost-entry">
      <div className="shipment-cost-entry__head">
        <div>
          <h2 className="shipment-cost-entry__title">Nhập chi phí lô hàng</h2>
          <p className="shipment-cost-entry__subtitle">
            Phí nâng/hạ, phí chi kho, rửa/hàn cont, cân lốp, tiền đường và các phí phát sinh khác.
          </p>
        </div>
        {!formOpen && (
          <button
            type="button"
            className="shipment-cost-entry__add"
            onClick={() => setFormOpen(true)}
          >
            <Plus size={16} />
            <span>Thêm chi phí</span>
          </button>
        )}
      </div>

      {loadError && (
        <div className="shipment-cost-entry__banner shipment-cost-entry__banner--error" role="alert">
          <AlertTriangle size={16} />
          <span>{loadError}</span>
        </div>
      )}

      {/* 27.8 spec — read-only auto rows:
            • Phí nâng/hạ Lạch Huyện 50.000đ (mặc định, không điền tay)
            • Tiền đường (tự động từ database) */}
      <div className="shipment-cost-entry__auto" data-testid="shipment-cost-auto">
        <div
          className={`shipment-cost-entry__auto-row${lachHuyenApplies ? '' : ' is-muted'}`}
          data-testid="shipment-cost-auto-lach-huyen"
        >
          <Lock size={14} aria-hidden="true" />
          <div className="shipment-cost-entry__auto-body">
            <span className="shipment-cost-entry__auto-label">
              {DRIVER_INCIDENTAL_COST_LABELS[DriverIncidentalCostType.LIFT_DROP_LACH_HUYEN]}
            </span>
            <span className="shipment-cost-entry__auto-value">
              {formatCurrency(String(existingLachHuyenEntry?.amount ?? LACH_HUYEN_DEFAULT_AMOUNT))}
            </span>
            <span className="shipment-cost-entry__auto-note">
              {lachHuyenApplies
                ? 'Mặc định 50.000đ khi cont hàng nhập nâng hạ tại Lạch Huyện. Hệ thống tự ghi nhận — không điền tay.'
                : 'Chỉ áp dụng khi cont hàng nhập nâng hạ tại Lạch Huyện. Tuyến hiện tại không đi qua Lạch Huyện.'}
            </span>
          </div>
        </div>

        <div className="shipment-cost-entry__auto-row" data-testid="shipment-cost-auto-road-allowance">
          <Lock size={14} aria-hidden="true" />
          <div className="shipment-cost-entry__auto-body">
            <span className="shipment-cost-entry__auto-label">
              {DRIVER_INCIDENTAL_COST_LABELS[DriverIncidentalCostType.ROAD_ALLOWANCE]}
            </span>
            <span className="shipment-cost-entry__auto-value">
              {roadAllowanceAmount != null
                ? formatCurrency(String(roadAllowanceAmount))
                : existingRoadAllowanceEntry
                  ? formatCurrency(existingRoadAllowanceEntry.amount)
                  : '—'}
            </span>
            <span className="shipment-cost-entry__auto-note">
              Hệ thống tự động ghi nhận theo database — không được điền tay. Nếu số liệu chưa đúng, ghi chú
              bên dưới để kế toán soát lại.
            </span>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="shipment-cost-entry__loading">
          <Loader2 size={16} className="spin" /> Đang tải chi phí…
        </p>
      ) : entries.length === 0 ? (
        <p className="shipment-cost-entry__empty">
          Chưa có chi phí phát sinh nào. Nhấn <strong>Thêm chi phí</strong> để nhập Phí nâng / Phí
          hạ / Phí chi kho, Rửa cont / Hàn cont / Cân lốp hoặc chi phí khác.
        </p>
      ) : (
        <ul className="shipment-cost-entry__list">
          {entries
            .filter(
              (entry) =>
                entry.costType !== DriverIncidentalCostType.LIFT_DROP_LACH_HUYEN &&
                entry.costType !== DriverIncidentalCostType.ROAD_ALLOWANCE,
            )
            .map((entry) => (
              <li key={entry.id} className="shipment-cost-entry__item">
                {entry.receiptStorageKey && (
                  <img
                    src={photoSrc(entry.receiptStorageKey)}
                    alt={`Hóa đơn ${DRIVER_INCIDENTAL_COST_LABELS[entry.costType]}`}
                    className="shipment-cost-entry__thumb"
                  />
                )}
                <div className="shipment-cost-entry__item-body">
                  <div className="shipment-cost-entry__item-top">
                    <strong>{DRIVER_INCIDENTAL_COST_LABELS[entry.costType]}</strong>
                    <span className="shipment-cost-entry__item-amount">{formatCurrency(entry.amount)}</span>
                  </div>
                  <div className="shipment-cost-entry__item-meta">
                    <span>{formatISODate(entry.occurredAt)}</span>
                    {entry.note && <span className="shipment-cost-entry__item-note">{entry.note}</span>}
                  </div>
                </div>
              </li>
            ))}
        </ul>
      )}

      {/* 27.8 cost-section Ghi chú — driver-written note for accounting to
          re-check the auto-recorded costs. Sits below the cost list (just
          above the "Thêm chi phí" button) per spec line 107, and the trip
          completion action lives in the trip footer and records the operation
          directly once the required evidence and inputs are present. */}
      <div className="shipment-cost-entry__section-note" data-testid="shipment-cost-section-note">
        <label
          htmlFor="shipment-cost-entry-section-note"
          className="shipment-cost-entry__section-note-label"
        >
          Ghi chú
        </label>
        <textarea
          id="shipment-cost-entry-section-note"
          className="shipment-cost-entry__textarea"
          value={costSubmissionNote}
          onChange={(event) => setCostSubmissionNote(event.target.value)}
          rows={3}
          placeholder="Nếu Tiền đường / Phí Lạch Huyện chưa đúng, ghi chú tại đây để kế toán đối chiếu số liệu."
        />
        <div className="shipment-cost-entry__section-note-meta">
          {costSubmissionNoteSaving ? (
            <span><Loader2 size={12} className="spin" /> Đang lưu…</span>
          ) : costSubmissionNoteError ? (
            <span className="shipment-cost-entry__section-note-error">{costSubmissionNoteError}</span>
          ) : costSubmissionNoteSavedAt ? (
            <span className="shipment-cost-entry__section-note-saved">
              <CheckCircle2 size={12} /> Đã lưu {formatISODate(costSubmissionNoteSavedAt)}
            </span>
          ) : (
            <span className="shipment-cost-entry__section-note-hint">Tự lưu khi rời ô.</span>
          )}
        </div>
      </div>

      {formOpen && (
        <form className="shipment-cost-entry__form" onSubmit={(event) => void handleSubmit(event)}>
          {formError && (
            <div className="shipment-cost-entry__banner shipment-cost-entry__banner--error" role="alert">
              <AlertTriangle size={16} />
              <span>{formError}</span>
            </div>
          )}

          <SelectField
            label="Loại chi phí"
            value={costType}
            onChange={(event) => setCostType(event.target.value as DriverIncidentalCostType)}
            disabled={submitting}
          >
            {COST_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>{DRIVER_INCIDENTAL_COST_LABELS[type]}</option>
            ))}
          </SelectField>

          <NumberField
            label="Số tiền (VND)"
            value={amount}
            onChange={setAmount}
            min={1}
            step={1}
            disabled={submitting}
            placeholder="0"
          />

          <DateField
            label="Ngày phát sinh"
            value={occurredAt}
            onChange={setOccurredAt}
            disabled={submitting}
          />

          <div className="shipment-cost-entry__field">
            <label htmlFor="shipment-cost-entry-note" className="shipment-cost-entry__field-label">
              <Info size={14} aria-hidden="true" /> Ghi chú (không bắt buộc)
            </label>
            <textarea
              id="shipment-cost-entry-note"
              className="shipment-cost-entry__textarea"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="Ví dụ: phí nâng cont tại cảng Cát Lái. Nếu Tiền đường / Phí Lạch Huyện chưa đúng, ghi chú tại đây để kế toán soát lại."
            />
          </div>

          <div className="shipment-cost-entry__receipt">
            <label className={`shipment-cost-entry__camera-btn${uploadingReceipt ? ' is-loading' : ''}`}>
              {uploadingReceipt ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
              <span>{receiptStorageKey ? 'Chụp lại hóa đơn' : 'Chụp hóa đơn'}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="shipment-cost-entry__file-input"
                disabled={uploadingReceipt || submitting}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void handleCaptureReceipt(file);
                }}
              />
            </label>
            {receiptStorageKey && (
              <div className="shipment-cost-entry__receipt-preview">
                <img src={photoSrc(receiptStorageKey)} alt="Hóa đơn đã chụp" />
                <span><ReceiptText size={14} /> Đã đính kèm ảnh hóa đơn</span>
              </div>
            )}
          </div>

          <div className="shipment-cost-entry__form-actions">
            <button
              type="button"
              className="shipment-cost-entry__cancel"
              onClick={handleCancel}
              disabled={submitting}
            >
              Hủy
            </button>
            <button
              type="submit"
              className="shipment-cost-entry__submit"
              disabled={submitting || uploadingReceipt}
            >
              {submitting ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
              <span>Lưu chi phí</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default ShipmentCostEntryForm;
