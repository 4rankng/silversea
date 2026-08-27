import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Loader2, Plus, ReceiptText } from 'lucide-react';
import { DriverIncidentalCostType, DRIVER_INCIDENTAL_COST_LABELS } from '@tingting/shared';
import { driverClient } from '../../api/driverClient';
import { buildOfflineCommandKey } from '../../features/driver/useOfflineCommandQueue';
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
}

const COST_TYPE_OPTIONS = Object.values(DriverIncidentalCostType);

export function ShipmentCostEntryForm({ tripId }: ShipmentCostEntryFormProps) {
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

  const refresh = useCallback(async () => {
    try {
      const items = await driverClient.listIncidentalCosts(tripId);
      setEntries(items);
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
      const idempotencyKey = buildOfflineCommandKey(
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
          <p className="shipment-cost-entry__subtitle">Chi phí phát sinh ngoài (phụ cấp, phí nâng/hạ, đậu xe, cầu đường, dầu…).</p>
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

      {loading ? (
        <p className="shipment-cost-entry__loading">
          <Loader2 size={16} className="spin" /> Đang tải chi phí…
        </p>
      ) : entries.length === 0 ? (
        <p className="shipment-cost-entry__empty">Chưa có chi phí phát sinh nào cho chuyến này.</p>
      ) : (
        <ul className="shipment-cost-entry__list">
          {entries.map((entry) => (
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
            <label htmlFor="shipment-cost-entry-note" className="shipment-cost-entry__field-label">Ghi chú (không bắt buộc)</label>
            <textarea
              id="shipment-cost-entry-note"
              className="shipment-cost-entry__textarea"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="Ví dụ: phí nâng cont tại cảng Cát Lái"
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
