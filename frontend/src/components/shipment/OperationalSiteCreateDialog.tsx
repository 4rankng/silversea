import { useEffect, useRef, useState } from 'react';
import { Plus, MapPin, Building2, Phone } from 'lucide-react';
import type { Route, OperationalSiteContact } from '@tingting/shared';
import { OperationalSiteContactsEditor } from './OperationalSiteContactsEditor';
import { Modal } from '../UI';
import { Alert } from '../shared/Alert';
import { SelectField, TextField } from '../../design-system';
import { EntityFormSection } from '../../components/shared/EntityFormParts';
import { createOperationalSite, type OperationalSite } from '../../api/shipmentClient';
import { RouteCreateDialog } from '../../features/shipments/create/RouteCreateDialog';
import './OperationalSiteCreateDialog.css';

interface OperationalSiteCreateDialogProps {
  isOpen: boolean;
  /**
   * Fixed owning customer (shipment-intake caller). Omit — and pass
   * `customers` instead — to render a customer picker (admin master-data page).
   */
  customerId?: number;
  /** Customer options for picker mode; ignored when `customerId` is given. */
  customers?: Array<{ id: number; name: string }>;
  customersError?: boolean | string | null;
  onRetryCustomers?: () => void;
  isCustomersLoading?: boolean;
  /** Default site type preselected when the dialog opens. */
  defaultSiteType?: 'FACTORY' | 'WAREHOUSE';
  /** FB-077 (card 091026180600): CUS-intake quick-add — the warehouse modal
   *  shrinks to Tên / Tên ngắn / Địa chỉ; the code derives from the folded
   *  name, a blank short-name falls back to the name, and the full
   *  operational-site form (mã, loại điểm, liên hệ, Google Maps) stays on the
   *  master-data page where it belongs. Master-data callers omit it. */
  quickAdd?: boolean;
  routes: Array<{ id: number; name: string }>;
  routesError?: boolean | string | null;
  onRetryRoutes?: () => void;
  isRoutesLoading?: boolean;
  onClose: () => void;
  /** Called with the newly-created site so the parent can refresh + auto-select it. */
  onCreated: (site: OperationalSite) => void;
  /** Keeps the parent route catalog current after inline route creation. */
  onRouteCreated?: (route: Route) => void;
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
  contacts: OperationalSiteContact[];
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
  contacts: [],
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
  customers,
  customersError,
  onRetryCustomers,
  isCustomersLoading,
  defaultSiteType = 'FACTORY',
  quickAdd = false,
  routes,
  routesError,
  onRetryRoutes,
  isRoutesLoading,
  onClose,
  onCreated,
  onRouteCreated,
}: OperationalSiteCreateDialogProps) {
  const [form, setForm] = useState<SiteFormState>(EMPTY_FORM);
  // Picker-mode customer selection (string id; '' = none chosen yet).
  const [customerChoice, setCustomerChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeDialogState, setRouteDialogState] = useState<'closed' | 'opening' | 'open' | 'returning'>('closed');
  const [createdRoutes, setCreatedRoutes] = useState<Array<{ id: number; name: string }>>([]);
  const addRouteButtonRef = useRef<HTMLButtonElement>(null);
  const routeDialogTimerRef = useRef<number | null>(null);
  const restoreRouteButtonFocusRef = useRef(false);

  // Reset the form whenever the dialog opens, preselecting the requested
  // site type. Keeps the component mountable in place while still starting
  // each session clean.
  useEffect(() => {
    if (!isOpen) {
      if (routeDialogTimerRef.current !== null) window.clearTimeout(routeDialogTimerRef.current);
      routeDialogTimerRef.current = null;
      setRouteDialogState('closed');
      return;
    }
    setForm({ ...EMPTY_FORM, siteType: defaultSiteType });
    setCustomerChoice('');
    setError(null);
    setCreatedRoutes([]);
  }, [isOpen, defaultSiteType]);

  useEffect(() => () => {
    if (routeDialogTimerRef.current !== null) window.clearTimeout(routeDialogTimerRef.current);
  }, []);

  function update<K extends keyof SiteFormState>(key: K, value: SiteFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  function close() {
    if (saving) return;
    if (routeDialogTimerRef.current !== null) window.clearTimeout(routeDialogTimerRef.current);
    routeDialogTimerRef.current = null;
    restoreRouteButtonFocusRef.current = false;
    setRouteDialogState('closed');
    setForm(EMPTY_FORM);
    setError(null);
    onClose();
  }

  function closeRouteDialog() {
    restoreRouteButtonFocusRef.current = true;
    setRouteDialogState('returning');
    routeDialogTimerRef.current = window.setTimeout(() => {
      routeDialogTimerRef.current = null;
      setRouteDialogState('closed');
      window.setTimeout(() => {
        if (restoreRouteButtonFocusRef.current && addRouteButtonRef.current) {
          restoreRouteButtonFocusRef.current = false;
          addRouteButtonRef.current.focus();
        }
      }, 50);
    }, 240);
  }

  function openRouteDialog() {
    setRouteDialogState('opening');
    routeDialogTimerRef.current = window.setTimeout(() => {
      routeDialogTimerRef.current = null;
      setRouteDialogState('open');
    }, 240);
  }

  function handleRouteCreated(route: Route) {
    setCreatedRoutes((current) => [
      ...current.filter((item) => item.id !== route.id),
      { id: route.id, name: route.shortName || route.name },
    ]);
    update('routeId', String(route.id));
    onRouteCreated?.(route);
    closeRouteDialog();
  }

  const routeOptions = [
    ...routes,
    ...createdRoutes.filter((createdRoute) => !routes.some((route) => route.id === createdRoute.id)),
  ];

  function validate(): string | null {
    if (customerId == null && !customerChoice) return 'Vui lòng chọn khách hàng';
    if (!form.name.trim()) return 'Vui lòng nhập tên điểm vận hành';
    if (!quickAdd) {
      if (!form.code.trim()) return 'Vui lòng nhập mã điểm vận hành';
      if (!form.shortName.trim()) return 'Vui lòng nhập tên ngắn';
    }
    if (!form.address.trim()) return 'Vui lòng nhập địa chỉ';
    if (!quickAdd && form.siteType === 'FACTORY' && !form.routeId) return 'Vui lòng chọn tuyến đường cho nhà máy';
    if (!quickAdd && form.googleMapsUrl.trim() && !/^https?:\/\//i.test(form.googleMapsUrl.trim())) {
      return 'Liên kết Google Maps phải bắt đầu bằng http:// hoặc https://';
    }
    return null;
  }

  /** Quick-add site code: the name, diacritics folded, uppercased, dashed —
   *  the intake user never types an operational-site code (FB-077). */
  function deriveQuickAddCode(name: string): string {
    const folded = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
    const code = folded.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return code || `SITE-${Date.now()}`;
  }

  async function submit() {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await createOperationalSite({
        customerId: customerId ?? Number(customerChoice),
        code: quickAdd ? deriveQuickAddCode(form.name) : form.code.trim(),
        name: form.name.trim(),
        shortName: form.shortName.trim() || form.name.trim(),
        siteType: form.siteType,
        routeId: form.siteType === 'FACTORY' ? Number(form.routeId) : null,
        address: form.address.trim(),
        googleMapsUrl: form.googleMapsUrl.trim() || null,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        contacts: form.contacts,
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
    <>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={close}
        disabled={saving}
      >
        Hủy
      </button>
      <button
        type="button"
        className="btn btn--primary btn--sm"
        onClick={() => void submit()}
        disabled={saving}
      >
        {saving ? 'Đang lưu…' : defaultSiteType === 'WAREHOUSE' ? 'Thêm kho' : 'Thêm nhà máy'}
      </button>
    </>
  );

  return (
    <>
    <Modal
      isOpen={isOpen && routeDialogState === 'closed'}
      title={defaultSiteType === 'WAREHOUSE' ? 'Thêm kho lấy hàng' : 'Thêm nhà máy'}
      subtitle="Điểm vận hành"
      polished
      onClose={close}
      onConfirm={() => void submit()}
      maxWidth={620}
      footer={footer}
    >
      <div className="operational-site-create">
        {error && (
          <div role="alert" className="operational-site-create__error">
            {error}
          </div>
        )}
        <EntityFormSection icon={MapPin} label="Điểm vận hành">
          {customerId == null && (
            <div className="col-span-full">
              {customersError && (
                <div style={{ marginBottom: 12 }}>
                  <Alert
                    variant="error"
                    style="soft"
                    action={
                      onRetryCustomers ? (
                        <button type="button" className="btn btn--sm" onClick={onRetryCustomers}>
                          Thử lại
                        </button>
                      ) : undefined
                    }
                  >
                    Không tải được danh sách khách hàng.
                  </Alert>
                </div>
              )}
              <SelectField
                label="Khách hàng"
                value={customerChoice}
                onChange={(event) => { setCustomerChoice(event.target.value); setError(null); }}
                disabled={saving || Boolean(customersError) || isCustomersLoading}
              >
                <option value="">
                  {customersError
                    ? '— Lỗi tải danh sách khách hàng —'
                    : isCustomersLoading
                    ? '— Đang tải danh sách khách hàng… —'
                    : '— Chọn khách hàng —'}
                </option>
                {(customers ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </SelectField>
            </div>
          )}
          {!quickAdd && (
            <>
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
            </>
          )}
          {form.siteType === 'FACTORY' && (
            <div className="col-span-full">
              {routesError && (
                <div style={{ marginBottom: 12 }}>
                  <Alert
                    variant="error"
                    style="soft"
                    action={
                      onRetryRoutes ? (
                        <button type="button" className="btn btn--sm" onClick={onRetryRoutes}>
                          Thử lại
                        </button>
                      ) : undefined
                    }
                  >
                    Không tải được danh sách tuyến đường.
                  </Alert>
                </div>
              )}
              <div className="operational-site-create__route-picker">
                <SelectField
                  label="Tuyến đường"
                  value={form.routeId}
                  onChange={(event) => update('routeId', event.target.value)}
                  disabled={saving || Boolean(routesError) || isRoutesLoading}
                >
                  <option value="">
                    {routesError
                      ? '— Lỗi tải danh sách tuyến đường —'
                      : isRoutesLoading
                      ? '— Đang tải danh sách tuyến đường… —'
                      : '— Chọn tuyến đường —'}
                  </option>
                  {routeOptions.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
                </SelectField>
                <button
                  ref={addRouteButtonRef}
                  type="button"
                  className="operational-site-create__add-route"
                  onClick={openRouteDialog}
                  disabled={saving}
                >
                  <Plus size={15} aria-hidden="true" />Thêm tuyến đường
                </button>
              </div>
            </div>
          )}
        </EntityFormSection>
        <EntityFormSection icon={Building2} label="Tên &amp; địa chỉ">
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
          <div className="col-span-full">
            <TextField
              label="Địa chỉ"
              value={form.address}
              onChange={(event) => update('address', event.target.value)}
              maxLength={2000}
              placeholder="Số, đường, phường, quận, tỉnh"
              disabled={saving}
            />
          </div>
        </EntityFormSection>
        {!quickAdd && (
          <EntityFormSection icon={Phone} label="Liên hệ">
            <div className="col-span-full">
              <OperationalSiteContactsEditor value={form.contacts} disabled={saving} onChange={contacts => update('contacts', contacts)} />
            </div>
            <div className="col-span-full">
              <TextField
                label="Liên kết Google Maps (không bắt buộc)"
                value={form.googleMapsUrl}
                onChange={(event) => update('googleMapsUrl', event.target.value)}
                maxLength={2000}
                placeholder="https://maps.google.com/…"
                disabled={saving}
              />
            </div>
          </EntityFormSection>
        )}
      </div>
    </Modal>
    <RouteCreateDialog
      isOpen={isOpen && routeDialogState === 'open'}
      onClose={closeRouteDialog}
      onCreated={handleRouteCreated}
    />
    </>
  );
}
