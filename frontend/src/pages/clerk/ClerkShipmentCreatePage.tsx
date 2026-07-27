// ClerkShipmentCreatePage — M10.1 mobile quick-shipment-create for the
// CLERK (nhân viên chứng từ) role.
//
// Minimum data set: `customerId` is the only required field (mirrors the
// backend `quickCreateShipmentSchema` — every other field is optional and
// typically filled later from the M10.2 doc-entry page). On submit the page
// generates a UUID v4 idempotency key and POSTs `/api/shipments/quick` with
// it in the `Idempotency-Key` header, so a flaky-network resubmit returns
// the original shipment instead of creating a duplicate (PRD M10-01-03,
// Q23 proposal).
//
// Mobile-first: single column, large touch targets, Vietnamese labels per
// PRD Mxx-HT-01. The success path navigates to the shipment detail page;
// both 201 (created) and 200 (idempotent replay) are treated as success.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { TextField, SelectField, EmptyState } from '../../design-system';
import { tripClient } from '../../api/tripClient';
import { quickCreateShipment } from '../../api/shipmentClient';

interface ClerkCustomerOption {
  id: number;
  name: string;
}

/** Minimal UUID v4 generator. Defers to `crypto.randomUUID` when available
 *  (every modern browser); falls back to the RFC 4122 §4.4 random-from-
 *  `crypto.getRandomValues` construction for older runtimes. */
function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Per RFC 4122 §4.4: set version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

interface FormState {
  customerId: string;
  bookingRef: string;
  blNumber: string;
  expectedDeliveryDate: string;
  pickupLocation: string;
  deliveryLocation: string;
  contactName: string;
  contactPhone: string;
}

const EMPTY_FORM: FormState = {
  customerId: '',
  bookingRef: '',
  blNumber: '',
  expectedDeliveryDate: '',
  pickupLocation: '',
  deliveryLocation: '',
  contactName: '',
  contactPhone: '',
};

export default function ClerkShipmentCreatePage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<ClerkCustomerOption[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load the shipment/customer bootstrap once on mount. This endpoint is
  // auth-only (not config-gated), so CLERK can read the same active customer
  // catalog the trip-create flow uses without broadening config permissions.
  useEffect(() => {
    let cancelled = false;
    setCustomersLoading(true);
    tripClient
      .getBootstrap()
      .then((bootstrap) => {
        if (!cancelled) setCustomers(bootstrap.customers);
      })
      .catch(() => {
        if (!cancelled) setCustomersError('Không thể tải danh sách khách hàng');
      })
      .finally(() => {
        if (!cancelled) setCustomersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({ value: String(c.id), label: c.name })),
    [customers],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear any prior submit error as soon as the user edits the form —
    // the old error no longer applies to the new input.
    if (submitError) setSubmitError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerId) {
      setSubmitError('Vui lòng chọn khách hàng');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    // One UUID per form submission attempt. The offline-queue lib (separate
    // roadmap item) will reuse this same key when it replays a queued
    // request after a dropped connection.
    const idempotencyKey = uuidv4();
    try {
      const shipment = await quickCreateShipment(
        {
          customerId: Number(form.customerId),
          bookingRef: form.bookingRef || null,
          blNumber: form.blNumber || null,
          expectedDeliveryDate: form.expectedDeliveryDate || null,
          pickupLocation: form.pickupLocation || null,
          deliveryLocation: form.deliveryLocation || null,
          contactName: form.contactName || null,
          contactPhone: form.contactPhone || null,
        },
        idempotencyKey,
      );
      // 201 (created) and 200 (idempotent replay) are both success. Navigate
      // to the shipment detail; the clerk's next step (M10.2 doc entry)
      // happens there.
      navigate(`/shipments/${shipment.id}`);
    } catch (err) {
      // Surface any server/network-provided Vietnamese message; fall back to
      // a generic hint when there is no usable message. The api wrapper
      // already translates HTTP error bodies via `ApiError.fromResponse`, so
      // `err.message` is user-facing when present.
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : 'Không thể tạo lô hàng. Vui lòng thử lại.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 640, margin: '0 auto' }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Quay lại"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          color: 'var(--fg-2)',
          fontSize: 14,
          padding: '8px 0',
          cursor: 'pointer',
        }}
      >
        <ArrowLeft size={18} /> Quay lại
      </button>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 8, marginBottom: 4 }}>
        Tạo lô hàng
      </h1>
      <p style={{ color: 'var(--fg-3)', fontSize: 14, marginBottom: 24 }}>
        Nhập thông tin tối thiểu để tạo lô nháp. Có thể bổ sung sau.
      </p>

      {customersLoading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--fg-3)' }}>
          Đang tải…
        </div>
      ) : customersError ? (
        <div style={{ color: 'var(--danger)', padding: 16 }}>{customersError}</div>
      ) : customerOptions.length === 0 ? (
        <EmptyState
          title="Chưa có khách hàng"
          description="Cần ít nhất một khách hàng trước khi tạo lô hàng."
        />
      ) : (
        <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SelectField
            label="Khách hàng"
            required
            value={form.customerId}
            onChange={(e) => update('customerId', e.target.value)}
            disabled={submitting}
          >
            <option value="">— Chọn khách hàng —</option>
            {customerOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectField>

          <TextField
            label="Số booking"
            value={form.bookingRef}
            onChange={(e) => update('bookingRef', e.target.value)}
            placeholder="Ví dụ: COSU1234567"
            disabled={submitting}
            maxLength={100}
          />

          <TextField
            label="Số vận đơn (B/L)"
            value={form.blNumber}
            onChange={(e) => update('blNumber', e.target.value)}
            placeholder="Ví dụ: MAEU1234567890"
            disabled={submitting}
            maxLength={100}
          />

          <TextField
            label="Ngày giao hàng dự kiến"
            type="date"
            value={form.expectedDeliveryDate}
            onChange={(e) => update('expectedDeliveryDate', e.target.value)}
            disabled={submitting}
          />

          <TextField
            label="Điểm nhận hàng"
            value={form.pickupLocation}
            onChange={(e) => update('pickupLocation', e.target.value)}
            placeholder="Ví dụ: Cảng Cát Lái"
            disabled={submitting}
            maxLength={255}
          />

          <TextField
            label="Điểm giao hàng"
            value={form.deliveryLocation}
            onChange={(e) => update('deliveryLocation', e.target.value)}
            placeholder="Ví dụ: Kho Bình Dương"
            disabled={submitting}
            maxLength={255}
          />

          <TextField
            label="Người liên hệ"
            value={form.contactName}
            onChange={(e) => update('contactName', e.target.value)}
            disabled={submitting}
            maxLength={100}
          />

          <TextField
            label="Số điện thoại liên hệ"
            type="tel"
            value={form.contactPhone}
            onChange={(e) => update('contactPhone', e.target.value)}
            placeholder="Ví dụ: 0901 234 567"
            disabled={submitting}
            maxLength={20}
          />

          {submitError && (
            <div
              role="alert"
              style={{
                color: 'var(--danger)',
                background: 'var(--danger-bg, rgba(220,38,38,0.08))',
                padding: '12px 16px',
                borderRadius: 8,
                fontSize: 14,
              }}
            >
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              minHeight: 48,
              padding: '0 24px',
              background: submitting ? 'var(--fg-3)' : 'var(--accent, #2563eb)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              width: '100%',
            }}
          >
            {submitting ? 'Đang lưu…' : (<><Check size={18} /> Tạo lô hàng</>)}
          </button>
        </form>
      )}
    </div>
  );
}
