import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { formatDateTime24 } from '../../../lib/format';
import { EmptyState } from '../../../design-system';
import {
  UTextAreaField as TextAreaField,
} from './uui-fields';
import { UDateTimeField } from './uui-datetime-field';
import { useToast } from '../../../components/shared/Toast';
import { CopyCodeButton } from '../../../components/trip/CopyCodeButton';
import { tripClient, type CatalogData } from '../../../api/tripClient';
import {
  createShippingLine,
  listOperationalSites,
  listSharedWarehouseSites,
  type OperationalSite,
} from '../../../api/shipmentClient';
import { useShipmentReferenceDuplicateGuard } from './use-shipment-reference-duplicate-guard';
import { useShipmentWorkspacePrefill } from './use-shipment-workspace-prefill';
import { mergeCustomer, mergePort, mergeRoute, mergeShippingLine } from './catalogMerger';
import {
  EMPTY_SHIPMENT_CREATE_FORM,
  createContainerFromPrevious,
  duplicateContainerRow,
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
import { useFixedActionClearance } from '../../../hooks/useFixedActionClearance';
import { ShipmentCreateTopline } from './ShipmentCreateTopline';
import { ShipmentCreateActions } from './ShipmentCreateActions';
import { ShipmentViewActions } from './ShipmentViewActions';
import { requiredCompletion } from './ShipmentCreateTopline.progress';
import { FreightPreviewCard } from './FreightPreviewCard';
import { ShipmentCreateSection } from './ShipmentCreateSections';
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
import '../../../pages/clerk/ClerkShipmentCreatePage.onescreen.css';

type FormState = ShipmentCreateFormState;
type ContainerRow = ShipmentContainerDraft;

const EMPTY_FORM = EMPTY_SHIPMENT_CREATE_FORM;
const newContainer = createEmptyContainer;

/**
 * SIL-171 (FB-147): "Sửa lô" opens THIS workspace in edit mode. `editTarget`
 * pins the lot: the detail is fetched once, mapped onto the same form state
 * (validation identical to create), and the workflow PATCHes the existing lot
 * instead of POSTing a new one. Omitted → the plain create form, unchanged.
 *
 * SIL-481 (ruling 25/10): `viewTarget` opens the SAME workspace read-only —
 * the /shipments/:id post-create review. Identical fetch-once prefill, every
 * control disabled through the same channel the saving state uses, and the
 * action cluster swaps to Quay lại / Sửa / Tạo mới lô hàng
 * (ShipmentViewActions). One
 * form layout everywhere: create → view → edit.
 */
export function ShipmentCreateWorkspace({ editTarget, viewTarget }: {
  editTarget?: { shipmentId: number };
  /** `canEditLot` rides the target so the host page (owner of useAuth)
   *  decides the role gate; the workspace layers the accounting lock on top. */
  viewTarget?: { shipmentId: number; canEditLot?: boolean };
} = {}) {
  const navigate = useNavigate();
  const viewMode = Boolean(viewTarget);
  /** Role gate decided by the host page (it owns useAuth): may this viewer
   *  open the edit form? The lock is applied on top once the detail lands. */
  const viewCanEditLot = Boolean(viewTarget?.canEditLot);
  const [catalogs, setCatalogs] = useState<CatalogData | null>(null);
  const [sites, setSites] = useState<OperationalSite[]>([]);
  // Card 261022093245: the SHARED Kho (CFS/Cảng) catalog — customer-independent
  // infrastructure, so it loads once on mount (and refetches when a new site
  // is created), never per customer.
  const [warehouseCatalog, setWarehouseCatalog] = useState<OperationalSite[]>([]);
  const [warehouseCatalogLoading, setWarehouseCatalogLoading] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const workspaceFormRef = useRef<HTMLFormElement>(null);
  // SIL-510: the worksheet's one action bar is the viewport-fixed footer —
  // the house hook publishes its measured height (--csc-action-bar-height,
  // consumed by .csc-page's clearance padding) and keeps the scroller's
  // scroll-padding clear so focusIssue never lands a field under the bar.
  const actionBarRef = useFixedActionClearance<HTMLDivElement>('--csc-action-bar-height');
  const [customerNotes, setCustomerNotes] = useState('');
  const [containers, setContainers] = useState<ContainerRow[]>([newContainer()]);
  const [loading, setLoading] = useState(true);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // ── SIL-171 edit mode ── the lot's own seed (id/version) and
  // the pristine baseline the leave-confirm diff reads. The detail is fetched
  // ONCE per editTarget; a route id change refetches fresh.
  // Summary de-noise (17/10): the "Cần bổ sung" panel was submit-gated —
  // SIL-627 (id 731, owner 31/10) retired the panel entirely, so no attempt
  // flag is needed anymore; per-field validation paint is unconditional.
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
    // SIL-481 view mode: nothing is being typed, so the as-you-type duplicate
    // lookup would only paint stale warnings over read-only values — pass it
    // nothing to look for.
    blNumber: viewMode ? '' : form.blNumber,
    bookingRef: viewMode ? '' : form.bookingRef,
    tradeDirection: form.tradeDirection,
    excludeShipmentId: editTarget?.shipmentId,
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

  // SIL-171 edit + SIL-481 view: the pinned-lot fetch/prefill lives in its
  // own hook (structure-guard split debt, D1 note).
  const pinnedShipmentId = editTarget?.shipmentId ?? viewTarget?.shipmentId;
  const { editSeed, editLoadError, viewLocked, editBaselineRef } = useShipmentWorkspacePrefill({
    pinnedShipmentId,
    viewMode,
    setForm,
    setContainers,
    setCustomerNotes,
  });

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
  // Card 261022093245 (Zalo 22/10): the Kho (CFS/Cảng) picker reads the SHARED
  // warehouse catalog (GET /operational-sites?scope=shared — every active
  // warehouse across ALL customers), NOT the lot customer's own sites. A
  // CFS/depot is shared infrastructure: a customer with no warehouses of its
  // own still picks from the shared list instead of being forced into
  // "+ Thêm kho". The catalog loads once on mount and refetches whenever a
  // site is created (sitesVersion), so the freshly added kho appears too.
  const warehouseSites = warehouseCatalog;
  /** Customer sites + shared warehouses, deduped by id — the payload builder
   *  resolves display labels (pickup/delivery location) for BOTH the lot
   *  customer's factories and a shared warehouse owned by another customer. */
  const payloadSiteCatalog = useMemo(() => {
    const byId = new Map(sites.map((site) => [site.id, site]));
    for (const site of warehouseCatalog) if (!byId.has(site.id)) byId.set(site.id, site);
    return Array.from(byId.values());
  }, [sites, warehouseCatalog]);
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

  const mapOptions = <T extends { id: number; name: string }>(items: T[] | undefined) =>
    (items ?? []).map((item) => ({ value: String(item.id), label: item.name }));
  const customerOptions = useMemo(() => mapOptions(catalogs?.customers), [catalogs]);
  /** Card 211026130115: the kho quick-add opens before a customer is chosen —
   *  the dialog's customer picker renders from these options (picker mode). */
  const dialogCustomers = useMemo(
    () => (catalogs?.customers ?? []).map((item) => ({ id: item.id, name: item.name })),
    [catalogs],
  );
  const routeOptions = useMemo(() => mapOptions(catalogs?.routes), [catalogs]);
  const portOptions = useMemo(() => mapOptions(catalogs?.ports), [catalogs]);
  const shippingLineOptions = useMemo(() => {
    const list = catalogs?.shippingLines?.length
      ? catalogs.shippingLines.map((s) => s.name)
      : Array.from(DEFAULT_SHIPPING_LINES);
    return list.map((name) => ({ value: name, label: name }));
  }, [catalogs]);

  const isDirty = useMemo(() => {
    // SIL-171 edit mode: dirty is measured against the PREFILLED baseline —
    // opening the form and leaving without touching anything is not "dirty".
    // SIL-481 view mode rides the same baseline; its controls are disabled,
    // so nothing can ever diverge.
    if (editTarget || viewMode) {
      return editBaselineRef.current !== JSON.stringify([form, containers, customerNotes]);
    }
    const hasFormData = Object.entries(form).some(([key, value]) => (
      key === 'cargoMode' ? value !== EMPTY_FORM.cargoMode
        : key === 'isCombined' ? value !== EMPTY_FORM.isCombined
        : key === 'isAdHoc' ? value !== EMPTY_FORM.isAdHoc
        : key === 'hasDeposit' ? value !== EMPTY_FORM.hasDeposit
        // Arrays diff against their pristine shape: a non-empty array is not
        // automatically data (a pristine form must not report dirty —
        // regression of 73286319).
        : Array.isArray(value) ? JSON.stringify(value) !== JSON.stringify(EMPTY_FORM[key as keyof typeof EMPTY_FORM])
        : value !== ''
    ));
    const hasContainerData = containers.some((row) => (
      // `id` may exist as undefined (cloned/empty rows) — treat that as empty.
      Object.entries(row).some(([key, value]) => key !== 'key' && value !== '' && value !== undefined)
    ));
    return hasFormData || hasContainerData || customerNotes.trim() !== '';
  }, [containers, customerNotes, editBaselineRef, editTarget, form, viewMode]);

  const { clearFeedback, reportError, save: runSave, saving, submitError } = useShipmentCreateWorkflow({
    form,
    containers,
    // SIL-171: seeded with the loaded lot's id/version, the
    // save starts at the PATCH + reconcile stage — no create call ever fires.
    editSeed: editSeed ?? undefined,
    // Card 261022093245: label resolution needs BOTH the customer's sites and
    // the shared warehouse catalog — a picked shared kho belongs to another
    // customer, so its shortName/name must resolve from the union or
    // pickup/delivery location would silently store null.
    sites: payloadSiteCatalog,
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

  // Card 261022093245: shared Kho (CFS/Cảng) catalog — customer-independent,
  // fetched once on mount and refetched after "+ Thêm kho" creates a site.
  // A failed fetch leaves the previous list standing (initially empty): the
  // empty-catalog hint — not an error toast — is the picker's failure
  // surface, matching the factory picker's degraded mode.
  useEffect(() => {
    let cancelled = false;
    setWarehouseCatalogLoading(true);
    listSharedWarehouseSites()
      .then((value) => { if (!cancelled) setWarehouseCatalog(value); })
      .catch(() => { /* degraded: keep whatever list already stands */ })
      .finally(() => { if (!cancelled) setWarehouseCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [sitesVersion]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => {
      if (key === 'tradeDirection') {
        return {
          ...current,
          tradeDirection: value as FormState['tradeDirection'],
          ...(value === 'IMPORT' ? { bookingRef: '' } : value === 'EXPORT' ? { blNumber: '' } : {}),
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
    // Card 211026130115 (verify-fail "ẨN sau default"): the kho quick-add opens
    // BEFORE a customer is chosen — OperationalSiteCreateDialog renders its own
    // customer picker for a customerId-less caller (FB-077 defensive path), so
    // nothing is hidden behind the "chọn khách hàng trước" trick. The FACTORY
    // gate stays: its quick-add carries route + contact and the intake contract
    // (ClerkShipmentCreatePage "factory creation action discoverable") keeps
    // guiding to the customer first.
    if (siteType === 'FACTORY' && !form.customerId) {
      toast({
        kind: 'warning',
        message: 'Vui lòng chọn khách hàng trước khi thêm nhà máy mới.',
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
    if (site.siteType === 'WAREHOUSE') {
      // Card 261022093245: the kho picker reads the shared catalog — merge the
      // new site in immediately (the sitesVersion refetch lands right after).
      setWarehouseCatalog((current) => [...current.filter((item) => item.id !== site.id), site]);
    }
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
      ? Boolean(form.packageType || form.packageCount || form.cargoWeightKg || form.cargoVolumeCbm || form.cargoTypeId || form.operationalSiteId || form.pickupWarehouseSiteId || form.pickupWarehouseName.trim() || form.factoryName.trim() || form.extraDeliveryDates.some(Boolean) || form.lclClosingAt) || hasDateDraft(workspaceFormRef.current, true)
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
      // SIL-587: the LCL schedule datetime never survives into an FCL payload
      // (FCL's schedule lives per container; the confirm gate above already
      // asked before this wipe).
      lclClosingAt: next === 'FCL' ? '' : current.lclClosingAt,
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

  // Case 2026-10-11-R14-02 (FB-008 round 14): bulk delivery-schedule entry.
  // SIL-511 (owner 26/10) retired the 'Áp dụng cho N container' chip beside
  // this input — the copy-down/copy-all buttons below are the apply-all
  // paths — so the typed value feeds only the section clipboard copy.
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

  // Ticket 211026125242 (CUS-03) — RETIRED by SIL-513 (owner 26/10): the
  // "Copy giờ hẹn cho tất cả N cont" chip is gone. The copy-down button below
  // keeps filling only the still-empty rows, and the bulk "Ngày giờ đóng trả
  // cho tất cả cont" field rides its own Copy button — which QA ruling
  // 15:10 (retest 30/10, ticket 710) turned into a REAL apply path: see
  // applyBulkAppointmentToRows below.

  // FB-009 (2026-10-14): the per-row copy-time affordance — the time itself
  // lands in the OS clipboard so a clerk can paste it anywhere; the toast
  // confirms what was copied. Independent of the copy-down feature above:
  // it renders whenever the row holds a schedule, never gated on siblings.
  function notifyAppointmentCopied(formatted: string) {
    toast({ kind: 'success', message: `Đã copy giờ hẹn ${formatted}` });
  }

  // QA ruling 15:10 (retest 30/10, ticket 710) — CUS-03 no longer accepts a
  // clipboard-only band Copy: the button lived beside "Ngày giờ đóng trả cho
  // tất cả cont", claimed success ("Đã copy giờ hẹn…") and wrote NOTHING,
  // so the submit kept failing "Container N: chọn ngày giờ đóng/trả." The
  // band Copy now WRITES the shared datetime into every container row that
  // still lacks a schedule — after it runs, all rows hold a datetime and
  // the per-container requirement is satisfied everywhere. Rows that
  // already carry their own schedule keep it (the set-row law the
  // copy-down button pins); the clipboard write stays as the bonus channel.
  function applyBulkAppointmentToRows() {
    if (!bulkAppointment) return;
    const targetKeys = emptyAppointmentKeys(containers);
    if (!targetKeys.size) return;
    setContainers((current) => current.map((row) => (
      targetKeys.has(row.key) ? { ...row, customerAppointmentAt: bulkAppointment } : row
    )));
    toast({ kind: 'success', message: `Đã copy ngày giờ đóng trả sang ${targetKeys.size} container chưa có lịch` });
  }

  // SIL-513 (owner 26/10): the STT hover copy duplicates the row IN PLACE —
  // the full-value clone inserts immediately BELOW the source row (not at
  // the list's end, where "Thêm container" appends), so the operator sees
  // the copy beside what they copied.
  function duplicateContainer(fromKey: string) {
    const sourceIndex = containers.findIndex((row) => row.key === fromKey);
    if (sourceIndex < 0) return;
    const clone = duplicateContainerRow(containers[sourceIndex]);
    setContainers((current) => {
      const at = current.findIndex((row) => row.key === fromKey);
      if (at < 0) return current;
      return [...current.slice(0, at + 1), clone, ...current.slice(at + 1)];
    });
    toast({ kind: 'success', message: `Đã nhân bản container ${sourceIndex + 1} — kiểm tra số cont trước khi lưu` });
  }

  // Card D.4 (18/10, hàng lẻ D.4) completed by 181026200700, then superseded
  // by SIL-587 (id 687, khách 29/10): the "Lịch & ghi chú" section stays gone
  // from the LCL form AND the block is exactly ONE always-visible schedule
  // field — now "Ngày giờ đóng trả" (id `shipment-lcl-closing-at`, state
  // `lclClosingAt`; the payload derives expectedDeliveryDate from its VN
  // date). FCL keeps the full schedule section. SIL-611 (id 714, owner
  // 30/10) then deleted the FCL "Lịch & ghi chú" band too: the form is now
  // Nhận diện lô (gọn) → Thông tin hàng → Ghi chú, with FCL's bulk datetime
  // in the top mode band (SIL-598) and the copy-down button under the
  // container table.

  function removeContainer(row: ContainerRow, scope: HTMLTableRowElement | null) {
    const hasEnteredData = Object.entries(row).some(([key, value]) => key !== 'key' && value !== '' && value !== undefined) || hasDateDraft(scope);
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
    leaveWorkspace();
  }

  // SIL-171: the edit form's home context is the lot detail — cancel returns
  // there deterministically (also correct for a direct /shipments/:id/edit
  // URL entry, where history-back would leave the app). The create form keeps
  // its original history-back behavior. SIL-481: the view's home is the lô
  // list.
  function leaveWorkspace() {
    if (editTarget) navigate(`/shipments/${editTarget.shipmentId}`);
    else if (viewMode) navigate('/shipments');
    else navigate(-1);
  }

  function discardAndGoBack() {
    setBackConfirmOpen(false);
    if (editTarget) navigate(`/shipments/${editTarget.shipmentId}`);
    else navigate(-1);
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

  if (loading || ((editTarget || viewTarget) && !editSeed && !editLoadError)) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-3)' }}>Đang tải…</div>;
  }
  if (loadError) return <div role="alert" style={{ padding: 24, color: 'var(--danger)' }}>{loadError}</div>;
  if (editLoadError) {
    return (
      <div role="alert" style={{ padding: 24, color: 'var(--danger)' }}>
        {editLoadError}
      </div>
    );
  }
  if (!catalogs?.customers.length) return <EmptyState context="clients" title="Chưa có khách hàng" description="Cần ít nhất một khách hàng trước khi tạo lô hàng." />;

  const workspaceMode = viewMode ? 'view' as const : editTarget ? 'edit' as const : 'create' as const;
  // SIL-481 view mode reuses the SAVING channel as the disable channel: every
  // child control already paints disabled from this prop, so a read-only
  // review needs no per-field changes anywhere in the worksheet. In
  // create/edit this is exactly the old Boolean(saving).
  const controlsDisabled = viewMode || Boolean(saving);
  // SIL-481: "Sửa" opens the SIL-171 edit form for this lot.
  const goEdit = () => {
    if (viewTarget) navigate(`/shipments/${viewTarget.shipmentId}/edit`);
  };
  const goShipmentList = () => navigate('/shipments');
  // SIL-500: the KH's create → review → next-lot loop. Same intake authority
  // as the edit gate — the /shipments/new route (shipmentCreatorOnly) admits
  // exactly SHIPMENT_INTAKE_MUTATION_ROLES, so one flag wires both verbs.
  const goCreateNew = () => navigate('/shipments/new');
  const viewCreateNew = viewCanEditLot ? goCreateNew : undefined;

  return (
    <div className="csc-page">
      <ShipmentCreateTopline
        mode={workspaceMode}
        requiredDone={completion.done}
        requiredTotal={completion.total}
      />
      <form
        ref={workspaceFormRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // Read-only review: nothing may submit — the Enter law below and
          // the disabled controls already guarantee it; this is the backstop.
          if (viewMode) return;
          void save('CREATE');
        }}
        onKeyDown={(event) => {
          // FB-002 (cards 181026000027 + 171026215500 family, lần 3 — card
          // 211026034109): this workspace is the last major time-field host
          // without an Enter law. Both submits (Tạo lô hàng / Lưu nháp) are
          // type="button" on the viewport-fixed footer bar INSIDE this form,
          // so no button ever becomes the browser's implicit-submission
          // default — Enter after typing a COMPLETE "Ngày giờ đóng trả" was a
          // silent dead key (không lưu), and the operator's whole typed intake
          // died with the page when they moved on (mất trắng input). The form
          // answers Enter itself through the same submit the fixed bar rides
          // (requestSubmit keeps the app-owned validation paint; no field is
          // ever wiped). The segmented datetime fields keep their own law: a
          // COMPLETE draft's Enter bubbles here, incomplete/open-picker ones
          // are swallowed by the field — never steal a key the field already
          // handled. Same guard set as the CUS quick-edit modal and the
          // dispatch assignment dialog.
          if (event.defaultPrevented) return;
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || controlsDisabled) return;
          const target = event.target as HTMLElement;
          // Open date/time pickers own their Enter (commit the draft / close
          // the panel) — never steal it.
          if (target.closest('[data-date-picker], .time-picker__popup, [data-time-picker-overlay]')) return;
          if (target.isContentEditable || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.closest('.searchable-select, [role="listbox"], [role="option"], .csc-container-type-picker')) return;
          // Multiline notes: bare Enter inserts a newline; Ctrl/Cmd+Enter
          // saves — same law as the quick-edit modal.
          if (target.tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey) return;
          if (event.shiftKey) return;
          event.preventDefault();
          workspaceFormRef.current?.requestSubmit();
        }}
        className="csc-workspace"
      >
        {/* SIL-627 (id 731, owner 31/10): the "Cần bổ sung N thông tin"
            summary banner is RETIRED — validation feedback is per-field (the
            invalid paint + field messages below carry every issue, and the
            save still focuses the first missing field). Only a real submit
            failure (server error) keeps its own surface here. */}
        {submitError && <div className="csc-submit-error" role="alert">{submitError}</div>}
        <div className="csc-form">
          {/* Cards 211026130215 + 211026130315 (verify-fail "ẨN sau default"):
              the Loại hàng segmented control LEADS the form — QA mở form mặc
              định thấy ngay lựa chọn Hàng lẻ, không cần biết trick — and the
              LCL schedule field (181026200700: ONE always-visible field, no
              "+" reveal; SIL-587: "Ngày giờ đóng trả" ngày + giờ) mở sẵn right
              beside it, so after one click everything is trước mắt. FCL keeps
              its full schedule section below. */}
          <ShipmentCreateSection id="mode">
            <div className="csc-mode-band__row">
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
                          disabled={controlsDisabled}
                        />
                        <span className="csc-mode__option">{mode === 'FCL' ? 'Hàng FCL' : 'Hàng lẻ'}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              {form.cargoMode === 'LCL' && (
                <div className="csc-lcl-delivery" data-field-id="shipment-lcl-closing-at">
                  {/* SIL-587 (id 687, khách 29/10 — supersedes the 2026-10-13
                      "Ngày giao hàng" copy): hàng lẻ's single schedule field is
                      "Ngày giờ đóng trả" (ngày + giờ), the same datetime shape
                      the FCL per-cont rows use. The payload maps it
                      direction-correct and derives expectedDeliveryDate from
                      its VN date (shipment-create-model §lclClosingAt). */}
                  <UDateTimeField
                    id="shipment-lcl-closing-at"
                    label="Ngày giờ đóng trả"
                    requiredMark
                    value={form.lclClosingAt}
                    onChange={(event) => update('lclClosingAt', event.target.value)}
                    disabled={controlsDisabled}
                    error={issueByField.get('shipment-lcl-closing-at')}
                    combinedPicker
                  />
                </div>
              )}
              {/* SIL-598 (id 698, quét sạch khoảng trắng 30/10): FCL's bulk
                  schedule field joins the mode band — the SAME SIL-587
                  doctrine that put the LCL datetime beside Loại hàng
                  ("everything trước mắt"). Alone in the schedule band it
                  left a ~265px dead strip in its column and, off its row,
                  the stretched mode card ~170px of empty surface
                  (qa/2026-10-30_sil598-before). SIL-617 (id 721, owner
                  31/10) supersedes the old `emptyAppointmentCount >= 1`
                  gate: once every cont carried a schedule the band
                  unmounted and cuộn hết form cũng không thấy — the one
                  place to đặt/đổi giờ hẹn cho tất cả cont vanished exactly
                  when the form was filled. The band is now ALWAYS visible
                  in FCL (trống hay đã điền đủ); its Copy still writes only
                  into rows that lack a schedule (applyBulkAppointmentToRows),
                  so a filled form shows the band as a readable surface
                  without any dead apply. */}
              {form.cargoMode === 'FCL' && (
                <div className="csc-bulk-appointment" data-field-id="shipment-bulk-appointment">
                  {/* SIL-625 (id 729, owner 31/10): the visible label
                      "Ngày giờ đóng trả cho tất cả cont" is retired — the
                      two segment inputs + the Copy affordance stay. The
                      group's aria-label keeps the name for screen readers. */}
                  <UDateTimeField
                    id="shipment-bulk-appointment"
                    label="Ngày giờ đóng trả cho tất cả cont"
                    hideLabel
                    value={bulkAppointment}
                    onChange={(event) => setBulkAppointment(event.target.value)}
                    disabled={controlsDisabled}
                    combinedPicker
                  />
                  {/* FB-009 (card 131026233500) put a clipboard affordance
                      here; QA ruling 15:10 (retest 30/10, ticket 710)
                      upgraded it: the button now ALSO WRITES the value
                      typed HERE into every still-unscheduled container row
                      (applyBulkAppointmentToRows — CUS-03), with the toast
                      reporting the write. The clipboard copy stays as the
                      bonus channel. */}
                  {bulkAppointmentCopyValue && (
                    <CopyCodeButton
                      className="csc-bulk-appointment__copy"
                      value={bulkAppointmentCopyValue}
                      label="giờ hẹn đóng trả"
                      onCopied={() => applyBulkAppointmentToRows()}
                    />
                  )}
                </div>
              )}
            </div>
          </ShipmentCreateSection>
          <ShipmentCreateIdentitySection
            form={form}
            update={update}
            selectCustomer={selectCustomer}
            customerOptions={customerOptions}
            shippingLineOptions={shippingLineOptions}
            customerCustomText={customerCustomText}
            saving={controlsDisabled}
            issueByField={issueByField}
            billConflict={billConflict}
            bookingConflict={bookingConflict}
            customerAddButtonRef={customerAddButtonRef}
            shippingLineAddButtonRef={shippingLineAddButtonRef}
            onOpenCustomerDialog={() => setCustomerDialogOpen(true)}
            onOpenShippingLineDialog={() => setShippingLineDialogOpen(true)}
            editMode={Boolean(editTarget)}
          />

          {form.cargoMode === 'LCL' && (
            <ShipmentCreateLclRouteSection
              form={form}
              update={update}
              routeOptions={routeOptions}
              operationalSites={operationalSites}
              warehouseSites={warehouseSites}
              warehouseSitesLoading={warehouseCatalogLoading}
              selectedOperationalSite={selectedOperationalSite}
              selectOperationalSite={selectOperationalSite}
              routeCustomText={routeCustomText}
              factoryCustomText={factoryCustomText}
              warehouseCustomText={warehouseCustomText}
              routeAddButtonRef={routeAddButtonRef}
              setRouteDialogOpen={setRouteDialogOpen}
              openCreateSiteDialog={openCreateSiteDialog}
              setDetailSite={setDetailSite}
              saving={controlsDisabled}
              sitesLoading={sitesLoading}
              issueByField={issueByField}
            />
          )}

          <ShipmentCreateSection id="cargo" title="Thông tin hàng" description="Nhập chi tiết phù hợp với hàng FCL hoặc hàng lẻ.">
            {form.cargoMode === 'FCL' ? (
              <>
                <ShipmentContainerEditor
                  saving={controlsDisabled}
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
                          onDuplicate={duplicateContainer}
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
                          onAddFactory={() => openCreateSiteDialog('FACTORY')}
                          saving={controlsDisabled}
                          routeOptions={routeOptions}
                          portOptions={portOptions}
                        />
                      ))}
                    </>
                  }
                />
                {/* SIL-611 (id 714, owner 30/10): the copy-down affordance
                    rides the Thông tin hàng section now — directly under the
                    table it fills — because the "Lịch & ghi chú" band it
                    lived in is gone (that band's datetime had already moved
                    up beside Loại hàng: LCL per SIL-587, FCL bulk per
                    SIL-598). Same gate as before: a scheduled source + rows
                    still without a schedule. */}
                {copySourceRow && emptyAppointmentCount >= 1 && (
                  <button
                    type="button"
                    className="csc-utility-button csc-utility-button--dashed"
                    style={{ justifySelf: 'start', alignSelf: 'start', width: 'fit-content' }}
                    title={`Copy ngày giờ ${formatDateTime24(copySourceRow.customerAppointmentAt) || copySourceRow.customerAppointmentAt} từ dòng đầu tiên có lịch sang các container chưa có lịch`}
                    onClick={() => copyAppointmentToEmpty(copySourceRow.key)}
                    disabled={controlsDisabled}
                  >
                    <Copy size={15} aria-hidden="true" />Copy giờ hẹn xuống cont trống
                  </button>
                )}
              </>
            ) : (
              <ShipmentCreateLclCargoFields
                form={form}
                update={update}
                saving={controlsDisabled}
                issueByField={issueByField}
              />
            )}
          </ShipmentCreateSection>

          {/* SIL-611 (id 714, owner 30/10): "Ghi chú" is the form's LAST
              band — the two note boxes moved below Thông tin hàng when the
              "Lịch & ghi chú" band was deleted (its datetime fields had
              already moved up beside Loại hàng). The new order is
              Nhận diện lô (gọn) → Thông tin hàng → Ghi chú. SIL-587's
              ruling stands unchanged: hàng lẻ renders NO notes band — its
              form ends at Thông tin hàng. SIL-534 (owner 27/10): rows=2
              keeps each box ~2 lines tall (resize:vertical and the
              internal scroll still carry long notes; the ≥1280 onescreen
              band forces 48px read-only height). */}
          {form.cargoMode === 'FCL' && (
            <ShipmentCreateSection id="notes" title="Ghi chú">
              <div className="csc-notes-grid">
                <TextAreaField label="Ghi chú cho khách hàng" value={customerNotes} onChange={(event) => { setCustomerNotes(event.target.value); clearFeedback(); }} rows={2} maxLength={2000} placeholder="Thông tin cần gửi hoặc lưu ý cần theo dõi với khách hàng" disabled={controlsDisabled} />
                <TextAreaField label="Ghi chú cho lái xe" value={form.operationalNotes} onChange={(event) => update('operationalNotes', event.target.value)} rows={2} maxLength={2000} placeholder="Hướng dẫn và lưu ý cần thiết cho lái xe" disabled={controlsDisabled} />
              </div>
            </ShipmentCreateSection>
          )}
        </div>

        <FreightPreviewCard
          customerId={form.customerId ? Number(form.customerId) : undefined}
          routeId={previewRouteId ? Number(previewRouteId) : undefined}
          vehicleSizeClassCode={previewSizeClass ?? undefined}
          transportDate={previewTransportDate || undefined}
          isAdHoc={form.isAdHoc}
        />

        {/* SIL-510 (owner 26/10): the worksheet's ONE action bar — the FB-108
            end-of-worksheet repetition is promoted to the viewport-fixed
            footer (always visible while scrolling, one row, actions
            right-aligned) and the topline twin is retired, so a clerk never
            sees two action bars on one viewport. The DOM stays the form's
            last element, so "the bar rides the form's submit" keeps being
            literally true. */}
        <div ref={actionBarRef} className="csc-form-actions">
          {viewMode ? (
            /* SIL-481: the read-only review bar repeats the VIEW cluster
             * (Quay lại / Sửa / Tạo mới lô hàng — SIL-500), not a save cluster. */
            <ShipmentViewActions
              onBack={goShipmentList}
              onEdit={viewCanEditLot ? goEdit : undefined}
              editLocked={viewLocked}
              onCreateNew={viewCreateNew}
            />
          ) : (
            <ShipmentCreateActions
              mode={editTarget ? 'edit' : 'create'}
              saving={saving}
              onCancel={goBack}
              onSaveDraft={() => void save('DRAFT')}
              onCreate={() => void save('CREATE')}
            />
          )}
        </div>
      </form>

      <ShipmentCreateModals
        detailSite={detailSite}
        onCloseDetailSite={() => setDetailSite(null)}
        createSiteDialog={createSiteDialog}
        tradeDirection={form.tradeDirection}
        customerId={form.customerId}
        customers={dialogCustomers}
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
