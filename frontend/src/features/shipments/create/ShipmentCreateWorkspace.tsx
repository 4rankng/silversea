import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime24 } from '../../../lib/format';
import { EmptyState } from '../../../design-system';
import {
  UTextAreaField as TextAreaField,
} from './uui-fields';
import { UDateTimeField } from './uui-datetime-field';
import { useToast } from '../../../components/shared/Toast';
import { tripClient, type CatalogData } from '../../../api/tripClient';
import {
  createShippingLine,
  deleteCusShipment,
  listOperationalSites,
  listSharedWarehouseSites,
  type OperationalSite,
} from '../../../api/shipmentClient';
import { expenseAccountingClient, type ExpenseAccountingCatalog } from '../../../api/expenseAccountingClient';
import { ExpenseCreateDrawer } from '../../expense-accounting/ExpenseCreateDrawer';
import { qk } from '../../../api/keys';
// SIL-688: the confirm modal's error voice — BE 409 lifecycle reasons must
// reach the operator verbatim (they name the blocking rule).
import { safeError } from '../cus/cusUtils';
import { useShipmentReferenceDuplicateGuard } from './use-shipment-reference-duplicate-guard';
import { useShipmentWorkspacePrefill } from './use-shipment-workspace-prefill';
import { DocumentSetCard } from '../detail/DocumentSetCard';
import { ShipmentLotStatusBlock } from '../detail/ShipmentLotStatusBlock';
import { ShipmentPairFacts } from '../detail/ShipmentPairFacts';
import '../detail/ShipmentLotStatusBlock.css';
import { mergeCustomer, mergePort, mergeRoute, mergeShippingLine, shouldPersistShippingLine } from './catalogMerger';
import {
  EMPTY_SHIPMENT_CREATE_FORM,
  createContainerFromPrevious,
  duplicateContainerRow,
  createEmptyContainer,
  getShipmentCreateReadiness,
  customerSwitchClearedState,
  type CargoMode,
  type SaveIntent,
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
  type ShipmentCreateIssue,
} from './shipment-create-model';
import { focusShipmentCreateIssue as focusIssue } from './shipment-create-focus';
import { useVehicleSizeClasses } from '../../../hooks/useCatalogQueries';
import { useFixedActionClearance } from '../../../hooks/useFixedActionClearance';
import { ShipmentCreateTopline } from './ShipmentCreateTopline';
import { ShipmentDeclarationSection } from './ShipmentDeclarationSection';
import { ShipmentDeclarationReviewBand } from './ShipmentDeclarationReviewBand';
import { ShipmentCreateActions } from './ShipmentCreateActions';
import { ShipmentViewActions } from './ShipmentViewActions';
import { requiredCompletion, missingRequiredLabels } from './ShipmentCreateTopline.progress';
import { FreightPreviewCard } from './FreightPreviewCard';
import { ShipmentCreateSection } from './ShipmentCreateSections';
import { ShipmentContainerEditor } from './ShipmentContainerEditor';
import { hasDateDraft } from './shipment-date-drafts';
import { DEFAULT_SHIPPING_LINES, type Customer, type Port, type Route } from '@tingting/shared';
import { useShipmentCreateWorkflow } from './use-shipment-create-workflow';
import { useShipmentCreateDraft, clearAllCreateDrafts, type ShipmentCreateDraftState } from './shipment-create-draft';
import { usePageLeaveGuard } from '../../../hooks/usePageLeaveGuard';
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
// SIL-789 (KB Ch3 §3.4.3): a locked lot kills the per-container tờ khai cell
// server-side — the cell names the lock with the KB sentence instead of
// reading as a dead affordance (the reason line the QA card requires).
const LOCKED_DECLARATION_REASON = 'Lô hàng đã khóa kế toán; không thể sửa tờ khai.';

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
   *  decides the role gate; the workspace layers the accounting lock on top.
   *  `canDeleteLot` (SIL-688) follows the same pattern: the host reads
   *  useAuth (BE delete = CUS/ADMIN), the workspace owns the confirm +
   *  version/lifecycle guards. */
  viewTarget?: { shipmentId: number; canEditLot?: boolean; canDeleteLot?: boolean; /** SIL-453: the host's ADMIN/MANAGER/ACCOUNTANT/CUS gate for the lot-scope cost entry (BE lot-lane role law, SIL-961). */ canDeclareCost?: boolean; /** SIL-720: the host's SIL-551 gate for the per-container tờ khai write (ADMIN/MANAGER/CUS/DISPATCHER). */ canEditDeclaration?: boolean };
} = {}) {
  const navigate = useNavigate();
  const viewMode = Boolean(viewTarget);
  /** Role gate decided by the host page (it owns useAuth): may this viewer
   *  open the edit form? The lock is applied on top once the detail lands. */
  const viewCanEditLot = Boolean(viewTarget?.canEditLot);
  const viewCanDeleteLot = Boolean(viewTarget?.canDeleteLot);
  // SIL-453 (FB-098 restore): the review page's "Khai chi phí" gate — the
  // role half here, the accounting-lock half applied once the detail lands.
  const viewCanDeclareCost = Boolean(viewTarget?.canDeclareCost);
  // SIL-720 (id 840): the per-container tờ khai edits INLINE on the lot page
  // (view mode) — the writer law is the host's (SIL-551), the accounting-lock
  // half is applied here once the detail lands.
  const viewCanEditDeclaration = Boolean(viewTarget?.canEditDeclaration);
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
  const [pendingModeSwitch, setPendingModeSwitch] = useState<CargoMode | null>(null);
  const [pendingCustomerSwitch, setPendingCustomerSwitch] = useState<string | null>(null);
  const [pendingContainerDelete, setPendingContainerDelete] = useState<ContainerRow | null>(null);
  // SIL-1160 (K10.16): reasons the clicked container cannot be deleted
  // (live trip / số tờ khai) — null = no blocked dialog.
  const [blockedContainerDeleteReasons, setBlockedContainerDeleteReasons] = useState<string[] | null>(null);
  // SIL-688 (id 800 — QA 06/11): the view-mode Xóa lô flow — confirm modal
  // with a REQUIRED reason (the BE answers 400 without one), the lot's
  // optimistic-lock version, and the lifecycle guards (accounting lock /
  // dispatched legs) layered on the host's role gate.
  const [deleteLotOpen, setDeleteLotOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteLotError, setDeleteLotError] = useState<string | null>(null);
  const [deleteLotSubmitting, setDeleteLotSubmitting] = useState(false);
  const [shippingLineDialogOpen, setShippingLineDialogOpen] = useState(false);
  const shippingLineAddButtonRef = useRef<HTMLButtonElement>(null);
  // SIL-453 (FB-098 restore, QA fail 06/11): the review page's cost entry —
  // "Khai chi phí" opens the shared "Thêm khoản chi" drawer at LOT scope
  // (tripId null), the exact mount the pre-SIL-481 detail page ran. The
  // catalog loads on open; a failed fetch closes loudly instead of a dead
  // drawer.
  const [costDrawerOpen, setCostDrawerOpen] = useState(false);
  const [costCatalog, setCostCatalog] = useState<ExpenseAccountingCatalog | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!costDrawerOpen || costCatalog) return;
    let cancelled = false;
    expenseAccountingClient.catalog()
      .then((value) => { if (!cancelled) setCostCatalog(value); })
      .catch(() => {
        if (cancelled) return;
        setCostDrawerOpen(false);
        toast({ kind: 'error', message: 'Không tải được danh mục khoản chi. Vui lòng thử lại.' });
      });
    return () => { cancelled = true; };
  }, [costCatalog, costDrawerOpen, toast]);
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
  const { editSeed, editLoadError, viewLocked, editBaselineRef, viewDocumentSet, viewStatusSummary, viewPairFacts, reload: reloadLot } = useShipmentWorkspacePrefill({
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

  // SIL-1080 (K2.16, KB §3.2.2 "đổi khách hàng → chỉ rõ trường cần chọn lại"):
  // the confirm dialog names EVERY factory/kho the switch deletes and shows the
  // "Bắt buộc" chip's before/after — the same `customerSwitchClearedState`
  // wipe and `requiredCompletion` denominator the chip renders.
  const customerSwitchImpact = useMemo(() => {
    if (pendingCustomerSwitch === null) return null;
    const label = (siteId: string, typed: string) => {
      const site = siteId ? payloadSiteCatalog.find((item) => String(item.id) === siteId) : undefined;
      // The DIALOG names the site being deleted — full name first (the QA
      // repro reads "ASKEY-XƯỞNG 1", not its short code).
      return (site ? site.name || site.shortName || '' : '') || typed.trim();
    };
    const names = [
      label(form.operationalSiteId, form.factoryName),
      ...containers.map((row) => label(row.operationalSiteId, row.rawFactoryName)),
      label(form.pickupWarehouseSiteId, form.pickupWarehouseName),
      ...form.extraPickupWarehouses.map((row) => (row.siteId ? label(row.siteId, '') : row.name.trim())),
    ].filter(Boolean);
    const cleared = customerSwitchClearedState(form, containers, sites);
    return {
      names: Array.from(new Set(names)),
      before: requiredCompletion(form, containers, []),
      after: requiredCompletion(cleared.form, cleared.containers, []),
    };
  }, [pendingCustomerSwitch, form, containers, sites, payloadSiteCatalog]);

  // SIL-933 — the preview card must live on the LCL branch too: the lot's
  // own route + 'Trọng tải (Loại xe tính cước)' pick + ngày giờ đóng/trả are
  // the bảng giá grounds (the same trio the create payload builds), so the
  // operator sees the estimated freight BEFORE saving — the frame FCL rows
  // get from their first container. An unpicked class or empty day keeps the
  // card hidden (no grounds, no number).
  const vehicleClasses = useVehicleSizeClasses();
  const isLclPreview = form.cargoMode === 'LCL';
  const previewRow = containers[0];
  const previewTypeCode = (catalogs?.containerTypes ?? [])
    .find((item) => String(item.id) === previewRow?.containerTypeId)?.code ?? null;
  const previewNormalized = previewTypeCode ? previewTypeCode.trim().toUpperCase() : '';
  const previewSizeClass = isLclPreview
    ? (vehicleClasses.data ?? []).find((vc) => !vc.deletedAt && String(vc.id) === form.revVehicleClassId)?.code ?? null
    : previewNormalized.startsWith('20') ? 'CONT20'
      : (previewNormalized.startsWith('40') || previewNormalized.startsWith('45')) ? 'CONT40'
        : null;
  const previewRouteId = isLclPreview
    ? (form.routeId || null)
    : (previewRow?.routeId || null);
  const previewTransportDate = isLclPreview
    ? (form.lclClosingAt ? form.lclClosingAt.slice(0, 10) : form.expectedDeliveryDate.slice(0, 10))
    : previewRow?.customerAppointmentAt
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

  // ── UX-03 (QA 28/11, staging): leaving /shipments/new through the sidebar,
  // browser Back or a refresh threw the typed draft away without a word. The
  // worksheet runs the house leave guard (usePageLeaveGuard — the POD page's
  // law): the Huỷ button, sidebar/app navigations and plain links ask through
  // the three-button draft dialog (Tiếp tục nhập / Lưu nháp / bỏ thay đổi),
  // browser Back answers through its native confirm, and refresh is fenced by
  // beforeunload while the typed draft mirrors into sessionStorage keyed per
  // mode. A pristine form binds nothing and navigates directly; a successful
  // save clears both the guard (unmount) and the stored draft.
  const createMode = !viewMode && !editTarget;
  const dirtyWithDateDraft = isDirty || hasDateDraft(workspaceFormRef.current);
  const shipmentDraft = useShipmentCreateDraft({
    active: createMode,
    dirty: dirtyWithDateDraft,
    form,
    containers,
    customerNotes,
    applyDraft: (draft: ShipmentCreateDraftState) => {
      setForm(draft.form);
      setContainers(draft.containers);
      setCustomerNotes(draft.customerNotes);
    },
  });
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const leaveResolverRef = useRef<((leave: boolean) => void) | null>(null);
  // usePageLeaveGuard's confirm contract is a boolean promise; the dialog's
  // Lưu nháp branch resolves "stay" and starts the draft save — a successful
  // draft save then navigates through onSaved below, a failed one keeps the
  // operator on the (re-guarded) form.
  function confirmLeave() {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    leaveResolverRef.current = resolve;
    setLeaveDialogOpen(true);
    return promise;
  }
  function settleLeaveDialog(leave: boolean) {
    const resolve = leaveResolverRef.current;
    leaveResolverRef.current = null;
    setLeaveDialogOpen(false);
    if (leave) {
      // UX-03: an explicit discard — the stored draft dies with the form
      // state it mirrors, so a later refresh never resurrects the abandoned
      // entries.
      clearAllCreateDrafts();
    }
    resolve?.(leave);
  }
  function saveDraftFromLeaveDialog() {
    settleLeaveDialog(false);
    if (!saving) void save('DRAFT');
  }

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
    // UX-03: a successful save IS the leave — the stored draft dies with it
    // and the guard clears as the workspace unmounts. onSaved replaces the
    // hook's internal landing with the SAME destination law (create → the
    // lot just created; edit's button save → the lot detail, its Enter law
    // (landing 'list') → the lot list).
    onSaved: (shipmentId, _intent, opts) => {
      shipmentDraft.clearAllDrafts();
      navigate(opts?.landing === 'list' ? '/shipments' : `/shipments/${shipmentId}`);
    },
  });

  // Every exit rides one guard: Huỷ, sidebar (requestAppNavigation), plain
  // links and ESC-back ask through the draft dialog; browser Back answers
  // through window.confirm; a save in flight blocks the leave entirely (the
  // hook's contract).
  const handleBack = usePageLeaveGuard({
    dirty: dirtyWithDateDraft,
    saving: Boolean(saving),
    message: 'Thông tin chưa lưu sẽ bị mất. Bỏ thay đổi và rời trang?',
    confirm: confirmLeave,
    onBack: leaveWorkspace,
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

  function applyCustomerSwitch(value: string) {
    // UX-03: same law as the mode switch — the confirmed customer wipe must
    // not survive in the stored draft; the debounce re-saves the cleared
    // state if anything remains typed.
    shipmentDraft.clearAllDrafts();
    // SIL-1080 (K2.16): the wipe is `customerSwitchClearedState` — the SAME
    // preview the confirm dialog showed (names + required-count change).
    const cleared = customerSwitchClearedState(form, containers, sites);
    setContainers(cleared.containers);
    setForm((_current) => ({ ...cleared.form, customerId: value }));
    setSites([]);
    clearFeedback();
  }

  function selectCustomer(value: string) {
    if (value === form.customerId) return;
    const hasCustomerScopedSite = Boolean(
      form.customerId && (
        form.operationalSiteId
        || form.factoryName.trim()
        || form.pickupWarehouseSiteId
        || form.pickupWarehouseName.trim()
        || form.extraPickupWarehouses.length > 0
        || containers.some((row) => row.operationalSiteId || row.rawFactoryName.trim())
      ),
    );
    if (hasCustomerScopedSite) {
      setPendingCustomerSwitch(value);
      return;
    }
    applyCustomerSwitch(value);
  }

  function confirmCustomerSwitch() {
    const next = pendingCustomerSwitch;
    setPendingCustomerSwitch(null);
    if (next !== null) applyCustomerSwitch(next);
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
      ? Boolean(form.packageType || form.packageCount || form.cargoWeightKg || form.cargoVolumeCbm || form.cargoTypeId || form.operationalSiteId || form.pickupWarehouseSiteId || form.pickupWarehouseName.trim() || form.factoryName.trim() || form.extraDeliveryDates.some(Boolean) || form.lclClosingAt || form.declarationNumber.trim()) || hasDateDraft(workspaceFormRef.current, true)
      : containers.some((row) => Object.entries(row).some(([key, value]) => key !== 'key' && value)) || hasDateDraft(workspaceFormRef.current?.querySelector('.csc-container-editor'));
    if (hasModeData) {
      setPendingModeSwitch(next);
      return;
    }
    applyModeSwitch(next);
  }

  function applyModeSwitch(next: CargoMode) {
    // UX-03: the switch the operator just confirmed WIPES that mode's entries
    // — the stored draft dies with them and must never resurrect the wiped
    // data on the next visit (the debounce re-saves the surviving state).
    shipmentDraft.clearModeDraft(form.cargoMode);
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
      // SIL-765: the extra pickup-warehouse rows are LCL-only intake state —
      // wiped on the way to FCL, kept on the way back to LCL.
      extraPickupWarehouses: next === 'FCL' ? [] : current.extraPickupWarehouses,
      factoryName: next === 'FCL' ? '' : current.factoryName,
      // SIL-587: the LCL schedule datetime never survives into an FCL payload
      // (FCL's schedule lives per container; the confirm gate above already
      // asked before this wipe).
      lclClosingAt: next === 'FCL' ? '' : current.lclClosingAt,
      // SIL-660: the LCL lot-level declaration is mode-scoped the same way —
      // wiped on the way to FCL (per-cont law there), kept on the way to LCL.
      declarationNumber: next === 'FCL' ? '' : current.declarationNumber,
      // SIL-1133: "Mô tả hàng hóa" is LCL-only state like the rest of the
      // hàng-lẻ cargo block — wiped on the way to FCL.
      cargoDescription: next === 'FCL' ? '' : current.cargoDescription,
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
    setContainers((current) => {
      const prevFirstDecl = current[0]?.declarationNumber ?? '';
      const isFirstDeclarationEdit = field === 'declarationNumber' && current[0]?.key === key;
      return current.map((row, idx) => {
        if (row.key === key) return { ...row, [field]: value };
        // K2.13: typing declarationNumber on Container 1 propagates to sibling
        // containers that are still blank or matched Container 1's prior value,
        // while preserving any sibling explicitly edited to a different number.
        if (isFirstDeclarationEdit && idx > 0 && (row.declarationNumber === '' || row.declarationNumber === prevFirstDecl)) {
          return { ...row, declarationNumber: value };
        }
        return row;
      });
    });
    clearFeedback();
  }

  // Case 2026-10-11-R14-02 (FB-008 round 14): bulk delivery-schedule entry.
  // SIL-511 (owner 26/10) retired the 'Áp dụng cho N container' chip and
  // SIL-642 (id 746, owner 31/10) retired the band datetime — the schedule's
  // only entry surface is the container table's NGÀY GIỜ ĐÓNG TRẢ column.
  // SIL-690 (FB-008, owner 06/11) then ordered the bulk-apply affordance
  // BACK: copy-down-to-empty alone could not retune rows that ALREADY hold a
  // schedule, so a multi-cont lot with a moved closing date had no one-shot
  // path. `applyAppointmentToAll` restores the R17/R22 contract — the first
  // scheduled row is the source, EVERY other row (empty or filled) receives
  // it, the toast confirms — while the schedule keeps its single per-row
  // surface (no second datetime input is resurrected).
  const copySourceRow = containers.find((row) => row.customerAppointmentAt);
  function applyAppointmentToAll(fromKey: string) {
    const source = containers.find((row) => row.key === fromKey)?.customerAppointmentAt;
    if (!source) return;
    const total = containers.length;
    if (total < 2) return;
    setContainers((current) => current.map((row) => (
      row.key === fromKey ? row : { ...row, customerAppointmentAt: source }
    )));
    toast({ kind: 'success', message: `Đã áp dụng ngày giờ đóng trả cho ${total} container` });
  }

  // Ticket 211026125242 (CUS-03) — RETIRED by SIL-513 (owner 26/10): the
  // "Copy giờ hẹn cho tất cả N cont" chip is gone. SIL-690's apply-all above
  // supersedes the old copy-down-to-empty button (empty rows are covered by
  // the bulk write; per-row hover copy keeps its own clipboard law).

  // FB-009 (2026-10-14): the per-row copy-time affordance — the time itself
  // lands in the OS clipboard so a clerk can paste it anywhere; the toast
  // confirms what was copied. Independent of the copy-down feature above:
  // it renders whenever the row holds a schedule, never gated on siblings.
  function notifyAppointmentCopied(formatted: string) {
    toast({ kind: 'success', message: `Đã copy giờ hẹn ${formatted}` });
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
  // date). SIL-611 (id 714, owner 30/10) then deleted the FCL "Lịch & ghi
  // chú" band too, and SIL-642 (id 746, owner 31/10) retired the FCL bulk
  // datetime that had moved into the top mode band (SIL-598): the form is
  // now Nhận diện lô (gọn) → Thông tin hàng → Ghi chú, FCL's schedule lives
  // ONLY in the container table's required NGÀY GIỜ ĐÓNG TRẢ column, and the
  // copy-down button under that table stays the fill-everywhere affordance.

  function removeContainer(row: ContainerRow, scope: HTMLTableRowElement | null) {
    // SIL-1160 (K10.16): a persisted container already riding a live trip —
    // or carrying a số tờ khai — cannot die on this form: the save's
    // reconcile refuses exactly these rows (409 with its recovery message).
    // The dialog NAMES the reasons here instead of failing silently at save.
    const reasons = containerDeleteBlockReasons(row);
    if (reasons.length > 0) {
      setBlockedContainerDeleteReasons(reasons);
      return;
    }
    const hasEnteredData = Object.entries(row).some(([key, value]) => key !== 'key' && value !== '' && value !== undefined) || hasDateDraft(scope);
    if (hasEnteredData) {
      setPendingContainerDelete(row);
      return;
    }
    discardContainer(row);
  }

  function containerDeleteBlockReasons(row: ContainerRow): string[] {
    if (row.id == null) return [];
    const reasons: string[] = [];
    if (editSeed?.liveTripContainerIds?.includes(row.id)) {
      reasons.push('Container đã gắn chuyến xe — hủy hoặc thay thế lệnh điều xe trước khi xóa');
    }
    const declared = row.declarationNumber.trim();
    if (declared !== '') {
      reasons.push(`Cont có tờ khai ${declared} — gỡ tờ khai trước khi xóa`);
    }
    return reasons;
  }

  function discardContainer(row: ContainerRow) {
    setContainers((current) => current.filter((item) => item.key !== row.key));
    clearFeedback();
  }

  // SIL-1144 (KB §3.4.1 "thao tác xóa là cục bộ từng dòng"): the register's
  // per-row delete clears ONLY that row's number. It deliberately bypasses
  // updateContainer's K2.13 fan-out — that propagation exists for TYPING
  // cont 1's number across still-blank siblings; a delete must never
  // mass-clear the siblings that legitimately share the number (SIL-521:
  // same-lot repeats are legal).
  function clearContainerDeclaration(key: string) {
    setContainers((current) => current.map((row) => (
      row.key === key ? { ...row, declarationNumber: '' } : row
    )));
    clearFeedback();
  }

  // SIL-1144: "Thêm tờ khai" grows the lot by ONE declaration slot — a new
  // container row through the table's own row-add convention
  // (createContainerFromPrevious, KB §3.2.5 "+ THÊM CONT"). The KB §3.4.1
  // copy law ("số tờ khai đầu tiên của lô tự điền vào các container còn
  // trống") re-fills the blank at save unless the operator types a fresh
  // number; sibling required fields inherit per the REQ-22-reversed split.
  function addDeclarationRow() {
    setContainers((current) => [...current, createContainerFromPrevious(current[current.length - 1])]);
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

  // SIL-688: the review-page delete. The BE (`DELETE /shipments/cus-workspace/:id`,
  // CUS/ADMIN, version + reason) stays the authority — a dispatched leg it
  // disagrees about answers 409 and the reason lands in the modal verbatim.
  // Success follows the list drawer's contract: toast "Đã xóa lô hàng." and
  // the deterministic home (/shipments).
  async function submitDeleteLot() {
    if (!viewTarget || !editSeed || deleteLotSubmitting) return;
    if (!deleteReason.trim()) {
      setDeleteLotError('Lý do là bắt buộc.');
      return;
    }
    setDeleteLotSubmitting(true);
    setDeleteLotError(null);
    try {
      await deleteCusShipment(viewTarget.shipmentId, editSeed.version, deleteReason.trim(), crypto.randomUUID());
      setDeleteLotOpen(false);
      toast({ kind: 'success', message: 'Đã xóa lô hàng.' });
      navigate('/shipments');
    } catch (error) {
      setDeleteLotError(safeError(error, 'Không thể xóa lô hàng. Vui lòng thử lại.'));
    } finally {
      setDeleteLotSubmitting(false);
    }
  }

  // UX-03: the Huỷ button asks through the same draft dialog as every other
  // exit — it supersedes the private backConfirm modal (one dirty-leave idiom
  // for the worksheet). Pristine forms navigate directly.
  function goBack() {
    handleBack();
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

  // SIL-335 (owner ruling 06/11 "ten hang tau go tay must be saved to db"):
  // a carrier name typed straight into the combobox (no ✎ dialog) must reach
  // the shared SHIPPING_LINE catalog too — the pencil path persists on apply
  // (applyShippingLine); this covers the free-typed path on every save in
  // both create and edit mode, for every intake role (khách + Ops/điều vận).
  // Best-effort per the ruling: blank/garbage (empty after trim) simply
  // skips; a catalog hiccup warns but never blocks the lot save.
  async function persistTypedShippingLine() {
    const name = form.shippingLineName.trim();
    if (!shouldPersistShippingLine(name, catalogs)) return;
    try {
      const result = await createShippingLine(name);
      mergeShippingLine(catalogs, result.name, setCatalogs);
    } catch {
      toast({ kind: 'warning', message: `Không lưu được hãng tàu "${name}" vào danh mục chung — lô hàng vẫn được lưu.`, duration: 6000 });
    }
  }

  async function save(intent: SaveIntent, opts?: { landing?: 'list' }) {
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
    await persistTypedShippingLine();
    const result = await runSave(intent, opts);
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
  // SIL-1266: the empty-catalogs precondition is a CREATE-flow gate ("you
  // cannot create a lot with no customer to bill"). On the pinned-lot routes
  // (/shipments/:id view, /shipments/:id/edit) the lot already exists, so a
  // stripped or failed catalog there must never surface this create copy —
  // the workspace renders the lot with whatever labels resolved (a portal
  // role's bootstrap strip is a label concern, not a "cannot create" verdict).
  if (createMode && !catalogs?.customers.length) return <EmptyState context="clients" title="Chưa có khách hàng" description="Cần ít nhất một khách hàng trước khi tạo lô hàng." />;

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
        // SIL-1145 (QA-Retest4): below 9/9 (or the mode's total) the chip no
        // longer sits alone — the hint names the missing required fields, in
        // slot order, with the same labels the stars use.
        missingLabels={missingRequiredLabels(form, containers)}
        actions={workspaceMode === 'create' ? (
          /* SIL-917 (KB §3.2.7, audit 24/11): the Huỷ / Lưu nháp / Tạo lô
             hàng cluster rides the page HEAD again — the fixed footer below
             stays as the scroll-stable twin with its "(cuối trang)" labels.
             One shared save/cancel/saving state drives both bars. */
          <ShipmentCreateActions
            mode="create"
            bar="head"
            saving={saving}
            onCancel={goBack}
            onSaveDraft={() => void save('DRAFT')}
            onCreate={() => void save('CREATE')}
          />
        ) : undefined}
      />
      <form
        ref={workspaceFormRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // Read-only review: nothing may submit — the Enter law below and
          // the disabled controls already guarantee it; this is the backstop.
          if (viewMode) return;
          // SIL-938 (KB CUS-02 §7.2.1 K7.2): this onSubmit fires ONLY from
          // the form-level Enter law (both save bars are type="button"), so
          // in the EDIT form it is the KB's Enter contract — save AND exit
          // to the lot list. The 'Lưu thay đổi' click keeps SIL-171's
          // detail landing.
          void save('CREATE', editTarget ? { landing: 'list' } : undefined);
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
                  {/* SIL-616 (id 720, owner 31/10): the segmented shell IS the
                      control boundary — it carries the shared control-geometry
                      hooks (data-uui-control + data-control-size) so its
                      height is owned by the base law
                      ([data-uui-control] { min-height: var(--uui-control-h) },
                      sm = --control-compact-h, touch tokens at ≤768/coarse)
                      in src/components/untitled-ui/base/control-geometry.css.
                      House law (control-density.styles.test): control
                      dimensions live in the shared geometry layer, never in
                      page or feature stylesheets — the page keeps only the
                      option's paint (colors, padding, typography). */}
                  <div data-uui-control="segments" data-control-size="sm">
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
              {/* SIL-1133 (KB Chương 3 §3.2.4, QA-Retest4): the LCL schedule
                  datetime moved OUT of this band into the LCL-only
                  "Lịch & Ghi chú" section below Thông tin hàng — the KB bands
                  the LCL form with a titled schedule section ("Lịch & Ghi chú"
                  rút gọn còn 1 mục) instead of the SIL-639/SIL-662 inline
                  band row. The band is now exactly the Loại hàng decision in
                  BOTH modes. */}
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

          {/* AstraQA2 28/11: the description ("Nhập chi tiết phù hợp với
              hàng FCL hoặc hàng lẻ.") restated the Loại hàng decision the
              mode band directly above already carries — retired per the
              audit's label-restating-copy lever. */}
          <ShipmentCreateSection id="cargo" title="Thông tin hàng">
            {form.cargoMode === 'FCL' ? (
              <>
                <ShipmentContainerEditor
                  saving={controlsDisabled}
                  viewMode={viewMode}
                  isEditMode={Boolean(editTarget)}
                  isAdHoc={form.isAdHoc}
                  containersLength={containers.length}
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
                          viewMode={viewMode}
                          declarationContext={viewMode ? {
                            // SIL-720 (id 840): the inline tờ khai edit needs
                            // the lot's identity + version (the container-line
                            // command guards against a stale write) and the
                            // writer gate. A locked lot (accounting) refuses
                            // every write, so the affordance steps aside.
                            shipmentId: pinnedShipmentId ?? null,
                            version: editSeed?.version ?? null,
                            canEdit: viewCanEditDeclaration && !viewLocked,
                            lockedReason: viewLocked ? LOCKED_DECLARATION_REASON : undefined,
                            onSaved: reloadLot,
                          } : undefined}
                          routeOptions={routeOptions}
                          portOptions={portOptions}
                          dispatchedLocked={Boolean(editSeed?.hasDispatchedLegs)}
                          isEditMode={Boolean(editTarget)}
                          onOpenFactoryDetail={setDetailSite}
                        />
                      ))}
                    </>
                  }
                />
                {/* SIL-611 (id 714, owner 30/10): the bulk affordance rides
                    the Thông tin hàng section — directly under the table it
                    fills — because the "Lịch & ghi chú" band it lived in is
                    gone. SIL-690 (FB-008, owner 06/11) restores the R17/R22
                    contract: ONE click applies the first scheduled row's
                    ngày giờ đóng trả to EVERY container (empty or filled —
                    retuning rows that already hold a schedule is the defect
                    FB-008 reports), toast confirms. Same house dashed
                    utility button as its copy predecessor. */}
                {copySourceRow && containers.length >= 2 && !viewMode && (
                  <button
                    type="button"
                    className="csc-utility-button csc-utility-button--dashed"
                    style={{ justifySelf: 'start', alignSelf: 'start', width: 'fit-content' }}
                    title={`Áp dụng ngày giờ ${formatDateTime24(copySourceRow.customerAppointmentAt) || copySourceRow.customerAppointmentAt} của dòng đầu tiên có lịch cho tất cả ${containers.length} container (ghi đè lịch hiện có)`}
                    onClick={() => applyAppointmentToAll(copySourceRow.key)}
                    disabled={controlsDisabled}
                  >
                    <Copy size={15} aria-hidden="true" />Copy thời gian
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

          {/* SIL-1133 (KB Chương 3 §3.2.4): the LCL "Lịch & Ghi chú" section is
              BACK — the KB bands the hàng-lẻ form with a titled schedule
              section "rút gọn còn 1 mục": exactly the one "Ngày giờ đóng trả"
              datetime (SIL-587's field, unchanged id/state/payload law; the
              label carries its required mark as before). It moved out of the
              top mode band, which now leads with the Loại hàng decision alone
              in BOTH modes. FCL renders no schedule band here — its schedule
              lives ONLY in the container table's per-row Ngày giờ đóng trả
              column (SIL-611, KB §3.2.5). */}
          {form.cargoMode === 'LCL' && (
            <ShipmentCreateSection id="schedule" title="Lịch & Ghi chú">
              <div className="csc-lcl-delivery" data-field-id="shipment-lcl-closing-at">
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
            </ShipmentCreateSection>
          )}

          {/* SIL-611 (id 714, owner 30/10): "Ghi chú" band — the two note
              boxes ride below Thông tin hàng. SIL-1133 (KB Chương 3 §3.2.4)
              supersedes the "form ends at Thông tin hàng" wording for hàng
              lẻ: LCL now continues with its Lịch & Ghi chú section and the
              Tờ khai hải quan register; the notes band itself stays FCL-only
              (the KB's LCL schedule section holds no note boxes — "rút gọn
              còn 1 mục"). SIL-534 (owner 27/10): rows=2
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

          {/* SIL-1144 (KB Chương 3 §3.4, QA-Retest4): the "Tờ khai hải quan"
              register — the create/edit form's declaration management band
              (§3.2.1's band-4 slot). Per §3.4.1 the INPUT stays where the
              law pins it (FCL: the container table's Số tờ khai column; LCL:
              the ô beside Số Bill/Booking); this band is the management view
              over those same values with the §3.4.2 completeness voice —
              có tờ khai = ĐẦY ĐỦ, không có = VẪN THIẾU — a per-row local
              delete ("thao tác xóa là cục bộ từng dòng") and, on FCL, the
              add-row slot the container model grows declarations with.
              Create + edit only: the review page reads declarations through
              its own surfaces (inline cell + ledger). */}
          {!viewMode && (
            <ShipmentDeclarationSection
              form={form}
              containers={containers}
              saving={controlsDisabled}
              update={update}
              clearContainerDeclaration={clearContainerDeclaration}
              onAddDeclarationRow={addDeclarationRow}
            />
          )}

          {/* SIL-1144 (KB Ch.10 §10.6.7, QA-Retest4 28/11) — the review page
              gets the SAME band, wired to the page's own laws: the §3.4.2
              pills + the per-container clear riding the SIL-720 command (the
              one declaration write the review page already sanctions), no
              add slot (container mutation is the Sửa lô form's territory). */}
          {viewMode && (
            <ShipmentDeclarationReviewBand
              shipmentId={viewTarget?.shipmentId ?? null}
              version={editSeed?.version ?? null}
              isFcl={form.cargoMode === 'FCL'}
              rows={containers.map((row, index) => ({
                containerId: row.id ?? null,
                context: row.containerNumber.trim() || `Container ${index + 1}`,
                declarationNumber: row.declarationNumber,
              }))}
              lclDeclarationNumber={form.declarationNumber}
              canEdit={viewCanEditDeclaration && !viewLocked}
              lockedReason={viewLocked ? LOCKED_DECLARATION_REASON : null}
              onSaved={() => { void reloadLot(); }}
            />
          )}

          {/* SIL-1020 (KB Ch.3 §3.5 K3.40) — the review page's PHÂN LOẠI +
              tên lô ghép cùng block: the lot's one pair relation (the same
              relation /dispatch-detail, CUS, Lái xe and Kế toán read), the
              partner row only while the lot rides an ACTIVE pair. View mode
              only — the create form deliberately carries no PHÂN LOẠI
              (SIL-643); renders on EVERY viewed lot. */}
          {viewMode && viewPairFacts && (
            <ShipmentPairFacts facts={viewPairFacts} />
          )}

          {/* SIL-1073 (KB Ch3 §3.5.4, Lớp 2) — the review page's original-
              document-set card: the 3-state Lớp-2 status with the Người nhận +
              Ngày nhận thực tế gate and the missing-document names the
              "Nợ chứng từ" screen lists. View mode only — the card reads the
              lot version the seed already carries for the optimistic write. */}
          {viewMode && editSeed && viewDocumentSet && (
            <DocumentSetCard
              shipmentId={editSeed.shipmentId}
              version={editSeed.version}
              documentSet={viewDocumentSet}
              onSaved={reloadLot}
            />
          )}

          {/* SIL-1095 (KB §1.4.3, K1.13) — the review page's five-lane status
              block. Renders on EVERY viewed lot (QA: lô 167 had no status
              area at all) — a lane the wire does not carry yet reads '—'
              instead of vanishing. */}
          {viewMode && (
            <ShipmentLotStatusBlock statusSummary={viewStatusSummary ?? undefined} />
          )}
        </div>

        <FreightPreviewCard
          customerId={form.customerId ? Number(form.customerId) : undefined}
          routeId={previewRouteId ? Number(previewRouteId) : undefined}
          vehicleSizeClassCode={previewSizeClass ?? undefined}
          transportDate={previewTransportDate || undefined}
          isAdHoc={form.isAdHoc}
          lotHasLiveTrips={editSeed ? editSeed.hasDispatchedLegs : undefined}
          projection={editSeed?.pricingProjection ?? undefined}
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
             * (Quay lại / Sửa / Tạo mới lô hàng — SIL-500), not a save cluster.
             * SIL-688: Xóa lô rides last in the danger voice for the roles
             * the BE delete admits (CUS/ADMIN — the host's canDeleteLot);
             * a locked or already-dispatched lot disables it with the reason. */
            <ShipmentViewActions
              onBack={goShipmentList}
              onEdit={viewCanEditLot ? goEdit : undefined}
              editLocked={viewLocked}
              // SIL-453 (FB-098 restore): role trio via the host + the card's
              // "ẩn khi khóa kế toán" law — the affordance disappears on a
              // locked lot instead of disabling (the Sửa/Xóa buttons keep
              // their visible-disabled lock voice; cost entry was specified
              // hidden).
              onDeclareCost={viewCanDeclareCost && !viewLocked && editSeed ? () => { setCostCatalog(null); setCostDrawerOpen(true); } : undefined}
              onCreateNew={viewCreateNew}
              onDelete={viewCanDeleteLot && editSeed ? () => { setDeleteReason(''); setDeleteLotError(null); setDeleteLotOpen(true); } : undefined}
              deleteLocked={viewLocked}
              deleteBlockedReason={editSeed?.hasDispatchedLegs ? 'Chỉ xóa được khi mọi container chưa phát lệnh' : undefined}
            />
          ) : (
            <ShipmentCreateActions
              mode={editTarget ? 'edit' : 'create'}
              bar="foot"
              saving={saving}
              onCancel={goBack}
              onSaveDraft={() => void save('DRAFT')}
              onCreate={() => void save('CREATE')}
            />
          )}
        </div>
      </form>

      {/* SIL-453 (FB-098 restore): the shared "Thêm khoản chi" drawer at LOT
          scope — the ShipmentExpensePanel lot-work shape (tripId null). The
          catalog gate keeps the drawer unmounted until its catalog lands. */}
      {costDrawerOpen && costCatalog && viewTarget && (
        <ExpenseCreateDrawer
          work={{ tripId: null, shipmentId: viewTarget.shipmentId, shipmentCode: form.blNumber.trim() || form.bookingRef.trim() || '—', containerNumber: null }}
          catalog={costCatalog}
          onClose={() => setCostDrawerOpen(false)}
          onSaved={() => { void queryClient.invalidateQueries({ queryKey: qk.expenseAccounting.all }); }}
        />
      )}

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
        leaveDialogOpen={leaveDialogOpen}
        leaveDialogTitle={workspaceMode === 'create' ? 'Bỏ tạo lô hàng?' : 'Bỏ thay đổi?'}
        onKeepEditingLeave={() => settleLeaveDialog(false)}
        onSaveDraftLeave={workspaceMode === 'create' ? saveDraftFromLeaveDialog : undefined}
        onDiscardLeave={() => settleLeaveDialog(true)}
        pendingModeSwitch={pendingModeSwitch}
        onClosePendingModeSwitch={() => setPendingModeSwitch(null)}
        onConfirmModeSwitch={confirmModeSwitch}
        pendingCustomerSwitch={pendingCustomerSwitch}
        customerSwitchImpact={customerSwitchImpact}
        onClosePendingCustomerSwitch={() => setPendingCustomerSwitch(null)}
        onConfirmCustomerSwitch={confirmCustomerSwitch}
        pendingContainerDelete={pendingContainerDelete}
        onClosePendingContainerDelete={() => setPendingContainerDelete(null)}
        onConfirmContainerDelete={confirmContainerDelete}
        blockedContainerDeleteReasons={blockedContainerDeleteReasons}
        onCloseBlockedContainerDelete={() => setBlockedContainerDeleteReasons(null)}
        deleteLotOpen={deleteLotOpen}
        deleteReason={deleteReason}
        onDeleteReasonChange={setDeleteReason}
        deleteLotError={deleteLotError}
        deleteLotSubmitting={deleteLotSubmitting}
        onCloseDeleteLot={() => { if (!deleteLotSubmitting) setDeleteLotOpen(false); }}
        onConfirmDeleteLot={() => void submitDeleteLot()}
      />
    </div>
  );
}
