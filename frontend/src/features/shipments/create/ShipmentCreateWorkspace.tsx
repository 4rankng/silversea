import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Copy, Plus, Trash2 } from 'lucide-react';
import { formatDateTime24 } from '../../../lib/format';
import { EmptyState } from '../../../design-system';
import {
  UTextAreaField as TextAreaField,
  UDateField as DateField,
} from './uui-fields';
import { UDateTimeField } from './uui-datetime-field';
import { useToast } from '../../../components/shared/Toast';
import { CopyCodeButton } from '../../../components/trip/CopyCodeButton';
import { tripClient, type CatalogData } from '../../../api/tripClient';
import {
  createShippingLine,
  listOperationalSites,
  type OperationalSite,
} from '../../../api/shipmentClient';
import { useShipmentReferenceDuplicateGuard } from './use-shipment-reference-duplicate-guard';
import { mergeCustomer, mergePort, mergeRoute, mergeShippingLine } from './catalogMerger';
import {
  EMPTY_SHIPMENT_CREATE_FORM,
  createContainerFromPrevious,
  createEmptyContainer,
  getShipmentCreateReadiness,
  resetCustomerSite,
  type CargoMode,
  type SaveIntent,
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
  type ShipmentCreateIssue,
} from './shipment-create-model';
import { focusShipmentCreateIssue as focusIssue } from './shipment-create-focus';
import { ShipmentCreateSummary } from './ShipmentCreateSummary';
import { ShipmentCreateTopline } from './ShipmentCreateTopline';
import { ShipmentCreateActions } from './ShipmentCreateActions';
import { requiredCompletion } from './ShipmentCreateTopline.progress';
import { FreightPreviewCard } from './FreightPreviewCard';
import { ShipmentCreateSection, shipmentCreateGridStyle } from './ShipmentCreateSections';
import { ShipmentContainerEditor } from './ShipmentContainerEditor';
import { emptyAppointmentKeys, hasDateDraft } from './shipment-date-drafts';
import { DEFAULT_SHIPPING_LINES, type Customer, type Port, type Route } from '@tingting/shared';
import { useShipmentCreateWorkflow } from './use-shipment-create-workflow';
import { createAdhocFieldLogic } from './createAdhocFieldLogic';
import { ShipmentCreateContainerRow } from './ShipmentCreateContainerRow';
import { ShipmentCreateModals } from './ShipmentCreateModals';
import { ShipmentCreateIdentitySection } from './ShipmentCreateIdentitySection';
import { ShipmentCreateLclRouteSection } from './ShipmentCreateLclRouteSection';
import { ShipmentCreateLclCargoFields } from './ShipmentCreateLclCargoFields';
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
  const workspaceFormRef = useRef<HTMLFormElement>(null);
  const [customerNotes, setCustomerNotes] = useState('');
  const [containers, setContainers] = useState<ContainerRow[]>([newContainer()]);
  const [loading, setLoading] = useState(true);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<ShipmentCreateIssue[]>([]);
  const { toast } = useToast();
  const [detailSite, setDetailSite] = useState<OperationalSite | null>(null);
  const [createSiteDialog, setCreateSiteDialog] = useState<{ open: boolean; siteType: 'FACTORY' | 'WAREHOUSE' }>({ open: false, siteType: 'FACTORY' });
  const [sitesVersion, setSitesVersion] = useState(0);
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);
  const [pendingModeSwitch, setPendingModeSwitch] = useState<CargoMode | null>(null);
  const [pendingContainerDelete, setPendingContainerDelete] = useState<ContainerRow | null>(null);
  const [shippingLineDialogOpen, setShippingLineDialogOpen] = useState(false);
  const shippingLineAddButtonRef = useRef<HTMLButtonElement>(null);
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const routeAddButtonRef = useRef<HTMLButtonElement>(null);
  const { getConflict: getReferenceConflict, reportServerConflict } = useShipmentReferenceDuplicateGuard({
    blNumber: form.blNumber,
    bookingRef: form.bookingRef,
    declarationNumbers: form.declarationNumbers && form.declarationNumbers.length > 0 ? form.declarationNumbers : [form.declarationNumber],
    tradeDirection: form.tradeDirection,
  });
  const [routeDialogTargetKey, setRouteDialogTargetKey] = useState<string | null>(null);
  const [routeDialogInitialName, setRouteDialogInitialName] = useState('');
  const [portDialog, setPortDialog] = useState<{ open: boolean; target: { key: string; field: 'pickupPortId' | 'dropoffPortId'; name: string } | null }>({ open: false, target: null });
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

  useEffect(() => {
    let revalidateInFlight = false;
    let revalidatePending = false;
    function revalidateCatalogs() {
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

  const operationalSites = useMemo(() => sites.filter((site) => site.siteType === 'FACTORY'), [sites]);
  const selectedOperationalSite = useMemo(
    () => operationalSites.find((site) => String(site.id) === form.operationalSiteId) ?? null,
    [form.operationalSiteId, operationalSites],
  );
  // "Kho lấy hàng" reads the same customer-scoped operational sites as the
  // factory picker, narrowed to siteType='WAREHOUSE' (the list itself comes
  // from GET /api/shipments/operational-sites?customerId=<id>).
  const warehouseSites = useMemo(() => sites.filter((site) => site.siteType === 'WAREHOUSE'), [sites]);
  const readiness = useMemo(
    () => getShipmentCreateReadiness(form, containers),
    [containers, form],
  );
  const issueByField = useMemo(
    () => new Map(validationIssues.map((item) => [item.fieldId, item.message])),
    [validationIssues],
  );

  const previewRow = containers[0];
  const previewTypeCode = (catalogs?.containerTypes ?? [])
    .find((item) => String(item.id) === previewRow?.containerTypeId)?.code ?? null;
  const previewNormalized = previewTypeCode ? previewTypeCode.trim().toUpperCase() : '';
  const previewSizeClass = previewNormalized.startsWith('20') ? 'CONT20'
    : (previewNormalized.startsWith('40') || previewNormalized.startsWith('45')) ? 'CONT40'
    : null;
  const previewRouteId = previewRow?.routeId || null;
  const previewTransportDate = previewRow?.customerAppointmentAt
    ? previewRow.customerAppointmentAt.slice(0, 10)
    : '';

  const billConflict = getReferenceConflict('blNumber', form.blNumber);
  const bookingConflict = getReferenceConflict('bookingRef', form.bookingRef);
  const declarationConflict = getReferenceConflict('declaration', form.declarationNumber);

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
        : key === 'isAdHoc' ? value !== EMPTY_FORM.isAdHoc
        : key === 'hasDeposit' ? value !== EMPTY_FORM.hasDeposit
        // Arrays diff against their pristine shape: a non-empty array is not
        // automatically data (declarationNumbers starts empty, and a pristine
        // form must not report dirty — regression of 73286319).
        : Array.isArray(value) ? JSON.stringify(value) !== JSON.stringify(EMPTY_FORM[key as keyof typeof EMPTY_FORM])
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

  useEffect(() => {
    const customerId = Number(form.customerId);
    if (!form.customerId || !Number.isFinite(customerId)) { setSites([]); return; }
    let cancelled = false;
    setSitesLoading(true);
    listOperationalSites(customerId)
      .then((value) => { if (!cancelled) setSites(value); })
      .catch(() => { if (!cancelled) reportError('Không thể tải danh sách nhà máy của khách hàng'); })
      .finally(() => { if (!cancelled) setSitesLoading(false); });
    return () => { cancelled = true; };
  }, [form.customerId, sitesVersion, reportError]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => {
      if (key === 'tradeDirection') {
        return {
          ...current,
          tradeDirection: value as FormState['tradeDirection'],
          ...(value === 'IMPORT' ? { bookingRef: '' } : value === 'EXPORT' ? { blNumber: '' } : {}),
        };
      }
      if (key === 'declarationNumber') {
        const strVal = (value as string) || '';
        const currentRest = (current.declarationNumbers ?? []).slice(1);
        return {
          ...current,
          declarationNumber: strVal,
          declarationNumbers: [strVal, ...currentRest],
        };
      }
      if (key === 'declarationNumbers') {
        const listVal = (value as string[]) || [];
        return {
          ...current,
          declarationNumbers: listVal,
          declarationNumber: listVal[0] ?? '',
        };
      }
      return { ...current, [key]: value };
    });
    clearFeedback();
  }

  function selectCustomer(value: string) {
    if (value === form.customerId) return;
    setContainers((current) => current.map((row) => ({ ...row, ...resetCustomerSite(row, sites) })));
    setForm((current) => ({
      ...current,
      ...resetCustomerSite(current, sites),
      customerId: value,
      pickupWarehouseSiteId: '',
      pickupWarehouseName: '',
      // FB-105: the typed Nhà máy name belongs to the previous customer's
      // factory just like the site id — reset both, or the stale text
      // satisfies the required check (and lands in delivery_location /
      // pickup_location) for the NEW customer's lot.
      factoryName: '',
    }));
    setSites([]);
    clearFeedback();
  }

  const {
    customerCustomText, routeCustomText, factoryCustomText, warehouseCustomText, portCustomText,
    containerFactoryCustomText, containerRouteCustomText, routeIdForSite,
  } = createAdhocFieldLogic({
    customerOptions, routeOptions, portOptions, operationalSites, warehouseSites,
    selectCustomer, selectOperationalSite, selectContainerFactory,
    update: (key, value) => update(key as Parameters<typeof update>[0], value as never),
    updateContainer: (rowKey, field, value) => updateContainer(rowKey, field as Parameters<typeof updateContainer>[1], value),
    setForm, setContainers, clearFeedback,
  });

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

  async function applyShippingLine(name: string) {
    // FB-114 verify-fail (ticket 171026185348): the name is BOTH this lot's
    // shipping line AND a shared catalog entry. Persist to the server FIRST
    // (the bootstrap `shippingLines` derives from SHIPPING_LINE suppliers —
    // config.service.ts), then write the lot field and mirror the catalog
    // locally. A failed persist rejects into the dialog, which stays open
    // with the error — no more session-local merge that evaporated on reload
    // and no fake success. The lot field keeps the USER's typed casing
    // (free-text contract); the catalog mirror merges the server's canonical
    // display name (result.name).
    const result = await createShippingLine(name);
    update('shippingLineName', name);
    mergeShippingLine(catalogs, result.name, setCatalogs);
    closeShippingLineDialog();
  }

  function closeRouteDialog() {
    setRouteDialogOpen(false);
    setRouteDialogTargetKey(null);
    setRouteDialogInitialName('');
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

  function openCreateSiteDialog(siteType: 'FACTORY' | 'WAREHOUSE') {
    if (!form.customerId) {
      toast({
        kind: 'warning',
        message: 'Vui lòng chọn khách hàng trước khi thêm nhà máy hoặc kho mới.',
        duration: 6000,
      });
      const wrap = document.querySelector('[data-field="shipment-customer"]');
      if (wrap instanceof HTMLElement) {
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

  function handleSiteCreated(site: OperationalSite) {
    setCreateSiteDialog({ open: false, siteType: site.siteType });
    setSites((current) => [...current.filter((item) => item.id !== site.id), site]);
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
      ? Boolean(form.packageType || form.packageCount || form.cargoWeightKg || form.cargoVolumeCbm || form.cargoTypeId || form.operationalSiteId || form.pickupWarehouseSiteId || form.pickupWarehouseName.trim() || form.factoryName.trim() || form.extraDeliveryDates.some(Boolean)) || hasDateDraft(workspaceFormRef.current, true)
      : containers.some((row) => Object.entries(row).some(([key, value]) => key !== 'key' && value)) || hasDateDraft(workspaceFormRef.current?.querySelector('.csc-container-editor'));
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
      // FB-105: both operating points now accept typed text, so an LCL-only
      // free-text name must not survive into an FCL payload (the root
      // `factoryName` rides the payload for ad-hoc lots of either mode).
      pickupWarehouseName: next === 'FCL' ? '' : current.pickupWarehouseName,
      factoryName: next === 'FCL' ? '' : current.factoryName,
      cargoVolumeCbm: '',
      packageCount: '',
      packageType: '',
      cargoWeightKg: '',
      extraDeliveryDates: [],
    }));
    setContainers([newContainer()]);
    clearFeedback();
  }

  function updateContainer(key: string, field: keyof Omit<ContainerRow, 'key'>, value: string) {
    setContainers((current) => current.map((row) => row.key === key ? { ...row, [field]: value } : row));
    clearFeedback();
  }

  // Case 2026-10-11-R14-02 (FB-008 round 14, "không có nhập ngày giao hàng
  // loạt cho lô nhiều container"): bulk delivery-schedule entry — type the
  // "Ngày giờ đóng trả" once and apply it to every container still without
  // one. The no-source sibling of 'Copy giờ hẹn xuống cont trống': it fills
  // the same destination set without requiring a scheduled row first.
  const [bulkAppointment, setBulkAppointment] = useState('');
  // Case 2026-10-11-R14-03 (FB-009 round 14): the count gates visibility at
  // >= 1 destination — any row still without a schedule, including one holding
  // a partial segment draft (incomplete invalid input the copy replaces
  // visibly; emptyAppointmentKeys is the single source of that truth). The
  // DOM read sees the previous paint, which is exactly the state a click acts
  // on.
  const emptyAppointmentCount = emptyAppointmentKeys(containers).size;
  // Verify-fail 091026225620: the section-level copy affordance (the
  // discoverable position the "button missing" reports kept looking for)
  // sources from the first row that has an appointment; the per-row hover
  // buttons keep copying their own values.
  const copySourceRow = containers.find((row) => row.customerAppointmentAt);
  // FB-009 (card 131026233500): the value the section-level copy button
  // writes. Empty until the group holds a COMPLETE datetime — a half-typed
  // draft has no time to copy, and 'HH:mm DD/MM/YYYY' is the shape the row
  // and dialog copy buttons already write.
  const bulkAppointmentCopyValue = formatDateTime24(bulkAppointment);
  function copyAppointmentToEmpty(fromKey: string) {
    const source = containers.find((row) => row.key === fromKey)?.customerAppointmentAt;
    if (!source) return;
    const targetKeys = emptyAppointmentKeys(containers);
    if (!targetKeys.size) return;
    setContainers((current) => current.map((row) => (
      targetKeys.has(row.key) ? { ...row, customerAppointmentAt: source } : row
    )));
    toast({ kind: 'success', message: `Đã copy ngày giờ đóng trả sang ${targetKeys.size} container chưa có lịch` });
  }

  function applyBulkAppointment() {
    if (!bulkAppointment) return;
    const targetKeys = emptyAppointmentKeys(containers);
    if (!targetKeys.size) return;
    setContainers((current) => current.map((row) => (
      targetKeys.has(row.key) ? { ...row, customerAppointmentAt: bulkAppointment } : row
    )));
    setBulkAppointment('');
    clearFeedback();
    toast({ kind: 'success', message: `Đã áp dụng ngày giờ đóng trả cho ${targetKeys.size} container chưa có lịch` });
  }

  // FB-009 (2026-10-14): the per-row copy-time affordance — the time itself
  // lands in the OS clipboard so a clerk can paste it anywhere; the toast
  // confirms what was copied. Independent of the copy-down feature above:
  // it renders whenever the row holds a schedule, never gated on siblings.
  function notifyAppointmentCopied(formatted: string) {
    toast({ kind: 'success', message: `Đã copy giờ hẹn ${formatted}` });
  }

  function removeContainer(row: ContainerRow, scope: HTMLTableRowElement | null) {
    const hasEnteredData = Object.entries(row).some(([key, value]) => key !== 'key' && value !== '') || hasDateDraft(scope);
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

  function goBack() {
    if (isDirty || hasDateDraft(workspaceFormRef.current)) {
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
    // FB-048 (card 141026003600): the native pre-gate used to run FIRST and
    // return, so a partially-typed date/Time field (which sets customValidity
    // on its segments) starved every OTHER required field of its issue — the
    // card's exact symptom: "chỉ ô ngày/giờ nhập dở mới có viền đỏ", while
    // Khách hàng / Hình thức XNK / Số Bill-Booking / Loại container stayed
    // neutral on an all-empty submit.
    //
    // The app-owned pass now runs first: it paints every invalid field and
    // blocks the save on its own. The native gate stays as the fallback for a
    // constraint the model does not express (an empty value passes validation
    // but the input is still `:invalid`), so nothing can slip through a save.
    const incomplete = workspaceFormRef.current?.querySelector<HTMLInputElement>('[data-date-input]:invalid, [data-split-datetime] input:invalid');
    const result = await runSave(intent);
    // A partial date/time draft still earns its own native message
    // ("Nhập đủ giờ và ngày hợp lệ.") — reported on top of the app-owned paint,
    // never instead of it.
    if (incomplete) incomplete.reportValidity();
    if (result.issues.length > 0) {
      window.requestAnimationFrame(() => focusIssue(result.issues[0].fieldId));
      return;
    }
  }

  // Card 171026113510 (QA1-007 verify-fail lần 2): the chip and the panel both
  // read the LIVE readiness above, not `validationIssues` — that state only
  // fills after a submit attempt, which is why a form with the three identity
  // fields filled claimed "3/3" while six mode-specific fields still blocked.
  const completion = useMemo(
    () => requiredCompletion(form, containers, readiness.issues),
    [form, containers, readiness],
  );

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-3)' }}>Đang tải…</div>;
  if (loadError) return <div role="alert" style={{ padding: 24, color: 'var(--danger)' }}>{loadError}</div>;
  if (!catalogs?.customers.length) return <EmptyState context="clients" title="Chưa có khách hàng" description="Cần ít nhất một khách hàng trước khi tạo lô hàng." />;

  return (
    <div className="csc-page">
      <ShipmentCreateTopline
        saving={saving}
        requiredDone={completion.done}
        requiredTotal={completion.total}
        onCancel={goBack}
        onSaveDraft={() => void save('DRAFT')}
        onCreate={() => void save('CREATE')}
      />
      <form ref={workspaceFormRef} noValidate onSubmit={(event) => { event.preventDefault(); void save('CREATE'); }} className="csc-workspace">
        <ShipmentCreateSummary
          // QA1-007 wants the panel to exist BEFORE the first save (live
          // readiness). After a failed save the panel must still speak the SAME
          // wording as the field paint below — `validationIssues` is that list,
          // and it is the only one carrying the DRAFT copy ("Chọn khách hàng để
          // tạo lô hàng."). Prefer it while it is non-empty.
          outstandingIssues={validationIssues.length > 0 ? validationIssues : readiness.issues}
          submitError={submitError}
          onFocusIssue={focusIssue}
        />
        <div className="csc-form">
          <ShipmentCreateIdentitySection
            form={form}
            update={update}
            selectCustomer={selectCustomer}
            customerOptions={customerOptions}
            shippingLineOptions={shippingLineOptions}
            customerCustomText={customerCustomText}
            saving={Boolean(saving)}
            issueByField={issueByField}
            billConflict={billConflict}
            bookingConflict={bookingConflict}
            declarationConflict={declarationConflict}
            getDeclarationConflict={(decl) => getReferenceConflict('declaration', decl)}
            customerAddButtonRef={customerAddButtonRef}
            shippingLineAddButtonRef={shippingLineAddButtonRef}
            onOpenCustomerDialog={() => setCustomerDialogOpen(true)}
            onOpenShippingLineDialog={() => setShippingLineDialogOpen(true)}
          />

          {form.cargoMode === 'LCL' && (
            <ShipmentCreateLclRouteSection
              form={form}
              update={update}
              routeOptions={routeOptions}
              operationalSites={operationalSites}
              warehouseSites={warehouseSites}
              selectedOperationalSite={selectedOperationalSite}
              selectOperationalSite={selectOperationalSite}
              routeCustomText={routeCustomText}
              factoryCustomText={factoryCustomText}
              warehouseCustomText={warehouseCustomText}
              routeAddButtonRef={routeAddButtonRef}
              setRouteDialogOpen={setRouteDialogOpen}
              openCreateSiteDialog={openCreateSiteDialog}
              setDetailSite={setDetailSite}
              saving={Boolean(saving)}
              sitesLoading={sitesLoading}
              issueByField={issueByField}
            />
          )}

          <ShipmentCreateSection id="cargo" title="Thông tin hàng" description="Nhập chi tiết phù hợp với hàng FCL hoặc hàng lẻ.">
            <div className="csc-cargo-choice-grid">
              <fieldset className="csc-mode" aria-required="true">
                <legend>Loại hàng <span aria-hidden="true">*</span></legend>
                <div>
                  {(['FCL', 'LCL'] as CargoMode[]).map((mode) => (
                    <label key={mode}>
                      <input
                        type="radio"
                        name="cargo-mode"
                        value={mode}
                        checked={form.cargoMode === mode}
                        onChange={() => changeMode(mode)}
                        disabled={Boolean(saving)}
                      />
                      <span className="csc-mode__option">{mode === 'FCL' ? 'Hàng FCL' : 'Hàng lẻ'}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
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
                      ...Array.from({ length: count }, () => createContainerFromPrevious(source)),
                    ];
                  })}
                  rows={
                    <>
                      {containers.map((row, index) => (
                        <ShipmentCreateContainerRow
                          key={row.key}
                          row={row}
                          index={index}
                          containersLength={containers.length}
                          catalogs={catalogs}
                          operationalSites={operationalSites}
                          emptyAppointmentCount={emptyAppointmentCount}
                          copyAppointmentToEmpty={copyAppointmentToEmpty}
                          onAppointmentCopied={notifyAppointmentCopied}
                          updateContainer={updateContainer}
                          removeContainer={removeContainer}
                          selectContainerFactory={selectContainerFactory}
                          containerFactoryCustomText={containerFactoryCustomText}
                          containerRouteCustomText={containerRouteCustomText}
                          portCustomText={portCustomText}
                          setRouteDialogTargetKey={setRouteDialogTargetKey}
                          setRouteDialogInitialName={setRouteDialogInitialName}
                          setRouteDialogOpen={setRouteDialogOpen}
                          setPortDialog={setPortDialog}
                          issueByField={issueByField}
                          isAdHoc={form.isAdHoc}
                          customerId={form.customerId}
                          sitesLoading={sitesLoading}
                          saving={Boolean(saving)}
                          routeOptions={routeOptions}
                          portOptions={portOptions}
                        />
                      ))}
                    </>
                  }
                />
              </>
            ) : (
              <ShipmentCreateLclCargoFields
                form={form}
                update={update}
                saving={Boolean(saving)}
                issueByField={issueByField}
              />
            )}
          </ShipmentCreateSection>

          <ShipmentCreateSection
            id="schedule"
            title="Lịch & ghi chú"
            description={form.cargoMode === 'FCL' ? undefined : 'Ngày giao hàng để điều phối thực hiện đúng kế hoạch.'}
          >
            {form.cargoMode === 'LCL' && (
              <div style={gridStyle}>
                {/* FB-078 round 2 (verify-fail 091026225610; user verbatim:
                    "chỉ cần 1 mục là thêm ngày giao hàng"): the LCL block is
                    JUST the delivery-date item. The customs cutoff joins the
                    FCL-vessel fields (hạ container / trả container) in never
                    rendering here. */}
                <div data-field-id="shipment-expected-delivery">
                  {/* Helpdesk 2026-10-13 (ops Tiếp Vu): LCL copy is "Ngày giao
                      hàng" — this field renders only on the LCL path, so the
                      rename is unconditional; id + expectedDeliveryDate wire
                      name are unchanged. */}
                  <DateField
                    id="shipment-expected-delivery"
                    label="Ngày giao hàng"
                    requiredMark
                    value={form.expectedDeliveryDate}
                    onChange={(event) => update('expectedDeliveryDate', event.target.value)}
                    disabled={Boolean(saving)}
                    error={issueByField.get('shipment-expected-delivery')}
                  />
                </div>
              </div>
            )}
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
            {form.cargoMode === 'FCL' && (
              <>
                {emptyAppointmentCount >= 1 && (
                  <div className="csc-bulk-appointment" data-field-id="shipment-bulk-appointment">
                    <UDateTimeField
                      id="shipment-bulk-appointment"
                      label="Ngày giờ đóng trả cho tất cả cont"
                      value={bulkAppointment}
                      onChange={(event) => setBulkAppointment(event.target.value)}
                      disabled={Boolean(saving)}
                      combinedPicker
                    />
                    <button
                      type="button"
                      className="csc-utility-button csc-utility-button--dashed"
                      title={`Áp dụng ngày giờ đóng trả này cho ${emptyAppointmentCount} container chưa có lịch`}
                      onClick={applyBulkAppointment}
                      disabled={Boolean(saving) || !bulkAppointment}
                    >
                      <CalendarDays size={15} aria-hidden="true" />Áp dụng cho {emptyAppointmentCount} container
                    </button>
                    {/* FB-009 (card 131026233500, "nút copy thời gian vẫn không
                        tồn tại ở bất kỳ đâu"): the section-level clipboard
                        affordance the card looked for next to this group. It
                        copies the value typed HERE — the copy-down button
                        below fills sibling rows instead and is a different
                        feature. */}
                    {bulkAppointmentCopyValue && (
                      <CopyCodeButton
                        className="csc-bulk-appointment__copy"
                        value={bulkAppointmentCopyValue}
                        label="giờ hẹn đóng trả"
                        onCopied={() => notifyAppointmentCopied(bulkAppointmentCopyValue)}
                      />
                    )}
                  </div>
                )}
                {copySourceRow && emptyAppointmentCount >= 1 && (
                  <button
                    type="button"
                    className="csc-utility-button csc-utility-button--dashed"
                    style={{ justifySelf: 'start', alignSelf: 'start', width: 'fit-content' }}
                    title={`Copy ngày giờ ${formatDateTime24(copySourceRow.customerAppointmentAt) || copySourceRow.customerAppointmentAt} từ dòng đầu tiên có lịch sang các container chưa có lịch`}
                    onClick={() => copyAppointmentToEmpty(copySourceRow.key)}
                    disabled={Boolean(saving)}
                  >
                    <Copy size={15} aria-hidden="true" />Copy giờ hẹn xuống cont trống
                  </button>
                )}
                <div className="csc-notes-grid">
                  <TextAreaField label="Ghi chú cho khách hàng" value={customerNotes} onChange={(event) => { setCustomerNotes(event.target.value); clearFeedback(); }} rows={3} maxLength={2000} placeholder="Thông tin cần gửi hoặc lưu ý cần theo dõi với khách hàng" disabled={Boolean(saving)} />
                  <TextAreaField label="Ghi chú cho lái xe" value={form.operationalNotes} onChange={(event) => update('operationalNotes', event.target.value)} rows={4} maxLength={2000} placeholder="Hướng dẫn và lưu ý cần thiết cho lái xe" disabled={Boolean(saving)} />
                </div>
              </>
            )}
          </ShipmentCreateSection>
        </div>

        <FreightPreviewCard
          customerId={form.customerId ? Number(form.customerId) : undefined}
          routeId={previewRouteId ? Number(previewRouteId) : undefined}
          vehicleSizeClassCode={previewSizeClass ?? undefined}
          transportDate={previewTransportDate || undefined}
          isAdHoc={form.isAdHoc}
        />

        {/* Card 171026115830 (FB-108): the same three actions repeat at the END
            of the worksheet — a clerk who has just typed the last field must
            not scroll back to the topline to save. This deliberately brings
            back the bottom bar the 11/10 mock had retired (owner request,
            17/10). */}
        <div className="csc-form-actions">
          <ShipmentCreateActions
            variant="footer"
            saving={saving}
            onCancel={goBack}
            onSaveDraft={() => void save('DRAFT')}
            onCreate={() => void save('CREATE')}
          />
        </div>
      </form>

      <ShipmentCreateModals
        detailSite={detailSite}
        onCloseDetailSite={() => setDetailSite(null)}
        createSiteDialog={createSiteDialog}
        tradeDirection={form.tradeDirection}
        customerId={form.customerId}
        routes={catalogs?.routes ?? []}
        onCloseCreateSite={() => setCreateSiteDialog((current) => ({ ...current, open: false }))}
        onSiteCreated={handleSiteCreated}
        onRouteCreatedInSite={addRouteToCatalog}
        shippingLineDialogOpen={shippingLineDialogOpen}
        currentShippingLineName={form.shippingLineName}
        onCloseShippingLineDialog={closeShippingLineDialog}
        onApplyShippingLine={applyShippingLine}
        routeDialogOpen={routeDialogOpen}
        onCloseRouteDialog={closeRouteDialog}
        onRouteCreated={handleRouteCreated}
        routeDialogInitialName={routeDialogInitialName}
        portDialog={portDialog}
        onClosePortDialog={closePortDialog}
        onPortCreated={handlePortCreated}
        customerDialogOpen={customerDialogOpen}
        onCloseCustomerDialog={closeCustomerDialog}
        onCustomerCreated={handleCustomerCreated}
        backConfirmOpen={backConfirmOpen}
        onCloseBackConfirm={() => setBackConfirmOpen(false)}
        onDiscardAndGoBack={discardAndGoBack}
        pendingModeSwitch={pendingModeSwitch}
        onClosePendingModeSwitch={() => setPendingModeSwitch(null)}
        onConfirmModeSwitch={confirmModeSwitch}
        pendingContainerDelete={pendingContainerDelete}
        onClosePendingContainerDelete={() => setPendingContainerDelete(null)}
        onConfirmContainerDelete={confirmContainerDelete}
      />
    </div>
  );
}
