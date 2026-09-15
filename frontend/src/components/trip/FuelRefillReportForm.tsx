import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Fuel, Loader2, Plus, ReceiptText } from 'lucide-react';
import { DriverIncidentalCostType } from '@tingting/shared';
import { driverClient } from '../../api/driverClient';
import { buildIdempotencyKey } from '../../lib/idempotency';
import { NumberField, DateField } from '../../design-system';
import { formatCurrency, formatISODate, businessDateISO } from '../../lib/format';
import { photoSrc } from '../../lib/api/photo';
import './ShipmentCostEntryForm.css';

interface FuelRefillEntry {
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

export interface FuelRefillReportFormProps {
  /** Trip id — the incidental-costs API is trip-scoped, not fulfillment-scoped. */
  tripId: number;
}

/**
 * "Báo cáo đổ dầu" — driver-app spec's dedicated fuel-refill report, separate
 * from the generic "Nhập chi phí lô hàng" cost-entry form (same flag, same
 * underlying driver_incidental_costs table with costType always FUEL, but
 * its own form/list so a refill isn't entered as a generic "cost" and doesn't
 * duplicate across both lists). Distinct from the pre-existing pump-photo OCR
 * fuel-evidence feature elsewhere on this page — that one stays untouched;
 * this is a simple manual report for driver-entered refill spend.
 */
export function FuelRefillReportForm({ tripId }: FuelRefillReportFormProps) {
  const [entries, setEntries] = useState<FuelRefillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

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
      setEntries(items.filter((item) => item.costType === DriverIncidentalCostType.FUEL));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Không thể tải danh sách lần đổ dầu.');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function resetForm() {
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
      setFormError(error instanceof Error ? error.message : 'Không thể tải ảnh hóa đơn đổ dầu.');
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
        'fuel-refill-report',
        tripId,
        occurredAt,
        amount,
        Date.now(),
      );
      await driverClient.createIncidentalCost(
        tripId,
        {
          costType: DriverIncidentalCostType.FUEL,
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
      setFormError(error instanceof Error ? error.message : 'Không thể lưu lần đổ dầu. Vui lòng thử lại.');
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
          <h2 className="shipment-cost-entry__title">Báo cáo đổ dầu</h2>
          <p className="shipment-cost-entry__subtitle">Ghi nhận mỗi lần đổ dầu cho chuyến này (số tiền, ghi chú số lít nếu có, ảnh hóa đơn).</p>
        </div>
        {!formOpen && (
          <button
            type="button"
            className="shipment-cost-entry__add"
            onClick={() => setFormOpen(true)}
          >
            <Plus size={16} />
            <span>Thêm lần đổ dầu</span>
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
          <Loader2 size={16} className="spin" /> Đang tải danh sách đổ dầu…
        </p>
      ) : entries.length === 0 ? (
        <p className="shipment-cost-entry__empty">Chưa có lần đổ dầu nào được báo cáo cho chuyến này.</p>
      ) : (
        <ul className="shipment-cost-entry__list">
          {entries.map((entry) => (
            <li key={entry.id} className="shipment-cost-entry__item">
              {entry.receiptStorageKey && (
                <img
                  src={photoSrc(entry.receiptStorageKey)}
                  alt="Hóa đơn đổ dầu"
                  className="shipment-cost-entry__thumb"
                />
              )}
              <div className="shipment-cost-entry__item-body">
                <div className="shipment-cost-entry__item-top">
                  <strong><Fuel size={14} /> Đổ dầu</strong>
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

          <NumberField
            label="Số tiền đổ dầu (VND)"
            value={amount}
            onChange={setAmount}
            min={1}
            step={1}
            disabled={submitting}
            placeholder="0"
          />

          <DateField
            label="Ngày đổ dầu"
            value={occurredAt}
            onChange={setOccurredAt}
            disabled={submitting}
          />

          <div className="shipment-cost-entry__field">
            <label htmlFor="fuel-refill-report-note" className="shipment-cost-entry__field-label">Ghi chú (không bắt buộc)</label>
            <textarea
              id="fuel-refill-report-note"
              className="shipment-cost-entry__textarea"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="Ví dụ: 120 lít tại trạm Petrolimex Km12"
            />
          </div>

          <div className="shipment-cost-entry__receipt">
            <label className={`shipment-cost-entry__camera-btn${uploadingReceipt ? ' is-loading' : ''}`}>
              {uploadingReceipt ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
              <span>{receiptStorageKey ? 'Chụp lại hóa đơn' : 'Chụp hóa đơn đổ dầu'}</span>
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
                <img src={photoSrc(receiptStorageKey)} alt="Hóa đơn đổ dầu đã chụp" />
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
              <span>Lưu lần đổ dầu</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default FuelRefillReportForm;
