import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { EmptyState } from '../../../design-system';
import {
  USearchableField as SearchableField,
  USelectField as SelectField,
  UTextAreaField as TextAreaField,
  UTextField as TextField,
  UDateField as DateField,
} from './uui-fields';
import { useToast } from '../../../components/shared/Toast';
import { tripClient, type CatalogData } from '../../../api/tripClient';
import {
  listOperationalSites,
  type OperationalSite,
} from '../../../api/shipmentClient';
import { OperationalSiteDetailsDialog } from '../../../components/shipment/OperationalSiteDetailsDialog';
import { OperationalSiteCreateDialog } from '../../../components/shipment/OperationalSiteCreateDialog';
import {
  EMPTY_SHIPMENT_CREATE_FORM,
  createContainerFromPrevious,
  createEmptyContainer,
  getShipmentCreateReadiness,
  type CargoMode,
  type SaveIntent,
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
  type ShipmentCreateIssue,
} from './shipment-create-model';
import { ShipmentCreateSummary } from './ShipmentCreateSummary';
import { ShipmentCreateSection, shipmentCreateGridStyle } from './ShipmentCreateSections';
import { ShipmentContainerEditor } from './ShipmentContainerEditor';
import { useShipmentCreateWorkflow } from './use-shipment-create-workflow';
import { Modal } from '../../../components/UI';
import '../../../pages/clerk/ClerkShipmentCreatePage.css';

type FormState = ShipmentCreateFormState;
type ContainerRow = ShipmentContainerDraft;

const EMPTY_FORM = EMPTY_SHIPMENT_CREATE_FORM;
const newContainer = createEmptyContainer;

const gridStyle = shipmentCreateGridStyle;

