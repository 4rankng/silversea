import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useShipmentReferenceDuplicateGuard } from './use-shipment-reference-duplicate-guard';
import { ShipmentReferenceConflictWarning } from './ShipmentReferenceConflictWarning';
import { mergeCustomer, mergePort, mergeRoute } from './catalogMerger';
import { OperationalSiteDetailsDialog } from '../../../components/shipment/OperationalSiteDetailsDialog';
import { OperationalSiteCreateDialog } from '../../../components/shipment/OperationalSiteCreateDialog';
import { CustomerCreateDialog } from './CustomerCreateDialog';
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
import { ShipmentContainerCell } from './ShipmentContainerCell';
import { ShippingLineAddDialog } from './ShippingLineAddDialog';
import { RouteCreateDialog } from './RouteCreateDialog';
import { PortCreateDialog } from './PortCreateDialog';
import { ContainerTypeCellPicker } from './ContainerTypeCellPicker';
import { DEFAULT_SHIPPING_LINES, type Customer, type Port, type Route } from '@tingting/shared';
import { useShipmentCreateWorkflow } from './use-shipment-create-workflow';
import { Modal } from '../../../components/UI';
import '../../../pages/clerk/ClerkShipmentCreatePage.css';

type FormState = ShipmentCreateFormState;
type ContainerRow = ShipmentContainerDraft;

const EMPTY_FORM = EMPTY_SHIPMENT_CREATE_FORM;
const newContainer = createEmptyContainer;

const gridStyle = shipmentCreateGridStyle;

function formatContainerWeight(value: string) {
  if (!value.trim()) return '';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(parsed);
}

