import { useEffect, useState } from 'react';
import { Modal } from '../UI';
import { SelectField, TextField } from '../../design-system';
import { createOperationalSite, type OperationalSite } from '../../api/shipmentClient';

interface OperationalSiteCreateDialogProps {
  isOpen: boolean;
  customerId: number;
  /** Default site type preselected when the dialog opens. */
  defaultSiteType?: 'FACTORY' | 'WAREHOUSE';
  routes: Array<{ id: number; name: string }>;
  onClose: () => void;
  /** Called with the newly-created site so the parent can refresh + auto-select it. */
  onCreated: (site: OperationalSite) => void;
}

type SiteType = 'FACTORY' | 'WAREHOUSE';

interface SiteFormState {
  code: string;
  name: string;
  shortName: string;
  siteType: SiteType;
  address: string;
  googleMapsUrl: string;
  contactName: string;
  contactPhone: string;
  routeId: string;
}

const EMPTY_FORM: SiteFormState = {
  code: '',
  name: '',
  shortName: '',
  siteType: 'FACTORY',
  address: '',
  googleMapsUrl: '',
  contactName: '',
  contactPhone: '',
  routeId: '',
};

/**
 * Create a customer-owned factory or warehouse from inside the shipment
 * intake form, so a user is never blocked by an empty "Nhà máy"/"Kho lấy
 * hàng" dropdown. Validates the same required fields as the backend
 * `operationalSiteSchema`; optional lift-fee/strict-rules fields are
 * managed by the master-data importer and intentionally omitted here to
 * keep the intake dialog focused.
 */
export function OperationalSiteCreateDialog({
  isOpen,
  customerId,
  defaultSiteType = 'FACTORY',
  routes,
  onClose,
  onCreated,
}: OperationalSiteCreateDialogProps) {
  const [form, setForm] = useState<SiteFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever the dialog opens, preselecting the requested
  // site type. Keeps the component mountable in place while still starting
  // each session clean.
  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...EMPTY_FORM, siteType: defaultSiteType });
    setError(null);
  }, [isOpen, defaultSiteType]);

  function update<K extends keyof SiteFormState>(key: K, value: SiteFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  function close() {
    if (saving) return;
    setForm(EMPTY_FORM);
    setError(null);
    onClose();
  }

  function validate(): string | null {
    if (!form.code.trim()) return 'Vui lòng nhập mã điểm vận hành';
    if (!form.name.trim()) return 'Vui lòng nhập tên điểm vận hành';
    if (!form.shortName.trim()) return 'Vui lòng nhập tên ngắn';
    if (!form.address.trim()) return 'Vui lòng nhập địa chỉ';
    if (form.siteType === 'FACTORY' && !form.routeId) return 'Vui lòng chọn tuyến đường cho nhà máy';
    if (form.googleMapsUrl.trim() && !/^https?:\/\//i.test(form.googleMapsUrl.trim())) {
      return 'Liên kết Google Maps phải bắt đầu bằng http:// hoặc https://';
    }
    return null;
  }

  async function submit() {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await createOperationalSite({
        customerId,
        code: form.code.trim(),
        name: form.name.trim(),
        shortName: form.shortName.trim(),
        siteType: form.siteType,
        routeId: form.siteType === 'FACTORY' ? Number(form.routeId) : null,
        address: form.address.trim(),
        googleMapsUrl: form.googleMapsUrl.trim() || null,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
      });
      setForm(EMPTY_FORM);
      onCreated(created);
    } catch (submitError) {
      setError(submitError instanceof Error && submitError.message.trim()
        ? submitError.message
        : 'Không thể tạo điểm vận hành. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
      <button
        type="button"
        onClick={close}
        disabled={saving}
        style={{ minHeight: 44, padding: '0 16px', border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--surface-1)', color: 'var(--fg-1)', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
      >
        Hủy
      </button>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        style={{ minHeight: 44, padding: '0 20px', border: 0, borderRadius: 8, background: 'var(--accent, #2563eb)', color: '#fff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
      >
        {saving ? 'Đang lưu…' : defaultSiteType === 'WAREHOUSE' ? 'Thêm kho' : 'Thêm nhà máy'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      title={defaultSiteType === 'WAREHOUSE' ? 'Thêm kho lấy hàng' : 'Thêm nhà máy'}
      onClose={close}
      onConfirm={() => void submit()}
      maxWidth={620}
      footer={footer}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        {error && (
          <div role="alert" style={{ color: 'var(--danger)', background: 'var(--danger-bg, rgba(220,38,38,.08))', padding: '10px 14px', borderRadius: 8, fontSize: 14 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 16 }}>
          <TextField
            label="Mã điểm vận hành"
            value={form.code}
            onChange={(event) => update('code', event.target.value.toUpperCase())}
            maxLength={80}
            placeholder="Ví dụ: BB-NHA-MAY-1"
            disabled={saving}
          />
          <SelectField
            label="Loại điểm"
            value={form.siteType}
            onChange={(event) => update('siteType', event.target.value as SiteType)}
            disabled={saving}
          >
            <option value="FACTORY">Nhà máy</option>
            <option value="WAREHOUSE">Kho</option>
          </SelectField>
        </div>
        {form.siteType === 'FACTORY' && (
          <SelectField
            label="Tuyến đường"
            value={form.routeId}
            onChange={(event) => update('routeId', event.target.value)}
            disabled={saving}
          >
            <option value="">— Chọn tuyến đường —</option>
            {routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
          </SelectField>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 16 }}>
          <TextField
            label="Tên đầy đủ"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            maxLength={255}
            placeholder="Tên đầy đủ dùng trên chứng từ, báo cáo"
            disabled={saving}
          />
          <TextField
            label="Tên ngắn"
            value={form.shortName}
            onChange={(event) => update('shortName', event.target.value)}
            maxLength={255}
            placeholder="Tên hiển thị trong vận hành"
            disabled={saving}
          />
        </div>
        <TextField
          label="Địa chỉ"
          value={form.address}
          onChange={(event) => update('address', event.target.value)}
          maxLength={2000}
          placeholder="Số, đường, phường, quận, tỉnh"
          disabled={saving}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 16 }}>
          <TextField
            label="Người liên hệ"
            value={form.contactName}
            onChange={(event) => update('contactName', event.target.value)}
            maxLength={120}
            disabled={saving}
          />
          <TextField
            label="Số điện thoại"
            value={form.contactPhone}
            onChange={(event) => update('contactPhone', event.target.value)}
            maxLength={30}
            disabled={saving}
          />
        </div>
        <TextField
          label="Liên kết Google Maps (không bắt buộc)"
          value={form.googleMapsUrl}
          onChange={(event) => update('googleMapsUrl', event.target.value)}
          maxLength={2000}
          placeholder="https://maps.google.com/…"
          disabled={saving}
        />
      </div>
    </Modal>
  );
}
