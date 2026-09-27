import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { EmptyState } from '../../../design-system';
import {
  UTextAreaField as TextAreaField,
  UDateField as DateField,
} from './uui-fields';
import { UDateTimeField as DateTimeField } from './uui-datetime-field';
import { useToast } from '../../../components/shared/Toast';
import { tripClient, type CatalogData } from '../../../api/tripClient';
import {
  listOperationalSites,
  type OperationalSite,
} from '../../../api/shipmentClient';
import { useShipmentReferenceDuplicateGuard } from './use-shipment-reference-duplicate-guard';
import { mergeCustomer, mergePort, mergeRoute } from './catalogMerger';
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
    declarationNumber: form.declarationNumber,
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
    if (value === form.customerId) return;
    setContainers((current) => current.map((row) => ({ ...row, ...resetCustomerSite(row, sites) })));
    setForm((current) => ({
      ...current,
      ...resetCustomerSite(current, sites),
      customerId: value,
      pickupWarehouseSiteId: '',
    }));
    setSites([]);
    clearFeedback();
  }

  const {
    customerCustomText, routeCustomText, factoryCustomText, portCustomText,
    containerFactoryCustomText, containerRouteCustomText, routeIdForSite,
  } = createAdhocFieldLogic({
    customerOptions, routeOptions, portOptions, operationalSites,
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
      ? Boolean(form.packageType || form.packageCount || form.cargoWeightKg || form.cargoVolumeCbm || form.cargoTypeId || form.operationalSiteId || form.pickupWarehouseSiteId || form.extraDeliveryDates.some(Boolean)) || hasDateDraft(workspaceFormRef.current, true)
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

  const emptyAppointmentCount = containers.filter((row) => !row.customerAppointmentAt).length;
  function copyAppointmentToEmpty(fromKey: string) {
    const source = containers.find((row) => row.key === fromKey)?.customerAppointmentAt;
    if (!source) return;
    const targetKeys = emptyAppointmentKeys(containers, workspaceFormRef.current);
    if (!targetKeys.size) return;
    setContainers((current) => current.map((row) => (
      targetKeys.has(row.key) ? { ...row, customerAppointmentAt: source } : row
    )));
    toast({ kind: 'success', message: `Đã copy ngày giờ đóng trả sang ${targetKeys.size} container chưa có lịch` });
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
    const incomplete = workspaceFormRef.current?.querySelector<HTMLInputElement>('[data-date-input]:invalid, [data-split-datetime] input:invalid');
    if (incomplete) { incomplete.focus(); incomplete.reportValidity(); return; }
    const result = await runSave(intent);
    if (result.issues.length > 0) {
      window.requestAnimationFrame(() => focusIssue(result.issues[0].fieldId));
    }
  }

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-3)' }}>Đang tải…</div>;
  if (loadError) return <div role="alert" style={{ padding: 24, color: 'var(--danger)' }}>{loadError}</div>;
  if (!catalogs?.customers.length) return <EmptyState context="clients" title="Chưa có khách hàng" description="Cần ít nhất một khách hàng trước khi tạo lô hàng." />;

  return (
    <div className="csc-page">
      <h1 className="csc-page__title">Tạo lô hàng</h1>
      <form ref={workspaceFormRef} noValidate onSubmit={(event) => { event.preventDefault(); void save('DRAFT'); }} className="csc-workspace">
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
              selectedOperationalSite={selectedOperationalSite}
              selectOperationalSite={selectOperationalSite}
              routeCustomText={routeCustomText}
              factoryCustomText={factoryCustomText}
              routeAddButtonRef={routeAddButtonRef}
              setRouteDialogOpen={setRouteDialogOpen}
              openCreateSiteDialog={openCreateSiteDialog}
              setDetailSite={setDetailSite}
              saving={Boolean(saving)}
              sitesLoading={sitesLoading}
              issueByField={issueByField}
            />
          )}

          <ShipmentCreateSection id="cargo" title="Thông tin hàng" description="Nhập chi tiết phù hợp với hàng nguyên container hoặc hàng lẻ.">
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
                      <span className="csc-mode__option">{mode === 'FCL' ? 'Hàng nguyên container (Cont)' : 'Hàng lẻ'}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="csc-flag-checkbox">
                <input
                  type="checkbox"
                  checked={form.isCombined}
                  onChange={(event) => update('isCombined', event.target.checked)}
                  disabled={Boolean(saving)}
                />
                <span><strong>Đóng kết hợp</strong></span>
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
                warehouseSites={warehouseSites}
                sitesLoading={sitesLoading}
                saving={Boolean(saving)}
                issueByField={issueByField}
                openCreateSiteDialog={openCreateSiteDialog}
              />
            )}
          </ShipmentCreateSection>

          <ShipmentCreateSection
            id="schedule"
            title="Lịch & ghi chú"
            description={form.cargoMode === 'FCL' ? undefined : 'Các hạn vận hành và lưu ý để điều phối thực hiện đúng kế hoạch.'}
          >
            {form.cargoMode === 'LCL' && (
              <div style={gridStyle}>
                <DateTimeField label="Hạn hoàn tất hải quan" value={form.customsCutoffAt} onChange={(event) => update('customsCutoffAt', event.target.value)} disabled={Boolean(saving)} />
                <DateTimeField label="Hạn hạ container tại cảng" value={form.closingAt} onChange={(event) => update('closingAt', event.target.value)} disabled={Boolean(saving)} />
                <DateTimeField label="Thời điểm trả container" value={form.plannedReturnAt} onChange={(event) => update('plannedReturnAt', event.target.value)} disabled={Boolean(saving)} />
                <div data-field-id="shipment-expected-delivery">
                  <DateField id="shipment-expected-delivery" label="Ngày giao dự kiến" value={form.expectedDeliveryDate} onChange={(event) => update('expectedDeliveryDate', event.target.value)} disabled={Boolean(saving)} error={issueByField.get('shipment-expected-delivery')} />
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
            <TextAreaField label="Ghi chú cho khách hàng" value={customerNotes} onChange={(event) => { setCustomerNotes(event.target.value); clearFeedback(); }} rows={3} maxLength={2000} placeholder="Thông tin cần gửi hoặc lưu ý cần theo dõi với khách hàng" disabled={Boolean(saving)} />
            <TextAreaField label="Ghi chú cho lái xe" value={form.operationalNotes} onChange={(event) => update('operationalNotes', event.target.value)} rows={4} maxLength={2000} placeholder="Hướng dẫn và lưu ý cần thiết cho lái xe" disabled={Boolean(saving)} />
          </ShipmentCreateSection>
        </div>

        <FreightPreviewCard
          customerId={form.customerId ? Number(form.customerId) : undefined}
          routeId={previewRouteId ? Number(previewRouteId) : undefined}
          vehicleSizeClassCode={previewSizeClass ?? undefined}
          transportDate={previewTransportDate || undefined}
          isAdHoc={form.isAdHoc}
        />
        <ShipmentCreateSummary
          validationIssues={validationIssues}
          saving={saving}
          submitError={submitError}
          onFocusIssue={focusIssue}
          onCreate={() => void save('DRAFT')}
          onCancel={goBack}
        />
      </form>

      <ShipmentCreateModals
        detailSite={detailSite}
        onCloseDetailSite={() => setDetailSite(null)}
        createSiteDialog={createSiteDialog}
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