function formatContainerAppointment(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

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
  // Pending intents for the two destructive guards below: the requested mode
  // / container row is stashed while its Modal confirm is open, so the change
  // only lands after explicit confirmation (no native window.confirm).
  const [pendingModeSwitch, setPendingModeSwitch] = useState<CargoMode | null>(null);
  const [pendingContainerDelete, setPendingContainerDelete] = useState<ContainerRow | null>(null);
  const [shippingLineDialogOpen, setShippingLineDialogOpen] = useState(false);
  const shippingLineAddButtonRef = useRef<HTMLButtonElement>(null);
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const routeAddButtonRef = useRef<HTMLButtonElement>(null);
  // Customer feedback 2026-09-07 (BL `JJCTCHPDY260305`): duplicate-guard
  // hook owns the debounce + 409 toast + server-conflict splicing.
  const { getConflict: getReferenceConflict, reportServerConflict } = useShipmentReferenceDuplicateGuard({
    blNumber: form.blNumber,
    bookingRef: form.bookingRef,
    declarationNumber: form.declarationNumber,
    tradeDirection: form.tradeDirection,
  });
  // Container-row target for the route dialog (null = the LCL form-level field).
  const [routeDialogTargetKey, setRouteDialogTargetKey] = useState<string | null>(null);
  // Port dialog + which container cell asked for it.
  const [portDialog, setPortDialog] = useState<{ open: boolean; target: { key: string; field: 'pickupPortId' | 'dropoffPortId' } | null }>({ open: false, target: null });
  // Container-type dialog — extracted to useContainerTypeCreate so the
  // workspace stays under its frozen ceiling (structure guard ratchet).
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const customerAddButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    tripClient.getBootstrap()
      .then((value) => { if (!cancelled) setCatalogs(value); })
      .catch(() => { if (!cancelled) setLoadError('Không thể tải dữ liệu danh mục'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Catalogs (customers, routes, etc.) are otherwise fetched once on mount
  // and never refreshed, so a customer created elsewhere (another tab, the
  // admin customer submission) must survive revalidation — same for an
  // inline-created route. Merge rather than replace those lists; everything
  // else takes the fresh bootstrap wholesale.
  useEffect(() => {
    let revalidateInFlight = false;
    let revalidatePending = false;
    function revalidateCatalogs() {
      // Both focus AND visibilitychange fire for one tab return; coalesce
      // them into a single request instead of double-fetching.
      if (revalidateInFlight) {
        revalidatePending = true;
        return;
      }
      if (loading || document.visibilityState === 'hidden') return;
      revalidateInFlight = true;
      tripClient.getBootstrap().then((fresh) => {
        setCatalogs((current) => current ? {
          ...fresh,
          customers: [
            ...fresh.customers,
            ...current.customers.filter((known) => !fresh.customers.some((item) => item.id === known.id)),
          ],
          routes: [
            ...fresh.routes,
            ...current.routes.filter((known) => !fresh.routes.some((item) => item.id === known.id)),
          ],
        } : fresh);
      }).catch(() => {}).finally(() => {
        revalidateInFlight = false;
        if (revalidatePending) {
          revalidatePending = false;
          revalidateCatalogs();
        }
      });
    }
    window.addEventListener('focus', revalidateCatalogs);
    document.addEventListener('visibilitychange', revalidateCatalogs);
    return () => {
      window.removeEventListener('focus', revalidateCatalogs);
      document.removeEventListener('visibilitychange', revalidateCatalogs);
    };
  }, [loading]);

  useEffect(() => {
    if (!form.customerId) { setSites([]); return; }
    let cancelled = false;
    setSitesLoading(true);
    listOperationalSites(Number(form.customerId))
      .then((value) => { if (!cancelled) setSites(value); })
      .catch(() => { if (!cancelled) reportError('Không thể tải danh sách nhà máy của khách hàng'); })
      .finally(() => { if (!cancelled) setSitesLoading(false); });
    return () => { cancelled = true };
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

  // Per-field conflict via the shared duplicate-guard hook.
  const billConflict = getReferenceConflict('blNumber', form.blNumber);
  const bookingConflict = getReferenceConflict('bookingRef', form.bookingRef);
  const declarationConflict = getReferenceConflict('declaration', form.declarationNumber);

  // Stable option arrays: USearchableField's type-to-search effect keys on
  // the `options` identity, so a freshly-mapped array on every render would
  // wipe the clerk's in-progress typed filter on any unrelated re-render.
  const mapOptions = <T extends { id: number; name: string }>(items: T[] | undefined) =>
    (items ?? []).map((item) => ({ value: String(item.id), label: item.name }));
  const customerOptions = useMemo(() => mapOptions(catalogs?.customers), [catalogs]);
  const routeOptions = useMemo(() => mapOptions(catalogs?.routes), [catalogs]);
  const portOptions = useMemo(() => mapOptions(catalogs?.ports), [catalogs]);
  const shippingLineOptions = useMemo(() => {
    const list = catalogs?.shippingLines?.length
      ? catalogs.shippingLines.map((s) => s.name)
      : Array.from(DEFAULT_SHIPPING_LINES);
    return list.map((name) => ({ value: name, label: name }));
  }, [catalogs]);
  const isDirty = useMemo(() => {
    const hasFormData = Object.entries(form).some(([key, value]) => (
      key === 'cargoMode' ? value !== EMPTY_FORM.cargoMode
        : key === 'isCombined' ? value !== EMPTY_FORM.isCombined
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
    onDuplicateConflict: reportServerConflict,
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => key === 'tradeDirection'
      ? {
        ...current,
        tradeDirection: value as FormState['tradeDirection'],
        ...(value === 'IMPORT' ? { bookingRef: '' } : value === 'EXPORT' ? { blNumber: '' } : {}),
      }
      : { ...current, [key]: value });
    clearFeedback();
  }

  function selectCustomer(value: string) {
    setForm((current) => ({ ...current, customerId: value, operationalSiteId: '', pickupWarehouseSiteId: '' }));
    setSites([]);
    clearFeedback();
  }

  // ── Lệnh chạy ngoài (MasterDataNhaMay §4.2): free-text passthrough ──────
  // An exact option-label match selects the catalog id; anything else becomes
  // the raw text with a cleared id (Case 2 hybrid storage).
  function customerCustomText(text: string) {
    const match = customerOptions.find((option) => option.label === text);
    if (match) { selectCustomer(match.value); return; }
    setForm((current) => ({ ...current, customerId: '', rawCustomerName: text }));
    clearFeedback();
  }

  function routeCustomText(text: string) {
    const match = routeOptions.find((option) => option.label === text);
    if (match) { update('routeId', match.value); return; }
    setForm((current) => ({ ...current, routeId: '', rawRouteName: text }));
    clearFeedback();
  }

  function factoryCustomText(text: string) {
    const match = operationalSites.find((site) => (site.shortName || site.name) === text);
    if (match) { selectOperationalSite(String(match.id)); return; }
    setForm((current) => ({ ...current, operationalSiteId: '', factoryName: text }));
    clearFeedback();
  }

  /** Per-container port free text (§4.2): exact label → catalog id, else raw. */
  function portCustomText(
    rowKey: string,
    idField: 'pickupPortId' | 'dropoffPortId',
    rawField: 'rawPickupPortName' | 'rawDropoffPortName',
    text: string,
  ) {
    const match = portOptions.find((option) => option.label === text);
    if (match) { updateContainer(rowKey, idField, match.value); return; }
    updateContainer(rowKey, idField, '');
    updateContainer(rowKey, rawField, text);
  }

  /**
   * Factory-route authority (master-data spec 2026-09-06): a factory with a
   * configured route owns the shipment/container route — the route field
   * auto-fills and locks. Returns '' when the factory has no route so manual
   * selection stays allowed (no dead-end).
   */
  function routeIdForSite(siteId: string): string {
    if (!siteId) return '';
    const site = operationalSites.find((item) => String(item.id) === siteId);
    return site?.routeId != null ? String(site.routeId) : '';
  }

  function selectOperationalSite(value: string) {
    const derivedRouteId = routeIdForSite(value);
    setForm((current) => ({
      ...current,
      operationalSiteId: value,
      ...(derivedRouteId ? { routeId: derivedRouteId } : {}),
    }));
    clearFeedback();
  }

  function selectContainerFactory(key: string, value: string) {
    const derivedRouteId = routeIdForSite(value);
    setContainers((current) => current.map((row) => row.key === key
      ? { ...row, operationalSiteId: value, ...(derivedRouteId ? { routeId: derivedRouteId } : {}) }
      : row));
    clearFeedback();
  }

  function closeShippingLineDialog() {
    setShippingLineDialogOpen(false);
    queueMicrotask(() => shippingLineAddButtonRef.current?.focus());
  }

  function applyShippingLine(name: string) {
    update('shippingLineName', name);
    setCatalogs((prev) => {
      if (!prev) return prev;
      const existing = prev.shippingLines ?? [];
      if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) return prev;
      return { ...prev, shippingLines: [...existing, { name }] };
    });
    closeShippingLineDialog();
  }

  function closeRouteDialog() {
    setRouteDialogOpen(false);
    setRouteDialogTargetKey(null);
    queueMicrotask(() => routeAddButtonRef.current?.focus());
  }

  function handleRouteCreated(route: Route) {
    addRouteToCatalog(route);
    if (routeDialogTargetKey) {
      updateContainer(routeDialogTargetKey, 'routeId', String(route.id));
    } else {
      update('routeId', String(route.id));
    }
    closeRouteDialog();
  }

  function closePortDialog() {
    setPortDialog({ open: false, target: null });
  }

  /**
   * A port/yard created inline from a container cell (Cảng nâng/hạ) joins
   * the catalog and is selected straight into the cell that asked for it.
   */
  function handlePortCreated(port: Port) {
    mergePort(catalogs, port, setCatalogs);
    const target = portDialog.target;
    if (target) updateContainer(target.key, target.field, String(port.id));
    setPortDialog({ open: false, target: null });
  }

  function closeCustomerDialog() {
    setCustomerDialogOpen(false);
    queueMicrotask(() => customerAddButtonRef.current?.focus());
  }

  function handleCustomerCreated(customer: Customer) {
    mergeCustomer(catalogs, customer, setCatalogs);
    selectCustomer(String(customer.id));
    closeCustomerDialog();
  }

  function addRouteToCatalog(route: Route) {
    mergeRoute(catalogs, route, setCatalogs);
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
      const derivedRouteId = site.routeId != null ? String(site.routeId) : '';
      if (form.cargoMode === 'FCL') {
        setContainers((current) => {
          const target = current.find((row) => !row.operationalSiteId) ?? current[0];
          return current.map((row) => row.key === target?.key
            ? { ...row, operationalSiteId: String(site.id), ...(derivedRouteId ? { routeId: derivedRouteId } : {}) }
            : row);
        });
      } else {
        update('operationalSiteId', String(site.id));
        if (derivedRouteId) update('routeId', derivedRouteId);
      }
    } else {
      update('pickupWarehouseSiteId', String(site.id));
    }
  }

  function changeMode(next: CargoMode) {
    if (next === form.cargoMode) return;
    const hasModeData = form.cargoMode === 'LCL'
      ? Boolean(form.packageType || form.packageCount || form.cargoVolumeCbm || form.extraDeliveryDates.some(Boolean))
      : containers.some((row) => Object.entries(row).some(([key, value]) => key !== 'key' && value));
    if (hasModeData) {
      setPendingModeSwitch(next);
      return;
    }
    applyModeSwitch(next);
  }

  function applyModeSwitch(next: CargoMode) {
    setForm((current) => ({
      ...current,
      cargoMode: next,
      cargoTypeId: next === 'FCL' ? '' : current.cargoTypeId,
      operationalSiteId: next === 'LCL' ? current.operationalSiteId : '',
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

  function removeContainer(row: ContainerRow) {
    const hasEnteredData = Object.entries(row).some(([key, value]) => key !== 'key' && value !== '');
    if (hasEnteredData) {
      setPendingContainerDelete(row);
      return;
    }
    discardContainer(row);
  }

  function discardContainer(row: ContainerRow) {
    setContainers((current) => current.filter((item) => item.key !== row.key));
    clearFeedback();
  }

  function confirmModeSwitch() {
    const next = pendingModeSwitch;
    setPendingModeSwitch(null);
    if (next) applyModeSwitch(next);
  }

  function confirmContainerDelete() {
    const row = pendingContainerDelete;
    setPendingContainerDelete(null);
    if (row) discardContainer(row);
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
      {/* The H1 used to be class="sr-only" (1x1px absolute, Tailwind's
       * accessibility hide). Some Chromium versions refused to paint
       * any sibling of an absolutely-positioned 1x1px element when the
       * surrounding .app shell had a different role, so admin landed on
       * a fully blank page while CUS rendered fine. Render the H1
       * inline in the breadcrumb area instead — keeps a11y (text is
       * reachable) and removes the layout-side effect. */}
      <h1 className="csc-page__title">Tạo lô hàng</h1>
      <form onSubmit={(event) => { event.preventDefault(); void save('DRAFT'); }} className="csc-workspace">
        <div className="csc-form">
        {/* Lệnh chạy ngoài (MasterDataNhaMay §4.1) — fixed at the very top of
            the intake form, visible without scrolling. Toggling never clears
            typed data; it only switches validation + field locking. */}
        <label className="csc-adhoc-toggle" data-field-id="shipment-is-adhoc">
          <input
            type="checkbox"
            checked={form.isAdHoc}
            onChange={(event) => update('isAdHoc', event.target.checked)}
            disabled={Boolean(saving)}
          />
          <span>Lệnh chạy ngoài (Tối ưu xe rỗng)</span>
        </label>
        <ShipmentCreateSection id="identity" title="Nhận diện lô" description="Khách hàng, chứng từ và hướng xuất nhập khẩu.">
          <div className="csc-identity-grid">
            {/* KHÁCH HÀNG */}
            <div className="csc-identity-grid__customer csc-customer-picker" data-field="shipment-customer" data-field-id="shipment-customer">
              <SearchableField
                id="shipment-customer"
                label="Khách hàng"
                required
                value={form.customerId}
                onChange={selectCustomer}
                options={customerOptions}
                placeholder={form.isAdHoc ? 'Chọn hoặc gõ tên mới' : 'Gõ để tìm kiếm'}
                disabled={Boolean(saving)}
                error={issueByField.get('shipment-customer')}
                className="csc-customer-field"
                popoverClassName="csc-customer-popover"
                optionClassName="csc-customer-option"
                searchable
                {...(form.isAdHoc ? { onCustomValue: customerCustomText } : {})}
                popoverPlacement="top"
              />
              <button
                ref={customerAddButtonRef}
                type="button"
                onClick={() => setCustomerDialogOpen(true)}
                disabled={Boolean(saving)}
                className="csc-utility-button csc-utility-button--dashed csc-customer-picker__add"
              >
                <Plus size={15} aria-hidden="true" />Thêm khách hàng
              </button>
            </div>

            <div className="csc-identity-grid__trade-direction" data-field-id="shipment-trade-direction"><SelectField id="shipment-trade-direction" label="Hình thức xuất nhập khẩu" required value={form.tradeDirection} onChange={(event) => update('tradeDirection', event.target.value as FormState['tradeDirection'])} disabled={Boolean(saving)} error={issueByField.get('shipment-trade-direction')} options={[{ value: '', label: '— Chọn hình thức —' }, { value: 'IMPORT', label: 'Nhập khẩu' }, { value: 'EXPORT', label: 'Xuất khẩu' }]} /></div>

            <div className="csc-identity-grid__booking" data-field-id="shipment-booking-ref"><TextField id="shipment-booking-ref" label="Số Bill/Booking" required value={form.tradeDirection === 'IMPORT' ? form.blNumber : form.bookingRef} onChange={(event) => update(form.tradeDirection === 'IMPORT' ? 'blNumber' : 'bookingRef', event.target.value)} maxLength={100} placeholder={form.tradeDirection === 'IMPORT' ? 'Nhập số Bill (hàng Nhập)' : form.tradeDirection === 'EXPORT' ? 'Nhập số Booking (hàng Xuất)' : 'Chọn Nhập hoặc Xuất'} disabled={!form.tradeDirection || Boolean(saving)} error={issueByField.get('shipment-booking-ref')} warning={(form.tradeDirection === 'IMPORT' ? billConflict : bookingConflict) ? <ShipmentReferenceConflictWarning conflict={form.tradeDirection === 'IMPORT' ? billConflict : bookingConflict} fieldLabel={form.tradeDirection === 'IMPORT' ? 'Số Bill' : 'Số Booking'} /> : undefined} /></div>

            {form.cargoMode === 'FCL' && (
              <div className="csc-identity-grid__shipping-line csc-shipping-line-picker" data-field-id="shipment-shipping-line">
                <SearchableField id="shipment-shipping-line" label="Hãng tàu" value={form.shippingLineName} onChange={(value) => update('shippingLineName', value)} allowsCustomValue options={shippingLineOptions} placeholder="Gõ chọn hoặc nhập hãng tàu" disabled={Boolean(saving)} error={issueByField.get('shipment-shipping-line')} searchable popoverPlacement="top" />
                <button
                  ref={shippingLineAddButtonRef}
                  type="button"
                  onClick={() => setShippingLineDialogOpen(true)}
                  disabled={Boolean(saving)}
                  className="csc-utility-button csc-utility-button--dashed csc-shipping-line-picker__add"
                >
                  <Plus size={15} aria-hidden="true" />Thêm hãng tàu
                </button>
              </div>
            )}

            {/* SỐ TỜ KHAI */}
            <div className="csc-identity-grid__declaration"><TextField label="Số tờ khai" value={form.declarationNumber} onChange={(event) => update('declarationNumber', event.target.value)} maxLength={100} disabled={Boolean(saving)} warning={declarationConflict ? <ShipmentReferenceConflictWarning conflict={declarationConflict} fieldLabel="Số tờ khai" /> : undefined} /></div>

          </div>
        </ShipmentCreateSection>

        {form.cargoMode === 'LCL' && <ShipmentCreateSection id="route" title="Điểm vận hành & tuyến" description="Chọn tuyến và điểm giao hoặc lấy hàng theo hình thức lô.">
          <div style={gridStyle}>
            <div className="csc-route-picker" data-field-id="shipment-route">
              <SearchableField
                id="shipment-route"
                label="Tuyến đường"
                required
                value={form.routeId}
                onChange={(value) => update('routeId', value)}
                options={routeOptions}
                placeholder={form.isAdHoc ? 'Chọn hoặc gõ tên tuyến' : 'Gõ chọn'}
                disabled={Boolean(saving) || (!form.isAdHoc && selectedOperationalSite?.routeId != null)}
                error={issueByField.get('shipment-route')}
                searchable
                {...(form.isAdHoc ? { onCustomValue: routeCustomText } : {})}
                popoverPlacement="top"
              />
              {selectedOperationalSite?.routeId == null && (
                <button
                  ref={routeAddButtonRef}
                  type="button"
                  onClick={() => setRouteDialogOpen(true)}
                  disabled={Boolean(saving)}
                  className="csc-utility-button csc-utility-button--dashed csc-route-picker__add"
                >
                  <Plus size={15} aria-hidden="true" />Thêm tuyến đường
                </button>
              )}
            </div>
            <div className="csc-site-picker">
              <SearchableField
                id="shipment-operational-site"
                label="Nhà máy"
                value={form.operationalSiteId}
                onChange={selectOperationalSite}
              options={operationalSites.map((site) => ({ value: String(site.id), label: site.shortName || site.name, searchText: `${site.name} ${site.address ?? ''}` }))}
                placeholder={sitesLoading ? 'Đang tải…' : !form.customerId && !form.isAdHoc ? 'Chọn khách hàng trước' : form.isAdHoc ? 'Chọn hoặc gõ tên nhà máy' : 'Gõ chọn'}
                disabled={(!form.customerId && !form.isAdHoc) || sitesLoading || Boolean(saving)}
                error={issueByField.get('shipment-operational-site')}
                {...(form.isAdHoc ? { onCustomValue: factoryCustomText } : {})}
                hint={form.customerId && !sitesLoading && operationalSites.length === 0
                    ? <>Chưa có nhà máy.{' '}<button type="button" onClick={(e) => { e.preventDefault(); openCreateSiteDialog('FACTORY'); }} disabled={Boolean(saving)} style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent, #2563eb)', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Thêm mới</button></>
                    : undefined}
                searchable
                popoverPlacement="top"
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
            {selectedOperationalSite && (
              <div data-field-id="shipment-site-address">
                <TextField
                  id="shipment-site-address"
                  label="Vị trí đóng/trả hàng"
                  value={selectedOperationalSite.address}
                  disabled
                  onChange={() => {}}
                />
              </div>
            )}
          </div>

          {selectedOperationalSite?.strictRules && (
            <aside className="csc-site-guidance" role="note">
              <strong>Lưu ý tại nhà máy</strong>
              <p>{selectedOperationalSite.strictRules}</p>
            </aside>
          )}
        </ShipmentCreateSection>}

        <ShipmentCreateSection id="cargo" title="Thông tin hàng" description="Nhập chi tiết phù hợp với hàng nguyên container hoặc hàng lẻ.">
          <div className="csc-cargo-choice-grid">
            <fieldset className="csc-mode" aria-required="true"><legend>Loại hàng <span aria-hidden="true">*</span></legend><div>
              {(['FCL', 'LCL'] as CargoMode[]).map((mode) => <label key={mode}><input type="radio" name="cargo-mode" value={mode} checked={form.cargoMode === mode} onChange={() => changeMode(mode)} disabled={Boolean(saving)} /><span className="csc-mode__option">{mode === 'FCL' ? 'Hàng nguyên container (Cont)' : 'Hàng lẻ'}</span></label>)}
            </div></fieldset>
            <label className="csc-combined-toggle">
              <input
                type="checkbox"
                checked={form.isCombined}
                onChange={(event) => update('isCombined', event.target.checked)}
                disabled={Boolean(saving)}
              />
              <span>
                <strong>Đóng kết hợp</strong>
              </span>
            </label>
          </div>
          {form.cargoMode === 'FCL' ? (
            <>
            <div className="csc-fcl-factory-action">
              <button
                type="button"
                onClick={() => openCreateSiteDialog('FACTORY')}
                disabled={Boolean(saving)}
                className="csc-utility-button csc-utility-button--dashed"
              >
                <Plus size={15} aria-hidden="true" />Thêm nhà máy
              </button>
            </div>
            <ShipmentContainerEditor
              saving={Boolean(saving)}
              onAdd={(count) => setContainers((current) => {
                const source = current[current.length - 1];
                return [
                  ...current,
                  ...Array.from({ length: count }, () => {
                    const next = createContainerFromPrevious(source);
                    return next;
                  }),
                ];
              })}
              rows={<>{containers.map((row, index) => {
                const containerType = (catalogs.containerTypes ?? []).find((item) => String(item.id) === row.containerTypeId);
                const pickupPort = (catalogs.ports ?? []).find((item) => String(item.id) === row.pickupPortId);
                const dropoffPort = (catalogs.ports ?? []).find((item) => String(item.id) === row.dropoffPortId);
                const factory = operationalSites.find((site) => String(site.id) === row.operationalSiteId);
                return (
                <tr key={row.key} className="csc-container-row">
                  <th scope="row" className="csc-container-row__index">
                    <span className="csc-container-row__desktop-index">{index + 1}</span>
                    <span className="csc-container-row__mobile-index">Container {index + 1}</span>
                  </th>
                  <ShipmentContainerCell
                    label="Số container"
                    value={row.containerNumber}
                    placeholder="Nhập số container"
                    fieldId={`container-${row.key}-number`}
                    error={issueByField.get(`container-${row.key}-number`)}
                    onRevert={(value) => updateContainer(row.key, 'containerNumber', value)}
                  >
                    <TextField id={`container-${row.key}-number`} label="Số container" hideLabel value={row.containerNumber} onChange={(event) => updateContainer(row.key, 'containerNumber', event.target.value.toUpperCase())} disabled={Boolean(saving)} error={issueByField.get(`container-${row.key}-number`)} />
                  </ShipmentContainerCell>
                  <ShipmentContainerCell
                    label="Loại container *"
                    value={containerType?.code ?? ''}
                    placeholder="Chọn loại"
                    displayTitle={containerType ? `${containerType.code} — ${containerType.name}` : undefined}
                    fieldId={`container-${row.key}-type`}
                    error={issueByField.get(`container-${row.key}-type`)}
                  >
                    <ContainerTypeCellPicker
                      value={row.containerTypeId}
                      onChange={(value) => updateContainer(row.key, 'containerTypeId', value)}
                      options={catalogs.containerTypes ?? []}
                      fieldId={`container-${row.key}-type`}
                      saving={Boolean(saving)}
                      error={issueByField.get(`container-${row.key}-type`)}
                    />
                  </ShipmentContainerCell>
                  <ShipmentContainerCell
                    label="Nhà máy *"
                    value={factory?.shortName || factory?.name || ''}
                    placeholder="Chọn nhà máy"
                    subValue={factory?.address || undefined}
                    fieldId={`container-${row.key}-factory`}
                    error={issueByField.get(`container-${row.key}-factory`)}
                  >
                    <SearchableField
                      id={`container-${row.key}-factory`}
                      label="Nhà máy"
                      hideLabel
                      required
                      value={row.operationalSiteId}
                      onChange={(value) => selectContainerFactory(row.key, value)}
                      options={operationalSites.map((site) => ({
                        value: String(site.id),
                        label: site.shortName || site.name,
                        searchText: `${site.name} ${site.address ?? ''}`,
                      }))}
                      placeholder="Chọn nhà máy"
                      disabled={!form.customerId || sitesLoading || Boolean(saving)}
                      error={issueByField.get(`container-${row.key}-factory`)}
                      searchable
                    />
                  </ShipmentContainerCell>
                  <ShipmentContainerCell
                    label="Tuyến đường *"
                    value={(catalogs.routes ?? []).find((item) => String(item.id) === row.routeId)?.name ?? ''}
                    placeholder="Chọn tuyến đường"
                    fieldId={`container-${row.key}-route`}
                    error={issueByField.get(`container-${row.key}-route`)}
                  >
                    <div className="csc-route-picker">
                      <SearchableField
                        id={`container-${row.key}-route`}
                        label="Tuyến đường"
                        hideLabel
                        required
                        value={row.routeId}
                        onChange={(value) => updateContainer(row.key, 'routeId', value)}
                        options={routeOptions}
                        placeholder="Chọn tuyến đường"
                        disabled={Boolean(saving) || factory?.routeId != null}
                        error={issueByField.get(`container-${row.key}-route`)}
                        searchable
                        popoverPlacement="top"
                      />
                      {factory?.routeId == null && (
                        <button
                          type="button"
                          className="csc-utility-button csc-utility-button--dashed csc-route-picker__add"
                          onClick={() => { setRouteDialogTargetKey(row.key); setRouteDialogOpen(true); }}
                          disabled={Boolean(saving)}
                        >
                          <Plus size={15} aria-hidden="true" />Thêm
                        </button>
                      )}
                    </div>
                  </ShipmentContainerCell>
                  <ShipmentContainerCell
                    label="Cảng nâng"
                    value={pickupPort?.name ?? ''}
                    placeholder="Chọn cảng nâng"
                    fieldId={`container-${row.key}-pickup-port`}
                    error={issueByField.get(`container-${row.key}-pickup-port`)}
                  >
                    <div className="csc-route-picker">
                      <SearchableField id={`container-${row.key}-pickup-port`} label="Cảng nâng" hideLabel value={row.pickupPortId} onChange={(value) => updateContainer(row.key, 'pickupPortId', value)} options={portOptions} placeholder={form.isAdHoc ? 'Chọn hoặc gõ tên cảng' : 'Chọn cảng nâng'} disabled={Boolean(saving)} error={issueByField.get(`container-${row.key}-pickup-port`)} searchable {...(form.isAdHoc ? { onCustomValue: (text: string) => portCustomText(row.key, 'pickupPortId', 'rawPickupPortName', text) } : {})} popoverPlacement="top" />
                      <button
                        type="button"
                        className="csc-utility-button csc-utility-button--dashed csc-route-picker__add"
                        onClick={() => setPortDialog({ open: true, target: { key: row.key, field: 'pickupPortId' } })}
                        disabled={Boolean(saving)}
                      >
                        <Plus size={15} aria-hidden="true" />Thêm
                      </button>
                    </div>
                  </ShipmentContainerCell>
                  <ShipmentContainerCell
                    label="Cảng hạ"
                    value={dropoffPort?.name ?? ''}
                    placeholder="Chọn cảng hạ"
                    fieldId={`container-${row.key}-dropoff-port`}
                    error={issueByField.get(`container-${row.key}-dropoff-port`)}
                  >
                    <div className="csc-route-picker">
                      <SearchableField id={`container-${row.key}-dropoff-port`} label="Cảng hạ" hideLabel value={row.dropoffPortId} onChange={(value) => updateContainer(row.key, 'dropoffPortId', value)} options={portOptions} placeholder={form.isAdHoc ? 'Chọn hoặc gõ tên cảng' : 'Chọn cảng hạ'} disabled={Boolean(saving)} error={issueByField.get(`container-${row.key}-dropoff-port`)} searchable {...(form.isAdHoc ? { onCustomValue: (text: string) => portCustomText(row.key, 'dropoffPortId', 'rawDropoffPortName', text) } : {})} popoverPlacement="top" />
                      <button
                        type="button"
                        className="csc-utility-button csc-utility-button--dashed csc-route-picker__add"
                        onClick={() => setPortDialog({ open: true, target: { key: row.key, field: 'dropoffPortId' } })}
                        disabled={Boolean(saving)}
                      >
                        <Plus size={15} aria-hidden="true" />Thêm
                      </button>
                    </div>
                  </ShipmentContainerCell>
                  <ShipmentContainerCell
                    label="Trọng lượng (kg)"
                    value={formatContainerWeight(row.cargoWeightKg)}
                    placeholder="Nhập kg"
                    className="csc-container-cell--numeric"
                    onRevert={(value) => updateContainer(row.key, 'cargoWeightKg', value)}
                  >
                    <TextField label="Trọng lượng (kg)" hideLabel type="number" min="0" step="0.01" value={row.cargoWeightKg} onChange={(event) => updateContainer(row.key, 'cargoWeightKg', event.target.value)} disabled={Boolean(saving)} />
                  </ShipmentContainerCell>
                  <ShipmentContainerCell
                    label="Ngày giờ đóng trả"
                    value={formatContainerAppointment(row.customerAppointmentAt)}
                    placeholder="Chọn ngày giờ"
                    fieldId={`container-${row.key}-customer-appointment`}
                    error={issueByField.get(`container-${row.key}-customer-appointment`)}
                    onRevert={(value) => updateContainer(row.key, 'customerAppointmentAt', value)}
                  >
                    <TextField id={`container-${row.key}-customer-appointment`} label="Ngày giờ đóng trả" hideLabel required type="datetime-local" value={row.customerAppointmentAt} onChange={(event) => updateContainer(row.key, 'customerAppointmentAt', event.target.value)} disabled={Boolean(saving)} error={issueByField.get(`container-${row.key}-customer-appointment`)} />
                  </ShipmentContainerCell>
                  <td className="csc-container-row__actions">{containers.length > 1 && <button type="button" className="csc-icon-button csc-icon-button--danger" aria-label={`Xóa container ${index + 1}`} onClick={() => removeContainer(row)}><Trash2 size={18} aria-hidden="true" /></button>}</td>
                </tr>
              );})}</>}
            />
            </>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div data-field-id="shipment-pickup-warehouse" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'stretch' }}>
                <SearchableField
                  id="shipment-pickup-warehouse"
                  label="Kho lấy hàng"
                  value={form.pickupWarehouseSiteId}
                  onChange={(value) => update('pickupWarehouseSiteId', value)}
                  options={warehouseSites.map((site) => ({ value: String(site.id), label: site.shortName || site.name, searchText: `${site.name} ${site.address ?? ''}` }))}
                  placeholder={sitesLoading ? 'Đang tải…' : !form.customerId ? 'Chọn khách hàng trước' : 'Chọn kho lấy hàng'}
                  disabled={!form.customerId || sitesLoading || Boolean(saving)}
                  error={issueByField.get('shipment-pickup-warehouse')}
                  hint={form.customerId && !sitesLoading && warehouseSites.length === 0
                      ? <>Chưa có kho cho khách hàng này.{' '}<button type="button" onClick={() => openCreateSiteDialog('WAREHOUSE')} disabled={Boolean(saving)} style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent, #2563eb)', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Thêm kho</button></>
                      : undefined}
                  searchable
                  popoverPlacement="top"
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
                {/* Quy cách đóng gói: free-text per customer request (2026-09-06).
                    Schema accepts any string up to 100 chars (shared/src/schemas/index.ts).
                    The previous hardcoded {Pallet, Roll, Carton} dropdown was too narrow —
                    customers have many other package types (Thùng, Bao, Can, Drum, ...). */}
                <div data-field-id="shipment-package-type"><TextField id="shipment-package-type" label="Quy cách đóng gói" value={form.packageType} onChange={(event) => update('packageType', event.target.value)} maxLength={100} placeholder="Ví dụ: Pallet, Roll, Carton, Thùng gỗ, Bao, Can…" disabled={Boolean(saving)} error={issueByField.get('shipment-package-type')} /></div>
                <div data-field-id="shipment-package-count"><TextField id="shipment-package-count" label="Số lượng" type="number" min="1" step="1" value={form.packageCount} onChange={(event) => update('packageCount', event.target.value)} disabled={Boolean(saving)} error={issueByField.get('shipment-package-count')} /></div>
                <div data-field-id="shipment-cargo-weight"><TextField id="shipment-cargo-weight" label="Trọng lượng (kg)" type="number" min="0" step="0.01" value={form.cargoWeightKg} onChange={(event) => update('cargoWeightKg', event.target.value)} disabled={Boolean(saving)} error={issueByField.get('shipment-cargo-weight')} /></div>
                <div data-field-id="shipment-cargo-volume"><TextField id="shipment-cargo-volume" label="Thể tích (CBM)" type="number" min="0" step="0.001" value={form.cargoVolumeCbm} onChange={(event) => update('cargoVolumeCbm', event.target.value)} disabled={Boolean(saving)} error={issueByField.get('shipment-cargo-volume')} /></div>
              </div>
            </div>
          )}
        </ShipmentCreateSection>

        <ShipmentCreateSection id="schedule" title="Lịch & ghi chú" description={form.cargoMode === 'FCL' ? undefined : 'Các hạn vận hành và lưu ý để điều phối thực hiện đúng kế hoạch.'}>
          {form.cargoMode === 'LCL' && <div style={gridStyle}>
            <TextField label="Hạn hoàn tất hải quan" type="datetime-local" value={form.customsCutoffAt} onChange={(event) => update('customsCutoffAt', event.target.value)} disabled={Boolean(saving)} />
            <TextField label="Hạn hạ container tại cảng" type="datetime-local" value={form.closingAt} onChange={(event) => update('closingAt', event.target.value)} disabled={Boolean(saving)} />
            <TextField label="Thời điểm trả container" type="datetime-local" value={form.plannedReturnAt} onChange={(event) => update('plannedReturnAt', event.target.value)} disabled={Boolean(saving)} />
            <div data-field-id="shipment-expected-delivery"><DateField id="shipment-expected-delivery" label="Ngày giao dự kiến" value={form.expectedDeliveryDate} onChange={(event) => update('expectedDeliveryDate', event.target.value)} disabled={Boolean(saving)} error={issueByField.get('shipment-expected-delivery')} /></div>
          </div>}
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
          <TextAreaField label="Ghi chú cho khách hàng" value={customerNotes} onChange={(event) => { setCustomerNotes(event.target.value); clearFeedback(); }} rows={3} maxLength={2000} placeholder="Thông tin cần gửi hoặc lưu ý cần theo dõi với khách hàng" disabled={Boolean(saving)} />
          <TextAreaField label="Ghi chú cho lái xe" value={form.operationalNotes} onChange={(event) => update('operationalNotes', event.target.value)} rows={4} maxLength={2000} placeholder="Hướng dẫn và lưu ý cần thiết cho lái xe" disabled={Boolean(saving)} />
        </ShipmentCreateSection>

        </div>
        <ShipmentCreateSummary
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
        routes={catalogs?.routes ?? []}
        onClose={() => setCreateSiteDialog((current) => ({ ...current, open: false }))}
        onCreated={handleSiteCreated}
        onRouteCreated={addRouteToCatalog}
      />
      <ShippingLineAddDialog
        isOpen={shippingLineDialogOpen}
        currentName={form.shippingLineName}
        onClose={closeShippingLineDialog}
        onApply={applyShippingLine}
      />
      <RouteCreateDialog
        isOpen={routeDialogOpen}
        onClose={closeRouteDialog}
        onCreated={handleRouteCreated}
      />
      <PortCreateDialog
        isOpen={portDialog.open}
        onClose={closePortDialog}
        onCreated={handlePortCreated}
      />
      <CustomerCreateDialog
        isOpen={customerDialogOpen}
        onClose={closeCustomerDialog}
        onCreated={handleCustomerCreated}
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
      <Modal
        isOpen={pendingModeSwitch !== null}
        title="Chuyển loại hàng?"
        onClose={() => setPendingModeSwitch(null)}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setPendingModeSwitch(null)}>Tiếp tục nhập</button>
            <button type="button" className="btn btn--secondary" onClick={confirmModeSwitch}>Chuyển và xóa dữ liệu</button>
          </>
        )}
      >
        <p>Chuyển sang {pendingModeSwitch} sẽ xóa dữ liệu hàng hóa đã nhập.</p>
      </Modal>
      <Modal
        isOpen={pendingContainerDelete !== null}
        title="Xóa container?"
        onClose={() => setPendingContainerDelete(null)}
        footer={(
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setPendingContainerDelete(null)}>Hủy</button>
            <button type="button" className="btn btn--secondary" onClick={confirmContainerDelete}>Xóa container</button>
          </>
        )}
      >
        <p>Xóa container này sẽ mất dữ liệu đã nhập.</p>
      </Modal>
    </div>
  );
}