export function ShipmentCreateWorkspace() {
  const navigate = useNavigate();
  const [catalogs, setCatalogs] = useState<CatalogData | null>(null);
  const [sites, setSites] = useState<OperationalSite[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // Customer-facing note — kept separate from `form.operationalNotes` per the
  // two-note model. `ShipmentCreateFormState` (owned by shipment-create-model)
  // has not been widened yet, so this lives as its own state slice here.
  const [customerNotes, setCustomerNotes] = useState('');
  const [containers, setContainers] = useState<ContainerRow[]>([newContainer()]);
  const [loading, setLoading] = useState(true);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<ShipmentCreateIssue[]>([]);
  const { toast } = useToast();
  const [detailSite, setDetailSite] = useState<OperationalSite | null>(null);
  const [createSiteDialog, setCreateSiteDialog] = useState<{ open: boolean; siteType: 'FACTORY' | 'WAREHOUSE' }>({ open: false, siteType: 'FACTORY' });
  // Bumped after a site is created in-dialog so the operational-sites effect
  // re-fetches and the new row appears in the dropdown without a full reload.
  const [sitesVersion, setSitesVersion] = useState(0);
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    tripClient.getBootstrap()
      .then((value) => { if (!cancelled) setCatalogs(value); })
      .catch(() => { if (!cancelled) setLoadError('Không thể tải dữ liệu danh mục'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!form.customerId) { setSites([]); return; }
    let cancelled = false;
    setSitesLoading(true);
    listOperationalSites(Number(form.customerId))
      .then((value) => { if (!cancelled) setSites(value); })
      .catch(() => { if (!cancelled) reportError('Không thể tải danh sách nhà máy của khách hàng'); })
      .finally(() => { if (!cancelled) setSitesLoading(false); });
    return () => { cancelled = true; };
  }, [form.customerId, sitesVersion]);

  const operationalSites = useMemo(() => sites.filter((site) => site.siteType === 'FACTORY'), [sites]);
  const selectedOperationalSite = useMemo(
    () => operationalSites.find((site) => String(site.id) === form.operationalSiteId) ?? null,
    [form.operationalSiteId, operationalSites],
  );
  const warehouseSites = useMemo(() => sites.filter((site) => site.siteType === 'WAREHOUSE'), [sites]);
  const readiness = useMemo(
    () => getShipmentCreateReadiness(form, containers),
    [containers, form],
  );
  const issueByField = useMemo(
    () => new Map(validationIssues.map((item) => [item.fieldId, item.message])),
    [validationIssues],
  );
  const isDirty = useMemo(() => {
    const hasFormData = Object.entries(form).some(([key, value]) => (
      key === 'cargoMode' ? value !== EMPTY_FORM.cargoMode
        : Array.isArray(value) ? value.length > 0
        : value !== ''
    ));
    const hasContainerData = containers.some((row) => (
      Object.entries(row).some(([key, value]) => key !== 'key' && value !== '')
    ));
    return hasFormData || hasContainerData || customerNotes.trim() !== '';
  }, [containers, customerNotes, form]);

  const { clearFeedback, reportError, save: runSave, saving, submitError } = useShipmentCreateWorkflow({
    form,
    containers,
    sites,
    readiness,
    onValidationIssues: setValidationIssues,
    customerNotes,
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    clearFeedback();
  }

  function selectCustomer(value: string) {
    setForm((current) => ({ ...current, customerId: value, operationalSiteId: '', pickupWarehouseSiteId: '' }));
    setSites([]);
    clearFeedback();
  }

  function selectOperationalSite(value: string) {
    update('operationalSiteId', value);
  }

  /**
   * Click handler for the in-form "Thêm nhà máy" / "Thêm kho" buttons.
   *
   * Customer support reported (2026-08-05) that the factory dropdown looked
   * empty AND the "add new" button felt broken. The actual root cause: the
   * add buttons were rendered only AFTER a customer had been picked, so a
   * user landing on the intake form could not see any way forward before
   * scrolling up to fill the customer field. Worse, the create dialog's
   * own guard (`isOpen && form.customerId`) silently rejected the click if
   * no customer was set, so even a "sticky" click did nothing.
   *
   * Now we render the add button always and route through this handler: if
   * no customer is selected, surface a toast and scroll/focus the customer
   * field. Otherwise open the create dialog. Either way the user gets
   * visible feedback and a clear next step.
   */
  function openCreateSiteDialog(siteType: 'FACTORY' | 'WAREHOUSE') {
    if (!form.customerId) {
      toast({
        kind: 'warning',
        message: 'Vui lòng chọn khách hàng trước khi thêm nhà máy hoặc kho mới.',
        duration: 6000,
      });
      const wrap = document.querySelector('[data-field="shipment-customer"]');
      if (wrap instanceof HTMLElement) {
        // jsdom (and older test environments) don't implement scrollIntoView;
        // it's also a no-op when the element is already on-screen, so guard
        // both cases instead of letting the test crash.
        const scrollIntoView = (wrap as HTMLElement & { scrollIntoView?: (options?: ScrollIntoViewOptions) => void }).scrollIntoView;
        if (typeof scrollIntoView === 'function') {
          scrollIntoView.call(wrap, { behavior: 'smooth', block: 'center' });
        }
        const trigger = wrap.querySelector('button:not([disabled])');
        if (trigger instanceof HTMLElement) {
          window.setTimeout(() => trigger.focus(), 280);
        }
      }
      return;
    }
    setCreateSiteDialog({ open: true, siteType });
  }

  /**
   * Called when the in-form "Thêm nhà máy/kho" dialog successfully creates a
   * site. Forces a re-fetch (so the new row is present) and auto-selects it
   * so the user can continue the intake without re-opening the dropdown.
   */
  function handleSiteCreated(site: OperationalSite) {
    setCreateSiteDialog({ open: false, siteType: site.siteType });
    setSitesVersion((version) => version + 1);
    if (site.siteType === 'FACTORY') {
      update('operationalSiteId', String(site.id));
    } else {
      update('pickupWarehouseSiteId', String(site.id));
    }
  }

  function changeMode(next: CargoMode) {
    if (next === form.cargoMode) return;
    const hasModeData = form.cargoMode === 'LCL'
      ? Boolean(form.packageType || form.packageCount || form.cargoVolumeCbm || form.extraDeliveryDates.some(Boolean))
      : containers.some((row) => Object.entries(row).some(([key, value]) => key !== 'key' && value));
    if (hasModeData && !window.confirm(`Chuyển sang ${next} sẽ xóa dữ liệu hàng hóa đã nhập. Tiếp tục?`)) return;
    setForm((current) => ({
      ...current,
      cargoMode: next,
      cargoTypeId: next === 'FCL' ? '' : current.cargoTypeId,
      operationalSiteId: current.operationalSiteId,
      pickupWarehouseSiteId: next === 'FCL' ? '' : current.pickupWarehouseSiteId,
      cargoVolumeCbm: '',
      packageCount: '',
      packageType: '',
      cargoWeightKg: '',
      extraDeliveryDates: [],
    }));
    setContainers([newContainer()]);
    setCustomerNotes('');
    clearFeedback();
  }

  function updateContainer(key: string, field: keyof Omit<ContainerRow, 'key'>, value: string) {
    setContainers((current) => current.map((row) => row.key === key ? { ...row, [field]: value } : row));
    clearFeedback();
  }

  function focusIssue(fieldId: string) {
    const field = document.querySelector(`[data-field-id="${fieldId}"]`);
    if (!(field instanceof HTMLElement)) return;
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    field.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    const control = field.matches('button, input, select, textarea, [tabindex]')
      ? field
      : field.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (control instanceof HTMLElement) control.focus({ preventScroll: true });
  }

  function goBack() {
    if (isDirty) {
      setBackConfirmOpen(true);
      return;
    }
    navigate(-1);
  }

  function discardAndGoBack() {
    setBackConfirmOpen(false);
    navigate(-1);
  }

  async function save(intent: SaveIntent) {
    const result = await runSave(intent);
    if (result.issues.length > 0) {
      window.requestAnimationFrame(() => focusIssue(result.issues[0].fieldId));
    }
  }

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-3)' }}>Đang tải…</div>;
  if (loadError) return <div role="alert" style={{ padding: 24, color: 'var(--danger)' }}>{loadError}</div>;
  if (!catalogs?.customers.length) return <EmptyState title="Chưa có khách hàng" description="Cần ít nhất một khách hàng trước khi tạo lô hàng." />;

  return (
    <div className="csc-page">
      <header className="csc-header">
        <span className="csc-header__eyebrow">Lô hàng CUS</span>
        <h1>Tạo lô hàng mới</h1>
        <p>Thông tin lịch vận hành sẽ tự xác định trạng thái lô hàng và thời điểm Điều vận có thể tiếp nhận.</p>
      </header>

      <form onSubmit={(event) => { event.preventDefault(); void save('DRAFT'); }} className="csc-workspace">
        <div className="csc-form">
        <ShipmentCreateSection id="identity" number="01" title="Nhận diện lô" description="Khách hàng, chứng từ và hướng xuất nhập khẩu.">
          <div className="csc-identity-grid">
            {/* KHÁCH HÀNG */}
            <div className="csc-identity-grid__customer" data-field="shipment-customer" data-field-id="shipment-customer">
              <SearchableField
                id="shipment-customer"
                label="Khách hàng"
                required
                value={form.customerId}
                onChange={selectCustomer}
                options={catalogs.customers.map((item) => ({ value: String(item.id), label: item.name }))}
                placeholder="Gõ để tìm kiếm"
                disabled={Boolean(saving)}
                error={issueByField.get('shipment-customer')}
                className="csc-customer-field"
                popoverClassName="csc-customer-popover"
                optionClassName="csc-customer-option"
              />
            </div>

            {/* BILL LÔ HÀNG */}
            <div className="csc-identity-grid__booking" data-field-id="shipment-booking-ref"><TextField id="shipment-booking-ref" label="Số Bill/Booking" required value={form.bookingRef || form.blNumber || ''} onChange={(event) => update('bookingRef', event.target.value)} maxLength={100} placeholder="Nhập số Bill hoặc Booking" disabled={Boolean(saving)} error={issueByField.get('shipment-booking-ref')} /></div>

            <div className="csc-identity-grid__trade-direction" data-field-id="shipment-trade-direction"><SelectField id="shipment-trade-direction" label="Hình thức xuất nhập khẩu" required value={form.tradeDirection} onChange={(event) => update('tradeDirection', event.target.value as FormState['tradeDirection'])} disabled={Boolean(saving)} error={issueByField.get('shipment-trade-direction')} options={[{ value: '', label: '— Chọn hình thức —' }, { value: 'IMPORT', label: 'Nhập khẩu' }, { value: 'EXPORT', label: 'Xuất khẩu' }]} /></div>

            {form.cargoMode === 'FCL' && (
              <div className="csc-identity-grid__shipping-line" data-field-id="shipment-shipping-line"><SearchableField id="shipment-shipping-line" label="Hãng tàu" value={form.shippingLineName} onChange={(value) => update('shippingLineName', value)} allowsCustomValue options={(catalogs.externalCarriers ?? []).map((carrier) => ({ value: carrier.name, label: carrier.name }))} placeholder="Gõ chọn hoặc nhập hãng tàu" disabled={Boolean(saving)} error={issueByField.get('shipment-shipping-line')} /></div>
            )}

            {/* SỐ TỜ KHAI */}
            <div className="csc-identity-grid__declaration"><TextField label="Số tờ khai" value={form.declarationNumber} onChange={(event) => update('declarationNumber', event.target.value)} maxLength={100} disabled={Boolean(saving)} /></div>

          </div>
        </ShipmentCreateSection>

        <ShipmentCreateSection id="route" number="02" title="Điểm vận hành & tuyến" description="Chọn tuyến và điểm giao hoặc lấy hàng theo hình thức lô.">
          <div style={gridStyle}>
            <div data-field-id="shipment-route">
            <SearchableField
              id="shipment-route"
              label="Tuyến đường"
              required
              value={form.routeId}
              onChange={(value) => update('routeId', value)}
              options={(catalogs.routes ?? []).map((item) => ({ value: String(item.id), label: item.name }))}
              placeholder="Gõ chọn"
              disabled={Boolean(saving)}
              error={issueByField.get('shipment-route')}
            />
            </div>
            <div className="csc-site-picker">
              <SearchableField
                id="shipment-operational-site"
                label="Nhà máy"
                value={form.operationalSiteId}
                onChange={selectOperationalSite}
                options={operationalSites.map((site) => ({ value: String(site.id), label: site.name, searchText: site.address ?? '' }))}
                placeholder={sitesLoading ? 'Đang tải…' : !form.customerId ? 'Chọn khách hàng trước' : 'Gõ chọn'}
                disabled={!form.customerId || sitesLoading || Boolean(saving)}
                error={issueByField.get('shipment-operational-site')}
                hint={!form.customerId
                  ? 'Vui lòng chọn khách hàng để tải danh sách.'
                  : (form.customerId && !sitesLoading && operationalSites.length === 0
                    ? <>Chưa có nhà máy.{' '}<button type="button" onClick={(e) => { e.preventDefault(); openCreateSiteDialog('FACTORY'); }} disabled={Boolean(saving)} style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent, #2563eb)', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Thêm mới</button></>
                    : undefined)}
              />
              <div className="csc-site-picker__actions">
                {form.operationalSiteId && (
                  <button
                    type="button"
                    onClick={() => setDetailSite(selectedOperationalSite)}
                    className="csc-utility-button"
                  >
                    <Eye size={15} aria-hidden="true" />Xem chi tiết
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openCreateSiteDialog('FACTORY')}
                  disabled={Boolean(saving)}
                  className="csc-utility-button csc-utility-button--dashed"
                >
                  <Plus size={15} aria-hidden="true" />Thêm nhà máy
                </button>
              </div>
            </div>
          </div>

          {selectedOperationalSite?.strictRules && (
            <aside className="csc-site-guidance" role="note">
              <strong>Lưu ý tại nhà máy</strong>
              <p>{selectedOperationalSite.strictRules}</p>
            </aside>
          )}
        </ShipmentCreateSection>

        <ShipmentCreateSection id="cargo" number="03" title="Thông tin hàng" description="Nhập chi tiết phù hợp với hàng nguyên container hoặc hàng lẻ.">
          <fieldset className="csc-mode" aria-required="true"><legend>Loại hàng <span aria-hidden="true">*</span></legend><div>
            {(['FCL', 'LCL'] as CargoMode[]).map((mode) => <label key={mode}><input type="radio" name="cargo-mode" value={mode} checked={form.cargoMode === mode} onChange={() => changeMode(mode)} disabled={Boolean(saving)} /><span className="csc-mode__option">{mode === 'FCL' ? 'Hàng nguyên container (FCL)' : 'Hàng lẻ (LCL)'}</span></label>)}
          </div></fieldset>
          {form.cargoMode === 'FCL' ? (
            <ShipmentContainerEditor
              saving={Boolean(saving)}
              onAdd={() => setContainers((current) => [
                ...current,
                createContainerFromPrevious(current[current.length - 1]),
              ])}
              rows={<>{containers.map((row, index) => (
                <div key={row.key} className="csc-container-record">
                  <div className="csc-container-record__header"><strong>Container {index + 1}</strong>{containers.length > 1 && <button type="button" className="csc-icon-button csc-icon-button--danger" aria-label={`Xóa container ${index + 1}`} onClick={() => setContainers((current) => current.filter((item) => item.key !== row.key))}><Trash2 size={18} /></button>}</div>
                  <div className="csc-container-grid" style={gridStyle}>
                    <div data-field-id={`container-${row.key}-number`}><TextField id={`container-${row.key}-number`} label="Số container" value={row.containerNumber} onChange={(event) => updateContainer(row.key, 'containerNumber', event.target.value.toUpperCase())} disabled={Boolean(saving)} error={issueByField.get(`container-${row.key}-number`)} /></div>
                    <div data-field-id={`container-${row.key}-type`}><SelectField id={`container-${row.key}-type`} label="Loại container" required value={row.containerTypeId} onChange={(event) => updateContainer(row.key, 'containerTypeId', event.target.value)} disabled={Boolean(saving)} error={issueByField.get(`container-${row.key}-type`)} options={[{ value: '', label: '— Chọn loại —' }, ...(catalogs.containerTypes ?? []).map((item) => ({ value: String(item.id), label: `${item.code} — ${item.name}` }))]} /></div>
                    <div data-field-id={`container-${row.key}-pickup-port`}><SearchableField id={`container-${row.key}-pickup-port`} label="Cảng nâng" value={row.pickupPortId} onChange={(value) => updateContainer(row.key, 'pickupPortId', value)} options={(catalogs.ports ?? []).map((item) => ({ value: String(item.id), label: item.name }))} placeholder="Chọn cảng nâng" disabled={Boolean(saving)} error={issueByField.get(`container-${row.key}-pickup-port`)} /></div>
                    <div data-field-id={`container-${row.key}-dropoff-port`}><SearchableField id={`container-${row.key}-dropoff-port`} label="Cảng hạ" value={row.dropoffPortId} onChange={(value) => updateContainer(row.key, 'dropoffPortId', value)} options={(catalogs.ports ?? []).map((item) => ({ value: String(item.id), label: item.name }))} placeholder="Chọn cảng hạ" disabled={Boolean(saving)} error={issueByField.get(`container-${row.key}-dropoff-port`)} /></div>
                    <TextField label="Trọng lượng (kg)" type="number" min="0" step="0.01" value={row.cargoWeightKg} onChange={(event) => updateContainer(row.key, 'cargoWeightKg', event.target.value)} disabled={Boolean(saving)} />
                    <DateField label="Ngày giao dự kiến" value={row.expectedDeliveryDate} onChange={(event) => updateContainer(row.key, 'expectedDeliveryDate', event.target.value)} disabled={Boolean(saving)} />
                  </div>
                </div>
              ))}</>}
            />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div data-field-id="shipment-pickup-warehouse" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'stretch' }}>
                <SearchableField
                  id="shipment-pickup-warehouse"
                  label="Kho lấy hàng"
                  value={form.pickupWarehouseSiteId}
                  onChange={(value) => update('pickupWarehouseSiteId', value)}
                  options={warehouseSites.map((site) => ({ value: String(site.id), label: site.name, searchText: site.address ?? '' }))}
                  placeholder={sitesLoading ? 'Đang tải…' : !form.customerId ? 'Chọn khách hàng trước' : 'Chọn kho lấy hàng'}
                  disabled={!form.customerId || sitesLoading || Boolean(saving)}
                  error={issueByField.get('shipment-pickup-warehouse')}
                  hint={!form.customerId
                    ? 'Vui lòng chọn khách hàng để tải danh sách kho.'
                    : (form.customerId && !sitesLoading && warehouseSites.length === 0
                      ? <>Chưa có kho cho khách hàng này.{' '}<button type="button" onClick={() => openCreateSiteDialog('WAREHOUSE')} disabled={Boolean(saving)} style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent, #2563eb)', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Thêm kho</button></>
                      : undefined)}
                />
                {!sitesLoading && form.customerId ? (
                  <button
                    type="button"
                    onClick={() => openCreateSiteDialog('WAREHOUSE')}
                    disabled={Boolean(saving)}
                    style={{
                      alignSelf: 'start',
                      minHeight: 44,
                      padding: '0 14px',
                      border: '1px dashed var(--border-2)',
                      borderRadius: 8,
                      background: 'transparent',
                      color: 'var(--accent, #2563eb)',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                    }}
                  >
                    <Plus size={15} aria-hidden="true" />Thêm kho
                  </button>
                ) : null}
              </div>
              <div style={gridStyle}>
                <div data-field-id="shipment-package-type"><SelectField id="shipment-package-type" label="Quy cách đóng gói" value={form.packageType} onChange={(event) => update('packageType', event.target.value)} disabled={Boolean(saving)} error={issueByField.get('shipment-package-type')} options={[{ value: '', label: '— Chọn quy cách —' }, { value: 'Pallet', label: 'Pallet' }, { value: 'Roll', label: 'Roll' }, { value: 'Carton', label: 'Carton' }]} /></div>
                <div data-field-id="shipment-package-count"><TextField id="shipment-package-count" label="Số lượng" type="number" min="1" step="1" value={form.packageCount} onChange={(event) => update('packageCount', event.target.value)} disabled={Boolean(saving)} error={issueByField.get('shipment-package-count')} /></div>
                <div data-field-id="shipment-cargo-weight"><TextField id="shipment-cargo-weight" label="Trọng lượng (kg)" type="number" min="0" step="0.01" value={form.cargoWeightKg} onChange={(event) => update('cargoWeightKg', event.target.value)} disabled={Boolean(saving)} error={issueByField.get('shipment-cargo-weight')} /></div>
                <div data-field-id="shipment-cargo-volume"><TextField id="shipment-cargo-volume" label="Thể tích (CBM)" type="number" min="0" step="0.001" value={form.cargoVolumeCbm} onChange={(event) => update('cargoVolumeCbm', event.target.value)} disabled={Boolean(saving)} error={issueByField.get('shipment-cargo-volume')} /></div>
              </div>
            </div>
          )}
        </ShipmentCreateSection>

        <ShipmentCreateSection id="schedule" number="04" title="Lịch & ghi chú" description="Các hạn vận hành và lưu ý để điều phối thực hiện đúng kế hoạch.">
          <div style={gridStyle}>
            <TextField label="Hạn hoàn tất hải quan" type="datetime-local" value={form.customsCutoffAt} onChange={(event) => update('customsCutoffAt', event.target.value)} disabled={Boolean(saving)} />
            <TextField label="Hạn hạ container tại cảng" type="datetime-local" value={form.closingAt} onChange={(event) => update('closingAt', event.target.value)} disabled={Boolean(saving)} />
            <TextField label="Thời điểm trả container" type="datetime-local" value={form.plannedReturnAt} onChange={(event) => update('plannedReturnAt', event.target.value)} disabled={Boolean(saving)} />
            {form.cargoMode === 'LCL' && <div data-field-id="shipment-expected-delivery"><DateField id="shipment-expected-delivery" label="Ngày giao dự kiến" value={form.expectedDeliveryDate} onChange={(event) => update('expectedDeliveryDate', event.target.value)} disabled={Boolean(saving)} error={issueByField.get('shipment-expected-delivery')} /></div>}
          </div>
          {form.cargoMode === 'LCL' && (
            <div className="csc-extra-dates">
              {form.extraDeliveryDates.map((date, index) => (
                <div key={index} className="csc-extra-dates__row">
                  <DateField label={index === 0 ? 'Ngày giao bổ sung' : ''} value={date} onChange={(event) => update('extraDeliveryDates', form.extraDeliveryDates.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} disabled={Boolean(saving)} />
                  <button type="button" className="csc-icon-button csc-icon-button--danger" aria-label={`Xóa ngày giao bổ sung ${index + 1}`} onClick={() => update('extraDeliveryDates', form.extraDeliveryDates.filter((_, itemIndex) => itemIndex !== index))} disabled={Boolean(saving)}><Trash2 size={16} /></button>
                </div>
              ))}
              <button type="button" className="csc-utility-button csc-utility-button--dashed" onClick={() => update('extraDeliveryDates', [...form.extraDeliveryDates, ''])} disabled={Boolean(saving)}><Plus size={15} aria-hidden="true" />Thêm ngày giao</button>
            </div>
          )}
          <TextAreaField label="Ghi chú thu khách" value={customerNotes} onChange={(event) => { setCustomerNotes(event.target.value); clearFeedback(); }} rows={3} maxLength={2000} placeholder="Khoản thu, cước hoặc lưu ý cần theo dõi với khách hàng" disabled={Boolean(saving)} />
          <TextAreaField label="Ghi chú điều xe" value={form.operationalNotes} onChange={(event) => update('operationalNotes', event.target.value)} rows={4} maxLength={2000} placeholder="Lưu ý đặc biệt cho Điều vận và Lái xe" disabled={Boolean(saving)} />
        </ShipmentCreateSection>

        </div>
        <ShipmentCreateSummary
          readiness={readiness}
          validationIssues={validationIssues}
          saving={saving}
          submitError={submitError}
          onFocusIssue={focusIssue}
          onCreate={() => void save('DRAFT')}
          onCancel={goBack}
        />
      </form>
      <OperationalSiteDetailsDialog site={detailSite} isOpen={Boolean(detailSite)} onClose={() => setDetailSite(null)} />
      <OperationalSiteCreateDialog
        isOpen={createSiteDialog.open && Boolean(form.customerId)}
        customerId={Number(form.customerId)}
        defaultSiteType={createSiteDialog.siteType}
        onClose={() => setCreateSiteDialog((current) => ({ ...current, open: false }))}
        onCreated={handleSiteCreated}
      />
      <Modal
        isOpen={backConfirmOpen}
        title="Bỏ tạo lô hàng?"
        onClose={() => setBackConfirmOpen(false)}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setBackConfirmOpen(false)}>Tiếp tục nhập</button>
            <button type="button" className="btn btn--secondary" onClick={discardAndGoBack}>Bỏ thay đổi và quay lại</button>
          </>
        )}
      >
        <p>Thông tin chưa lưu sẽ bị mất. Hãy tạo lô hàng hoặc xác nhận bỏ thay đổi.</p>
      </Modal>
    </div>
  );
}
