import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, Send, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { SearchableSelect, TextField, SelectField, DateField } from '../../design-system';
import { useConfirm } from '../../components/UI';
import { OperationalSiteDetailsDialog } from '../../components/shipment/OperationalSiteDetailsDialog';
import { useAuth } from '../../hooks/useAuth';
import { Role, SHIPMENT_STATUS_LABELS, ShipmentStatus } from '@tingting/shared';
import { tripClient } from '../../api/tripClient';
import {
  addShipmentDocument,
  createShipmentDeclaration,
  getShipmentDispatchHandoff,
  getShipmentDetail,
  listOperationalSites,
  replaceShipmentDocument,
  reviewShipmentChangeRequest,
  saveShipmentCarrierAllocations,
  updateShipment,
  updateShipmentDeclaration,
  saveShipmentContainers,
  submitShipmentForDispatch,
  type ShipmentChangeRequest,
  type ShipmentDeclaration,
  type ShipmentDetail,
  type ShipmentContainer,
  type ShipmentDocument,
  type ShipmentDispatchHandoff,
  type OperationalSite,
} from '../../api/shipmentClient';
import {
  formatVietnamDateTimeInput,
  localDateTimeToIso,
} from '../../lib/shipment-operations';
import { CarrierAllocationDialog } from '../../components/shipment/CarrierAllocationDialog';
import {
  CarrierAllocationSummary,
  carrierOptionKey,
  type CarrierAllocationDemand,
  type CarrierAllocationOption,
  type CarrierAllocationValue,
  validateCarrierAllocations,
} from '../../components/shipment/CarrierAllocationSummary';

interface ClerkContainerTypeOption {
  id: number;
  code: string;
  name: string;
}

interface DispatchOption {
  id: number;
  label: string;
}

/** One editable container row. `id` undefined = new row. */
interface ContainerRow {
  id?: number;
  containerTypeId: string;
  containerNumber: string;
  sealNumber: string;
  cargoWeightKg: string;
  shippingLineName: string;
  pickupPortId: string;
  dropoffPortId: string;
  /** Ngày giao/đóng trả của container — phải giữ nguyên qua lần lưu này (reconcile là full replace). */
  customerAppointmentAt: string | null;
}

interface ShipmentFormState {
  routeId: string;
  operationalSiteId: string;
  pickupWarehouseSiteId: string;
  bookingRef: string;
  blNumber: string;
  contactName: string;
  contactPhone: string;
  expectedDeliveryDate: string;
  pickupLocation: string;
  deliveryLocation: string;
  responsibleUnitId: string;
  tradeDirection: '' | 'IMPORT' | 'EXPORT';
  cargoMode: '' | 'FCL' | 'LCL';
  factoryName: string;
  shippingLineName: string;
  customsCutoffAt: string;
  closingAt: string;
  plannedReturnAt: string;
  cargoWeightKg: string;
  cargoVolumeCbm: string;
  packageCount: string;
  packageType: string;
  operationalNotes: string;
}

function toRow(c: ShipmentContainer): ContainerRow {
  return {
    id: c.id,
    containerTypeId: c.containerTypeId != null ? String(c.containerTypeId) : '',
    containerNumber: c.containerNumber ?? '',
    sealNumber: c.sealNumber ?? '',
    cargoWeightKg: c.cargoWeightKg ?? '',
    shippingLineName: c.shippingLineName ?? '',
    pickupPortId: c.pickupPortId != null ? String(c.pickupPortId) : '',
    dropoffPortId: c.dropoffPortId != null ? String(c.dropoffPortId) : '',
    customerAppointmentAt: c.customerAppointmentAt ?? null,
  };
}

const EMPTY_ROW: ContainerRow = {
  containerTypeId: '',
  containerNumber: '',
  sealNumber: '',
  cargoWeightKg: '',
  shippingLineName: '',
  pickupPortId: '',
  dropoffPortId: '',
  customerAppointmentAt: null,
};

const EMPTY_DOC_FORM = {
  type: 'OTHER' as const,
  storageKey: '',
  expiresAt: '',
};

const EMPTY_DECLARATION_FORM = {
  id: null as number | null,
  declarationNumber: '',
  issuedAt: '',
  scope: 'SINGLE' as 'SINGLE' | 'SHARED',
  note: '',
};

const OWN_CARRIER_OPTION: CarrierAllocationOption = {
  key: 'OWN',
  label: 'Đội xe nội bộ SilverSea',
  carrierType: 'OWN',
  externalCarrierId: null,
  isActive: true,
};

function inferContainerBucket(label: string | null | undefined): 20 | 40 | null {
  const normalized = (label ?? '').toUpperCase();
  if (normalized.includes('20')) return 20;
  if (normalized.includes('40')) return 40;
  return null;
}

function carrierValidationMessage(validation: ReturnType<typeof validateCarrierAllocations>): string | null {
  return validation.isExact ? null : validation.errors[0] ?? 'Cần gán đúng số lượng nhà xe cho container 20\' và 40\'.';
}

function toCarrierAllocationPayload(rows: CarrierAllocationValue[]) {
  return rows.map((row) => ({
    carrierType: row.carrierType,
    externalCarrierId: row.externalCarrierId,
    carrierName: row.carrierLabel,
    count20: row.count20,
    count40: row.count40,
  }));
}

function allocationsFromDetail(detail: ShipmentDetail): CarrierAllocationValue[] {
  const grouped = new Map<string, CarrierAllocationValue>();
  const containerById = new Map(detail.containers.map((container) => [container.id, container]));
  for (const assignment of detail.carrierAssignments) {
    if (!assignment.carrierType || assignment.shipmentContainerId == null) continue;
    const container = containerById.get(assignment.shipmentContainerId);
    if (!container) continue;
    const bucket = inferContainerBucket(`${assignment.containerTypeCode ?? ''} ${assignment.containerTypeName ?? ''}`.trim());
    if (!bucket) continue;
    const key = carrierOptionKey(assignment.carrierType, assignment.externalCarrierId);
    const current = grouped.get(key) ?? {
      carrierType: assignment.carrierType,
      externalCarrierId: assignment.externalCarrierId,
      carrierLabel: assignment.carrierType === 'OWN'
        ? OWN_CARRIER_OPTION.label
        : assignment.externalCarrierName ?? 'Nhà xe chưa xác định',
      count20: 0,
      count40: 0,
    };
    if (bucket === 20) current.count20 += 1;
    if (bucket === 40) current.count40 += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function toDateTimeInput(value: string | null | undefined): string {
  return formatVietnamDateTimeInput(value);
}

interface SearchableFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; searchText?: string }>;
  placeholder: string;
  disabled?: boolean;
}

function SearchableField({ id, label, value, onChange, options, placeholder, disabled }: SearchableFieldProps) {
  return (
    <label htmlFor={id} style={{ display: 'grid', gap: 8, alignContent: 'start', fontSize: 14, fontWeight: 600 }}>
      <span>{label}</span>
      <SearchableSelect
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );
}

export default function ClerkShipmentDocsPage() {
  const { id } = useParams<{ id: string }>();
  const shipmentId = id ? Number(id) : NaN;
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirm, dialog } = useConfirm();

  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [dispatchHandoff, setDispatchHandoff] = useState<ShipmentDispatchHandoff | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [containerTypes, setContainerTypes] = useState<ClerkContainerTypeOption[]>([]);
  const [portOptions, setPortOptions] = useState<DispatchOption[]>([]);
  const [routeOptions, setRouteOptions] = useState<DispatchOption[]>([]);
  const [operationalSites, setOperationalSites] = useState<OperationalSite[]>([]);
  const [detailSite, setDetailSite] = useState<OperationalSite | null>(null);

  const [shipmentForm, setShipmentForm] = useState<ShipmentFormState>({
    routeId: '',
    operationalSiteId: '',
    pickupWarehouseSiteId: '',
    bookingRef: '',
    blNumber: '',
    contactName: '',
    contactPhone: '',
    expectedDeliveryDate: '',
    pickupLocation: '',
    deliveryLocation: '',
    responsibleUnitId: '',
    tradeDirection: '',
    cargoMode: '',
    factoryName: '',
    shippingLineName: '',
    customsCutoffAt: '',
    closingAt: '',
    plannedReturnAt: '',
    cargoWeightKg: '',
    cargoVolumeCbm: '',
    packageCount: '',
    packageType: '',
    operationalNotes: '',
  });
  const [version, setVersion] = useState(1);
  const [businessUnitNames, setBusinessUnitNames] = useState<Map<number, string>>(new Map());
  const [rows, setRows] = useState<ContainerRow[]>([]);
  const [carrierAllocations, setCarrierAllocations] = useState<CarrierAllocationValue[]>([]);
  const [carrierOptions, setCarrierOptions] = useState<CarrierAllocationOption[]>([OWN_CARRIER_OPTION]);
  const [carrierAllocationDialogOpen, setCarrierAllocationDialogOpen] = useState(false);
  const [documentForm, setDocumentForm] = useState(EMPTY_DOC_FORM);
  const [replaceDocumentTarget, setReplaceDocumentTarget] = useState<ShipmentDocument | null>(null);
  const [declarationForm, setDeclarationForm] = useState(EMPTY_DECLARATION_FORM);

  const [savingShipment, setSavingShipment] = useState(false);
  const [savingContainers, setSavingContainers] = useState(false);
  const [savingCarrierAllocations, setSavingCarrierAllocations] = useState(false);
  const [savingDocument, setSavingDocument] = useState(false);
  const [savingDeclaration, setSavingDeclaration] = useState(false);
  const [reviewingRequestId, setReviewingRequestId] = useState<number | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const dispatchIdempotencyKey = useRef(crypto.randomUUID());
  const [dispatchMsg, setDispatchMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [shipmentMsg, setShipmentMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [containerMsg, setContainerMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [documentMsg, setDocumentMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [declarationMsg, setDeclarationMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [reviewMsg, setReviewMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const canDispatch = user?.role === Role.ADMIN || user?.role === Role.MANAGER;
  const canReview = canDispatch;
  const assignedResponsibleUnitIds = useMemo(() => {
    const ids = new Set<number>();
    for (const id of user?.businessUnitIds ?? []) ids.add(id);
    if (detail?.shipment.responsibleUnitId != null) ids.add(detail.shipment.responsibleUnitId);
    return [...ids];
  }, [detail?.shipment.responsibleUnitId, user?.businessUnitIds]);
  const carrierDemand = useMemo<CarrierAllocationDemand>(() => {
    const typeLabels = new Map(containerTypes.map((item) => [String(item.id), `${item.code} ${item.name}`.trim()]));
    return rows.reduce<CarrierAllocationDemand>((totals, row) => {
      const bucket = inferContainerBucket(typeLabels.get(row.containerTypeId));
      if (bucket === 20) totals.count20 += 1;
      if (bucket === 40) totals.count40 += 1;
      return totals;
    }, { count20: 0, count40: 0 });
  }, [containerTypes, rows]);
  const normalizedCarrierOptions = useMemo(() => {
    if (carrierOptions.length > 1) return carrierOptions;
    if (carrierAllocations.length === 0) return carrierOptions;
    return [
      OWN_CARRIER_OPTION,
      ...carrierAllocations.map((row) => ({
        key: carrierOptionKey(row.carrierType, row.externalCarrierId),
        label: row.carrierLabel,
        carrierType: row.carrierType,
        externalCarrierId: row.externalCarrierId,
        isActive: true,
      })),
    ];
  }, [carrierAllocations, carrierOptions]);
  const carrierAllocationValidation = useMemo(
    () => validateCarrierAllocations(
      carrierAllocations.map((row) => ({
        carrierKey: carrierOptionKey(row.carrierType, row.externalCarrierId),
        count20: row.count20,
        count40: row.count40,
      })),
      carrierDemand,
      normalizedCarrierOptions,
    ),
    [carrierAllocations, carrierDemand, normalizedCarrierOptions],
  );
  const carrierAllocationWarning = useMemo(
    () => ((carrierDemand.count20 + carrierDemand.count40) > 0 ? carrierValidationMessage(carrierAllocationValidation) : null),
    [carrierAllocationValidation, carrierDemand.count20, carrierDemand.count40],
  );

  async function loadPageData(currentShipmentId: number) {
    const [loadedDetail, bootstrap, loadedHandoff] = await Promise.all([
      getShipmentDetail(currentShipmentId),
      tripClient.getBootstrap(),
      getShipmentDispatchHandoff(currentShipmentId),
    ]);
    const sites = await listOperationalSites(loadedDetail.shipment.customerId);
    setDetail(loadedDetail);
    setDispatchHandoff(loadedHandoff);
    setVersion(loadedDetail.shipment.version);
    setRows(loadedDetail.containers.map(toRow));
    setCarrierAllocations(allocationsFromDetail(loadedDetail));
    setContainerTypes(bootstrap.containerTypes);
    setPortOptions((bootstrap.ports ?? []).map((port) => ({ id: port.id, label: port.name })));
    setRouteOptions(bootstrap.routes.map((route) => ({ id: route.id, label: route.name })));
    setBusinessUnitNames(new Map((bootstrap.businessUnits ?? []).map((unit) => [unit.id, unit.name])));
    const externalCarriers = bootstrap.externalCarriers ?? [];
    setCarrierOptions([
      OWN_CARRIER_OPTION,
      ...externalCarriers.map((carrier) => ({
        key: carrierOptionKey('EXTERNAL', carrier.id),
        label: carrier.name,
        carrierType: 'EXTERNAL' as const,
        externalCarrierId: carrier.id,
        isActive: carrier.isActive,
      })),
    ]);
    setOperationalSites(sites);
    setShipmentForm({
      routeId: loadedDetail.shipment.routeId != null ? String(loadedDetail.shipment.routeId) : '',
      operationalSiteId: loadedDetail.shipment.operationalSiteId != null ? String(loadedDetail.shipment.operationalSiteId) : '',
      pickupWarehouseSiteId: loadedDetail.shipment.pickupWarehouseSiteId != null ? String(loadedDetail.shipment.pickupWarehouseSiteId) : '',
      bookingRef: loadedDetail.shipment.tradeDirection === 'IMPORT' ? '' : loadedDetail.shipment.bookingRef ?? '',
      blNumber: loadedDetail.shipment.tradeDirection === 'EXPORT' ? '' : loadedDetail.shipment.blNumber ?? '',
      contactName: loadedDetail.shipment.contactName ?? '',
      contactPhone: loadedDetail.shipment.contactPhone ?? '',
      expectedDeliveryDate: loadedDetail.shipment.expectedDeliveryDate ?? '',
      pickupLocation: loadedDetail.shipment.pickupLocation ?? '',
      deliveryLocation: loadedDetail.shipment.deliveryLocation ?? '',
      responsibleUnitId: loadedDetail.shipment.responsibleUnitId != null
        ? String(loadedDetail.shipment.responsibleUnitId)
        : '',
      tradeDirection: loadedDetail.shipment.tradeDirection ?? '',
      cargoMode: loadedDetail.shipment.cargoMode ?? '',
      factoryName: loadedDetail.shipment.factoryName ?? '',
      shippingLineName: loadedDetail.shipment.shippingLineName ?? '',
      customsCutoffAt: toDateTimeInput(loadedDetail.shipment.customsCutoffAt),
      closingAt: toDateTimeInput(loadedDetail.shipment.closingAt),
      plannedReturnAt: toDateTimeInput(loadedDetail.shipment.plannedReturnAt),
      cargoWeightKg: loadedDetail.shipment.cargoWeightKg ?? '',
      cargoVolumeCbm: loadedDetail.shipment.cargoVolumeCbm ?? '',
      packageCount: loadedDetail.shipment.packageCount != null
        ? String(loadedDetail.shipment.packageCount)
        : '',
      packageType: loadedDetail.shipment.packageType ?? '',
      operationalNotes: loadedDetail.shipment.operationalNotes ?? '',
    });
  }

  useEffect(() => {
    if (!Number.isFinite(shipmentId)) {
      setLoadError('Đường dẫn lô hàng không hợp lệ');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadPageData(shipmentId)
      .then(() => {
        if (cancelled) return;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error && err.message.trim()
          ? err.message
          : 'Không thể tải thông tin lô hàng';
        setLoadError(msg);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [shipmentId]);

  const readiness = useMemo(() => {
    const missing: string[] = [];
    if (!shipmentForm.tradeDirection) missing.push('Chiều hàng');
    else if (shipmentForm.tradeDirection === 'IMPORT' && !shipmentForm.blNumber.trim()) missing.push('Số Bill');
    else if (shipmentForm.tradeDirection === 'EXPORT' && !shipmentForm.bookingRef.trim()) missing.push('Số Booking');
    if (!shipmentForm.routeId) missing.push('Tuyến đường');
    if (!shipmentForm.operationalSiteId) missing.push('Nhà máy');
    if (!shipmentForm.cargoMode) missing.push('Loại lô hàng');
    if (shipmentForm.cargoMode === 'FCL' && (rows.length === 0 || rows.some((row) => (
      !row.containerTypeId || !row.containerNumber.trim() || !row.shippingLineName.trim()
      || !row.pickupPortId || !row.dropoffPortId
    )))) missing.push('Thông tin công-te-nơ đầy đủ');
    if (shipmentForm.cargoMode === 'LCL') {
      if (!shipmentForm.pickupWarehouseSiteId) missing.push('Kho lấy hàng');
      if (!shipmentForm.packageType.trim()) missing.push('Loại kiện');
      if (!shipmentForm.packageCount) missing.push('Số kiện');
      if (!shipmentForm.cargoWeightKg) missing.push('Trọng lượng');
      if (!shipmentForm.cargoVolumeCbm) missing.push('Thể tích');
      if (!shipmentForm.expectedDeliveryDate) missing.push('Ngày giao dự kiến');
    }
    return { ready: missing.length === 0, missing };
  }, [shipmentForm, rows]);

  function updateRow(idx: number, patch: Partial<ContainerRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setContainerMsg(null);
  }
  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
    setContainerMsg(null);
  }
  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setContainerMsg(null);
  }

  function handleCargoModeChange(nextMode: ShipmentFormState['cargoMode'] | '') {
    setShipmentForm((current) => {
      if (current.cargoMode === nextMode) return current;
      if (current.cargoMode === 'LCL' && nextMode !== 'LCL') {
        const hasLclData = Boolean(
          current.cargoVolumeCbm || current.packageCount || current.packageType,
        );
        if (hasLclData && !window.confirm('Rời chế độ Hàng lẻ (LCL) sẽ xóa thể tích, số kiện và loại kiện đã nhập. Tiếp tục?')) {
          return current;
        }
        return {
          ...current,
          cargoMode: nextMode,
          cargoVolumeCbm: '',
          packageCount: '',
          packageType: '',
        };
      }
      return { ...current, cargoMode: nextMode };
    });
    if (nextMode !== 'FCL') {
      setCarrierAllocations([]);
    }
    setShipmentMsg(null);
  }

  async function reloadCurrentDetail() {
    await loadPageData(shipmentId);
  }

  async function handleSaveShipment() {
    setSavingShipment(true);
    setShipmentMsg(null);
    try {
      const cargoMode = shipmentForm.cargoMode || null;
      const updated = await updateShipment(shipmentId, {
        expectedVersion: version,
        bookingRef: shipmentForm.tradeDirection === 'EXPORT' ? shipmentForm.bookingRef.trim() || null : null,
        blNumber: shipmentForm.tradeDirection === 'IMPORT' ? shipmentForm.blNumber.trim() || null : null,
        contactName: shipmentForm.contactName.trim() || null,
        contactPhone: shipmentForm.contactPhone.trim() || null,
        expectedDeliveryDate: shipmentForm.expectedDeliveryDate || null,
        pickupLocation: shipmentForm.pickupLocation.trim() || null,
        deliveryLocation: shipmentForm.deliveryLocation.trim() || null,
        responsibleUnitId: shipmentForm.responsibleUnitId ? Number(shipmentForm.responsibleUnitId) : null,
        routeId: shipmentForm.routeId ? Number(shipmentForm.routeId) : null,
        operationalSiteId: shipmentForm.operationalSiteId ? Number(shipmentForm.operationalSiteId) : null,
        pickupWarehouseSiteId: cargoMode === 'LCL' && shipmentForm.pickupWarehouseSiteId ? Number(shipmentForm.pickupWarehouseSiteId) : null,
        tradeDirection: shipmentForm.tradeDirection || null,
        cargoMode,
        factoryName: shipmentForm.factoryName.trim() || null,
        shippingLineName: shipmentForm.shippingLineName.trim() || null,
        customsCutoffAt: localDateTimeToIso(shipmentForm.customsCutoffAt),
        closingAt: localDateTimeToIso(shipmentForm.closingAt),
        plannedReturnAt: localDateTimeToIso(shipmentForm.plannedReturnAt),
        cargoWeightKg: shipmentForm.cargoWeightKg || null,
        ...(cargoMode === 'LCL' ? {
          cargoVolumeCbm: shipmentForm.cargoVolumeCbm || null,
          packageCount: shipmentForm.packageCount
            ? Number(shipmentForm.packageCount)
            : null,
          packageType: shipmentForm.packageType.trim() || null,
        } : {
          cargoVolumeCbm: null,
          packageCount: null,
          packageType: null,
        }),
        operationalNotes: shipmentForm.operationalNotes.trim() || null,
      });
      await reloadCurrentDetail();
      setShipmentMsg({
        kind: 'ok',
        text: updated.message ?? (updated.changeMode === 'REQUESTED'
          ? 'Đã gửi yêu cầu thay đổi kế hoạch.'
          : 'Đã lưu thông tin lô hàng.'),
      });
    } catch (err) {
      const msg = err instanceof Error && err.message.trim()
        ? err.message
        : 'Không thể lưu. Vui lòng thử lại.';
      setShipmentMsg({ kind: 'err', text: msg });
    } finally {
      setSavingShipment(false);
    }
  }

  async function handleSaveContainers() {
    setSavingContainers(true);
    setContainerMsg(null);
    try {
      const res = await saveShipmentContainers(shipmentId, {
        expectedVersion: version,
        containers: rows.map((r) => ({
          ...(r.id != null ? { id: r.id } : {}),
          containerTypeId: r.containerTypeId ? Number(r.containerTypeId) : null,
          containerNumber: r.containerNumber.trim() || null,
          sealNumber: r.sealNumber.trim() || null,
          cargoWeightKg: r.cargoWeightKg ? Number(r.cargoWeightKg) : null,
          shippingLineName: r.shippingLineName.trim() || null,
          pickupPortId: r.pickupPortId ? Number(r.pickupPortId) : null,
          dropoffPortId: r.dropoffPortId ? Number(r.dropoffPortId) : null,
          customerAppointmentAt: r.customerAppointmentAt ?? null,
        })),
      });
      let nextVersion = res.shipmentVersion;
      if (shipmentForm.cargoMode === 'FCL' && (carrierDemand.count20 + carrierDemand.count40) > 0) {
        const allocationResult = await saveShipmentCarrierAllocations(shipmentId, {
          expectedVersion: nextVersion,
          carrierAllocations: toCarrierAllocationPayload(carrierAllocations),
        });
        nextVersion = allocationResult.shipment.version;
      }
      setVersion(nextVersion);
      await reloadCurrentDetail();
      setContainerMsg({
        kind: 'ok',
        text: res.message ?? `Đã lưu ${res.items.length} công-te-nơ.`,
      });
    } catch (err) {
      const msg = err instanceof Error && err.message.trim()
        ? err.message
        : 'Không thể lưu công-te-nơ. Vui lòng thử lại.';
      setContainerMsg({ kind: 'err', text: msg });
    } finally {
      setSavingContainers(false);
    }
  }

  async function handleSaveCarrierAllocations(nextAllocations: CarrierAllocationValue[]) {
    const previousAllocations = carrierAllocations;
    setCarrierAllocations(nextAllocations);
    if (
      shipmentForm.cargoMode !== 'FCL'
      || (carrierDemand.count20 + carrierDemand.count40) === 0
      || displayStatus !== ShipmentStatus.READY_FOR_DISPATCH
    ) {
      return;
    }

    setSavingCarrierAllocations(true);
    setContainerMsg(null);
    try {
      const result = await saveShipmentCarrierAllocations(shipmentId, {
        expectedVersion: version,
        carrierAllocations: toCarrierAllocationPayload(nextAllocations),
      });
      setVersion(result.shipment.version);
      await reloadCurrentDetail();
      setContainerMsg({ kind: 'ok', text: 'Đã cập nhật gán nhà xe cho lô hàng.' });
    } catch (err) {
      setCarrierAllocations(previousAllocations);
      setContainerMsg({
        kind: 'err',
        text: err instanceof Error && err.message.trim()
          ? err.message
          : 'Không thể cập nhật gán nhà xe.',
      });
    } finally {
      setSavingCarrierAllocations(false);
    }
  }

  async function handleSaveDocument() {
    setSavingDocument(true);
    setDocumentMsg(null);
    try {
      if (!documentForm.storageKey.trim()) {
        setDocumentMsg({ kind: 'err', text: 'Cần nhập storage key của tài liệu.' });
        return;
      }
      if (replaceDocumentTarget) {
        await replaceShipmentDocument(shipmentId, replaceDocumentTarget.id, {
          expectedVersion: version,
          storageKey: documentForm.storageKey.trim(),
          expiresAt: documentForm.expiresAt || null,
        });
      } else {
        await addShipmentDocument(shipmentId, {
          type: documentForm.type,
          storageKey: documentForm.storageKey.trim(),
        });
      }
      await reloadCurrentDetail();
      setDocumentMsg({
        kind: 'ok',
        text: replaceDocumentTarget ? 'Đã thay thế tài liệu.' : 'Đã thêm tài liệu.',
      });
      setDocumentForm(EMPTY_DOC_FORM);
      setReplaceDocumentTarget(null);
    } catch (err) {
      setDocumentMsg({
        kind: 'err',
        text: err instanceof Error && err.message.trim()
          ? err.message
          : 'Không thể lưu tài liệu.',
      });
    } finally {
      setSavingDocument(false);
    }
  }

  async function handleSaveDeclaration() {
    setSavingDeclaration(true);
    setDeclarationMsg(null);
    try {
      if (declarationForm.id != null) {
        await updateShipmentDeclaration(shipmentId, declarationForm.id, {
          declarationNumber: declarationForm.declarationNumber.trim() || null,
          issuedAt: declarationForm.issuedAt ? localDateTimeToIso(declarationForm.issuedAt) : null,
          scope: declarationForm.scope,
          note: declarationForm.note.trim() || null,
        });
      } else {
        await createShipmentDeclaration(shipmentId, {
          declarationNumber: declarationForm.declarationNumber.trim() || null,
          issuedAt: declarationForm.issuedAt ? localDateTimeToIso(declarationForm.issuedAt) : null,
          scope: declarationForm.scope,
          note: declarationForm.note.trim() || null,
        });
      }
      await reloadCurrentDetail();
      setDeclarationMsg({
        kind: 'ok',
        text: declarationForm.id != null ? 'Đã cập nhật tờ khai.' : 'Đã thêm tờ khai.',
      });
      setDeclarationForm(EMPTY_DECLARATION_FORM);
    } catch (err) {
      setDeclarationMsg({
        kind: 'err',
        text: err instanceof Error && err.message.trim()
          ? err.message
          : 'Không thể lưu tờ khai.',
      });
    } finally {
      setSavingDeclaration(false);
    }
  }

  async function handleReviewRequest(request: ShipmentChangeRequest, resolution: 'APPLIED' | 'REJECTED') {
    setReviewingRequestId(request.id);
    setReviewMsg(null);
    try {
      const result = await reviewShipmentChangeRequest(shipmentId, request.id, resolution);
      await reloadCurrentDetail();
      setReviewMsg({ kind: 'ok', text: result.message });
    } catch (err) {
      setReviewMsg({
        kind: 'err',
        text: err instanceof Error && err.message.trim()
          ? err.message
          : 'Không thể xử lý yêu cầu thay đổi.',
      });
    } finally {
      setReviewingRequestId(null);
    }
  }

  async function handleSubmitForDispatch() {
    if (!readiness.ready) {
      setDispatchMsg({ kind: 'err', text: `Còn thiếu: ${readiness.missing.join(', ')}.` });
      return;
    }
    if (shipmentForm.cargoMode === 'FCL' && (carrierDemand.count20 + carrierDemand.count40) > 0 && !carrierAllocationValidation.isExact) {
      setDispatchMsg({
        kind: 'err',
        text: carrierValidationMessage(carrierAllocationValidation) ?? 'Cần gán nhà xe đầy đủ trước khi gửi sang điều phối.',
      });
      return;
    }
    const ok = await confirm('Gửi lô hàng sang bảng điều phối?', {
      variant: 'primary',
      confirmLabel: 'Gửi sang điều phối',
    });
    if (!ok) return;

    setDispatching(true);
    setDispatchMsg(null);
    try {
      const result = await submitShipmentForDispatch(
        shipmentId,
        {
          expectedVersion: version,
          ...(shipmentForm.cargoMode === 'FCL' && (carrierDemand.count20 + carrierDemand.count40) > 0
            ? { carrierAllocations: toCarrierAllocationPayload(carrierAllocations) }
            : {}),
        },
        dispatchIdempotencyKey.current,
      );
      setDispatchHandoff(result.handoff);
      setVersion(result.shipment.version);
      setDetail((current) => current
        ? { ...current, shipment: { ...current.shipment, ...result.shipment } }
        : current);
      setDispatchMsg({
        kind: 'ok',
        text: result.replayed ? 'Lô hàng đã có trong bảng điều phối.' : 'Đã gửi lô hàng sang bảng điều phối.',
      });
      try {
        await reloadCurrentDetail();
      } catch {
        setDispatchMsg({
          kind: 'ok',
          text: 'Đã gửi lô hàng sang bảng điều phối. Dữ liệu mới nhất sẽ được tải lại khi bạn mở lại trang.',
        });
      }
    } catch (err) {
      setDispatchMsg({
        kind: 'err',
        text: err instanceof Error && err.message.trim() ? err.message : 'Không thể gửi sang điều phối.',
      });
    } finally {
      setDispatching(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-3)' }}>Đang tải…</div>;
  }
  if (loadError) {
    return (
      <div style={{ padding: 16, maxWidth: 960, margin: '0 auto' }}>
        <div style={{ color: 'var(--danger)', padding: 16 }}>{loadError}</div>
      </div>
    );
  }
  if (!detail) return null;

  const hasSubmittedHandoff = dispatchHandoff != null && dispatchHandoff.status !== 'REJECTED';
  const displayStatus = detail.shipment.status === ShipmentStatus.NEW
    ? (hasSubmittedHandoff ? ShipmentStatus.READY_FOR_DISPATCH : ShipmentStatus.PENDING_DATE)
    : detail.shipment.status;
  const isDraft = displayStatus === ShipmentStatus.PENDING_DATE;
  const isAwaitingDispatch = displayStatus === ShipmentStatus.READY_FOR_DISPATCH;
  const isPostDispatch = ![ShipmentStatus.PENDING_DATE, ShipmentStatus.READY_FOR_DISPATCH].includes(displayStatus);
  const accountingLock = detail.accountingLock ?? null;
  const lockReason = accountingLock
    ? `Đã khóa bởi Kế toán${accountingLock.activatedByName ? ` ${accountingLock.activatedByName}` : ''}${accountingLock.activatedAt ? ` lúc ${new Date(accountingLock.activatedAt).toLocaleString('vi-VN')}` : ''}. ${accountingLock.reason}`
    : null;
  return (
    <div style={{ padding: 16, maxWidth: 960, margin: '0 auto', minWidth: 0 }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Quay lại"
        style={backBtnStyle}
      >
        <ArrowLeft size={18} /> Quay lại
      </button>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 8, marginBottom: 4 }}>
        Hồ sơ: {detail.shipment.shipmentCode?.trim() || 'Chưa có mã lô hàng'}
      </h1>
      <p style={{ color: 'var(--fg-3)', fontSize: 14, marginBottom: 16 }}>
        Khách hàng: {detail.shipment.customerName?.trim() || 'Chưa có tên khách hàng'}
        {' · '}Trạng thái: {SHIPMENT_STATUS_LABELS[displayStatus]}
      </p>

      <div style={readiness.ready ? readinessOkStyle : readinessWarnStyle}>
        {readiness.ready ? (
          <><CheckCircle2 size={16} /> Sẵn sàng điều vận</>
        ) : (
          <><AlertTriangle size={16} /> Còn thiếu: {readiness.missing.join(', ')}</>
        )}
      </div>

      {dispatchMsg && <MsgLine msg={dispatchMsg} />}

      {lockReason && (
        <div style={{ ...readinessWarnStyle, borderColor: 'var(--danger, #b91c1c)', color: 'var(--danger, #b91c1c)' }}>
          <AlertTriangle size={16} /> {lockReason}
        </div>
      )}

      {isAwaitingDispatch && (
        <div style={infoBannerStyle}>
          Lô hàng đang chờ Điều vận tiếp nhận. Bạn vẫn có thể bổ sung thông tin và chứng từ trong thời gian chờ.
        </div>
      )}

      {isPostDispatch && (
        <div style={infoBannerStyle}>
          Sau khi điều vận, các thay đổi kế hoạch như đơn vị phụ trách, thời gian hoặc điểm nhận/giao sẽ tạo yêu cầu chờ quản lý hoặc điều vận áp dụng. Các bổ sung chứng từ và hồ sơ khai báo vẫn lưu trực tiếp.
        </div>
      )}

      <SectionCard title="Thông tin lô hàng">
        <SearchableField
          id="shipment-docs-route"
          label="Tuyến đường"
          value={shipmentForm.routeId}
          onChange={(value) => { setShipmentForm((current) => ({ ...current, routeId: value })); setShipmentMsg(null); }}
          disabled={savingShipment}
          options={routeOptions.map((route) => ({ value: String(route.id), label: route.label }))}
          placeholder="Chọn tuyến đường"
        />
        <SelectField
          label="Đơn vị phụ trách"
          value={shipmentForm.responsibleUnitId}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, responsibleUnitId: event.target.value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment || assignedResponsibleUnitIds.length === 0}
        >
          <option value="">— Chưa gán —</option>
          {assignedResponsibleUnitIds.map((unitId) => (
            <option key={unitId} value={String(unitId)}>
              {businessUnitNames.get(unitId) ?? 'Đơn vị chưa xác định'}
            </option>
          ))}
        </SelectField>
        <div style={twoColumnFieldStyle}>
          <SelectField
            label="Chiều hàng"
            value={shipmentForm.tradeDirection}
            onChange={(event) => {
              const tradeDirection = event.target.value as ShipmentFormState['tradeDirection'];
              setShipmentForm((current) => ({
                ...current,
                tradeDirection,
                ...(tradeDirection === 'IMPORT' ? { bookingRef: '' } : tradeDirection === 'EXPORT' ? { blNumber: '' } : {}),
              }));
              setShipmentMsg(null);
            }}
            disabled={savingShipment}
          >
            <option value="">— Chọn chiều hàng —</option>
            <option value="IMPORT">Nhập khẩu</option>
            <option value="EXPORT">Xuất khẩu</option>
          </SelectField>
          {shipmentForm.tradeDirection === 'IMPORT' && <TextField
            label="Số Bill"
            value={shipmentForm.blNumber}
            onChange={(event) => {
              setShipmentForm((current) => ({ ...current, blNumber: event.target.value }));
              setShipmentMsg(null);
            }}
            placeholder="Ví dụ: MAEU1234567890"
            disabled={savingShipment}
            maxLength={100}
          />}
          {shipmentForm.tradeDirection === 'EXPORT' && <TextField
            label="Số Booking"
            value={shipmentForm.bookingRef}
            onChange={(event) => {
              setShipmentForm((current) => ({ ...current, bookingRef: event.target.value }));
              setShipmentMsg(null);
            }}
            placeholder="Ví dụ: BK-001"
            disabled={savingShipment}
            maxLength={100}
          />}
          <SelectField
            label="Loại lô hàng"
            value={shipmentForm.cargoMode}
            onChange={(event) => handleCargoModeChange(event.target.value as ShipmentFormState['cargoMode'] | '')}
            disabled={savingShipment}
          >
            <option value="">— Chưa xác định —</option>
            <option value="FCL">Container (FCL)</option>
            <option value="LCL">Hàng lẻ (LCL)</option>
          </SelectField>
        </div>
        <div style={twoColumnFieldStyle}>
          <SearchableField
            id="shipment-docs-operational-site"
            label="Nhà máy"
            value={shipmentForm.operationalSiteId}
            onChange={(value) => {
              setShipmentForm((current) => ({ ...current, operationalSiteId: value, factoryName: operationalSites.find((site) => String(site.id) === value)?.name ?? '' }));
              setDetailSite(operationalSites.find((site) => String(site.id) === value) ?? null);
              setShipmentMsg(null);
            }}
            disabled={savingShipment}
            options={operationalSites.filter((site) => site.siteType === 'FACTORY').map((site) => ({ value: String(site.id), label: site.name, searchText: site.address ?? '' }))}
            placeholder="Chọn nhà máy"
          />
          <TextField
            label="Hãng tàu"
            value={shipmentForm.shippingLineName}
            onChange={(event) => {
              setShipmentForm((current) => ({ ...current, shippingLineName: event.target.value }));
              setShipmentMsg(null);
            }}
            disabled={savingShipment}
            maxLength={150}
          />
        </div>
        <div style={threeColumnFieldStyle}>
          <TextField
            label="Cut-off tờ khai"
            type="datetime-local"
            value={shipmentForm.customsCutoffAt}
            onChange={(event) => {
              setShipmentForm((current) => ({ ...current, customsCutoffAt: event.target.value }));
              setShipmentMsg(null);
            }}
            disabled={savingShipment}
          />
          <TextField
            label="Giờ đóng hàng"
            type="datetime-local"
            value={shipmentForm.closingAt}
            onChange={(event) => {
              setShipmentForm((current) => ({ ...current, closingAt: event.target.value }));
              setShipmentMsg(null);
            }}
            disabled={savingShipment}
          />
          <TextField
            label="Thời gian trả"
            type="datetime-local"
            value={shipmentForm.plannedReturnAt}
            onChange={(event) => {
              setShipmentForm((current) => ({ ...current, plannedReturnAt: event.target.value }));
              setShipmentMsg(null);
            }}
            disabled={savingShipment}
          />
        </div>
        <div style={twoColumnFieldStyle}>
          <TextField
            label="Trọng lượng (kg)"
            type="number"
            value={shipmentForm.cargoWeightKg}
            onChange={(event) => {
              setShipmentForm((current) => ({ ...current, cargoWeightKg: event.target.value }));
              setShipmentMsg(null);
            }}
            disabled={savingShipment}
            min="0"
            step="0.01"
          />
          {shipmentForm.cargoMode === 'LCL' && (
            <TextField
              label="Thể tích (CBM)"
              type="number"
              value={shipmentForm.cargoVolumeCbm}
              onChange={(event) => {
                setShipmentForm((current) => ({ ...current, cargoVolumeCbm: event.target.value }));
                setShipmentMsg(null);
              }}
              disabled={savingShipment}
              min="0"
              step="0.001"
            />
          )}
        </div>
        {shipmentForm.cargoMode === 'LCL' && (
          <div style={twoColumnFieldStyle}>
            <SearchableField
              id="shipment-docs-pickup-warehouse"
              label="Kho lấy hàng"
              value={shipmentForm.pickupWarehouseSiteId}
              onChange={(value) => { setShipmentForm((current) => ({ ...current, pickupWarehouseSiteId: value })); setShipmentMsg(null); }}
              disabled={savingShipment}
              options={operationalSites.filter((site) => site.siteType === 'WAREHOUSE').map((site) => ({ value: String(site.id), label: site.name, searchText: site.address ?? '' }))}
              placeholder="Chọn kho lấy hàng"
            />
            <TextField
              label="Số kiện"
              type="number"
              value={shipmentForm.packageCount}
              onChange={(event) => {
                setShipmentForm((current) => ({ ...current, packageCount: event.target.value }));
                setShipmentMsg(null);
              }}
              disabled={savingShipment}
              min="0"
              step="1"
            />
            <TextField
              label="Loại kiện"
              value={shipmentForm.packageType}
              onChange={(event) => {
                setShipmentForm((current) => ({ ...current, packageType: event.target.value }));
                setShipmentMsg(null);
              }}
              disabled={savingShipment}
              maxLength={100}
            />
          </div>
        )}
        <TextField
          label="Người liên hệ"
          value={shipmentForm.contactName}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, contactName: event.target.value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment}
        />
        <TextField
          label="Số điện thoại liên hệ"
          value={shipmentForm.contactPhone}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, contactPhone: event.target.value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment}
        />
        <DateField
          label="Ngày giao dự kiến"
          value={shipmentForm.expectedDeliveryDate}
          onChange={(value) => {
            setShipmentForm((current) => ({ ...current, expectedDeliveryDate: value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment}
        />
        <TextField
          label="Điểm nhận"
          value={shipmentForm.pickupLocation}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, pickupLocation: event.target.value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment}
        />
        <TextField
          label="Điểm giao"
          value={shipmentForm.deliveryLocation}
          onChange={(event) => {
            setShipmentForm((current) => ({ ...current, deliveryLocation: event.target.value }));
            setShipmentMsg(null);
          }}
          disabled={savingShipment}
        />
        <label style={textareaLabelStyle}>
          Ghi chú vận hành
          <textarea
            value={shipmentForm.operationalNotes}
            onChange={(event) => {
              setShipmentForm((current) => ({ ...current, operationalNotes: event.target.value }));
              setShipmentMsg(null);
            }}
            disabled={savingShipment}
            maxLength={2000}
            rows={4}
            style={textareaStyle}
          />
        </label>
        <button type="button" onClick={handleSaveShipment} disabled={savingShipment || Boolean(accountingLock)} style={primaryBtnStyle}>
          <Save size={16} /> {savingShipment ? 'Đang lưu…' : (isPostDispatch ? 'Lưu hoặc gửi yêu cầu' : 'Lưu hồ sơ lô hàng')}
        </button>
        {lockReason && <p style={{ ...mutedTextStyle, color: 'var(--danger, #b91c1c)' }}>{lockReason}</p>}
        {shipmentMsg && <MsgLine msg={shipmentMsg} />}
      </SectionCard>

      {shipmentForm.cargoMode !== 'LCL' && (
      <SectionCard title={`Công-te-nơ (${rows.length})`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 8, minWidth: 0, flex: '1 1 320px' }}>
            <strong style={{ fontSize: 15 }}>Gán nhà xe</strong>
            <CarrierAllocationSummary
              allocations={carrierAllocations}
              demand={carrierDemand}
              warning={carrierAllocationWarning}
              emptyLabel="Chọn nhà xe cho từng cỡ container 20' và 40'."
            />
          </div>
            <button
              type="button"
              onClick={() => setCarrierAllocationDialogOpen(true)}
              disabled={savingContainers || savingCarrierAllocations || Boolean(accountingLock) || ((carrierDemand.count20 + carrierDemand.count40) === 0)}
              style={secondaryBtnStyle}
            >
            Gán nhà xe
          </button>
        </div>
        {rows.length === 0 && (
          <p style={{ color: 'var(--fg-3)', fontSize: 14, margin: '8px 0' }}>
            Chưa có công-te-nơ. {isDraft ? 'Thêm ít nhất một trước khi điều vận.' : 'Thay đổi công-te-nơ sau điều vận sẽ tạo yêu cầu xem xét.'}
          </p>
        )}
        {rows.map((row, idx) => (
          <div key={row.id ?? `new-${idx}`} style={rowCardStyle}>
            <SelectField
              label="Loại công-te-nơ"
              value={row.containerTypeId}
              onChange={(e) => updateRow(idx, { containerTypeId: (e.target as HTMLSelectElement).value })}
              disabled={savingContainers}
            >
              <option value="">— Chọn —</option>
              {containerTypes.map((ct) => (
                <option key={ct.id} value={String(ct.id)}>{ct.name}</option>
              ))}
            </SelectField>
            <TextField
              label="Số công-te-nơ (ISO 6346)"
              value={row.containerNumber}
              onChange={(e) => updateRow(idx, { containerNumber: e.target.value })}
              placeholder="Ví dụ: MSKU1234565"
              disabled={savingContainers}
              maxLength={50}
            />
            <TextField
              label="Số niêm phong"
              value={row.sealNumber}
              onChange={(e) => updateRow(idx, { sealNumber: e.target.value })}
              disabled={savingContainers}
              maxLength={50}
            />
            <TextField
              label="Trọng lượng hàng (kg)"
              type="number"
              value={row.cargoWeightKg}
              onChange={(e) => updateRow(idx, { cargoWeightKg: e.target.value })}
              disabled={savingContainers}
            />
            <TextField
              label="Hãng tàu"
              value={row.shippingLineName}
              onChange={(e) => updateRow(idx, { shippingLineName: e.target.value })}
              disabled={savingContainers}
              maxLength={150}
            />
            <SearchableField
              id={`shipment-docs-container-${row.id ?? idx}-pickup-port`}
              label="Cảng nâng"
              value={row.pickupPortId}
              onChange={(value) => updateRow(idx, { pickupPortId: value })}
              disabled={savingContainers}
              options={portOptions.map((port) => ({ value: String(port.id), label: port.label }))}
              placeholder="Chọn cảng nâng"
            />
            <SearchableField
              id={`shipment-docs-container-${row.id ?? idx}-dropoff-port`}
              label="Cảng hạ"
              value={row.dropoffPortId}
              onChange={(value) => updateRow(idx, { dropoffPortId: value })}
              disabled={savingContainers}
              options={portOptions.map((port) => ({ value: String(port.id), label: port.label }))}
              placeholder="Chọn cảng hạ"
            />
            <button type="button" onClick={() => removeRow(idx)} disabled={Boolean(accountingLock)} style={dangerBtnStyle} aria-label="Xóa công-te-nơ">
              <Trash2 size={16} /> Xóa
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={addRow} disabled={Boolean(accountingLock)} style={secondaryBtnStyle}>
            <Plus size={16} /> Thêm công-te-nơ
          </button>
          <button type="button" onClick={handleSaveContainers} disabled={savingContainers || Boolean(accountingLock)} style={primaryBtnStyle}>
            <Save size={16} /> {savingContainers ? 'Đang lưu…' : (isPostDispatch ? 'Lưu hoặc gửi yêu cầu cont' : 'Lưu công-te-nơ')}
          </button>
        </div>
        {lockReason && <p style={{ ...mutedTextStyle, color: 'var(--danger, #b91c1c)' }}>{lockReason}</p>}
        {containerMsg && <MsgLine msg={containerMsg} />}
      </SectionCard>
      )}

      {isDraft && (
        <SectionCard title="Bàn giao điều phối">
          <p style={mutedTextStyle}>
            Sau khi bàn giao, Điều vận sẽ tiếp nhận từng công-te-nơ FCL hoặc lô LCL và gán nhà xe, xe, biển số cùng lái xe.
          </p>
          <button
            type="button"
            onClick={() => { void handleSubmitForDispatch(); }}
            disabled={dispatching || !readiness.ready || Boolean(accountingLock)}
            style={{ ...primaryBtnStyle, background: 'var(--accent, #2563eb)' }}
          >
            {dispatching ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            {dispatching ? 'Đang gửi…' : 'Gửi sang điều phối'}
          </button>
          {lockReason && <p style={{ ...mutedTextStyle, color: 'var(--danger, #b91c1c)' }}>{lockReason}</p>}
        </SectionCard>
      )}

      <SectionCard title="Tờ khai">
        {detail.declarations.length > 0 && (
          <div style={{ display: 'grid', gap: 10 }}>
            {detail.declarations.map((declaration: ShipmentDeclaration) => (
              <article key={declaration.id} style={listRowStyle}>
                <div>
                  <strong>{declaration.declarationNumber?.trim() || 'Chưa có số tờ khai'}</strong>
                  <div style={mutedTextStyle}>
                    {declaration.scope ?? 'SINGLE'} · {declaration.issuedAt ? new Date(declaration.issuedAt).toLocaleString('vi-VN') : 'Chưa có ngày phát hành'}
                  </div>
                </div>
                <button
                  type="button"
                  style={secondaryBtnStyle}
                  disabled={Boolean(accountingLock)}
                  onClick={() => setDeclarationForm({
                    id: declaration.id,
                    declarationNumber: declaration.declarationNumber ?? '',
                    issuedAt: formatVietnamDateTimeInput(declaration.issuedAt),
                    scope: declaration.scope ?? 'SINGLE',
                    note: declaration.note ?? '',
                  })}
                >
                  Sửa
                </button>
              </article>
            ))}
          </div>
        )}
        <TextField
          label="Số tờ khai"
          value={declarationForm.declarationNumber}
          onChange={(event) => setDeclarationForm((current) => ({ ...current, declarationNumber: event.target.value }))}
          disabled={savingDeclaration || Boolean(accountingLock)}
        />
        <TextField
          label="Ngày giờ phát hành"
          type="datetime-local"
          value={declarationForm.issuedAt}
          onChange={(event) => setDeclarationForm((current) => ({ ...current, issuedAt: event.target.value }))}
          disabled={savingDeclaration || Boolean(accountingLock)}
        />
        <SelectField
          label="Phạm vi tờ khai"
          value={declarationForm.scope}
          onChange={(event) => setDeclarationForm((current) => ({ ...current, scope: (event.target as HTMLSelectElement).value as 'SINGLE' | 'SHARED' }))}
          disabled={savingDeclaration || Boolean(accountingLock)}
        >
          <option value="SINGLE">Riêng lẻ</option>
          <option value="SHARED">Dùng chung</option>
        </SelectField>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Ghi chú</span>
          <textarea
            value={declarationForm.note}
            onChange={(event) => setDeclarationForm((current) => ({ ...current, note: event.target.value }))}
            rows={3}
            disabled={savingDeclaration || Boolean(accountingLock)}
            style={textareaStyle}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={handleSaveDeclaration} disabled={savingDeclaration || Boolean(accountingLock)} style={primaryBtnStyle}>
            <Save size={16} /> {savingDeclaration ? 'Đang lưu…' : (declarationForm.id != null ? 'Cập nhật tờ khai' : 'Thêm tờ khai')}
          </button>
          {declarationForm.id != null && (
            <button type="button" onClick={() => setDeclarationForm(EMPTY_DECLARATION_FORM)} disabled={Boolean(accountingLock)} style={secondaryBtnStyle}>
              Hủy sửa
            </button>
          )}
        </div>
        {lockReason && <p style={{ ...mutedTextStyle, color: 'var(--danger, #b91c1c)' }}>{lockReason}</p>}
        {declarationMsg && <MsgLine msg={declarationMsg} />}
      </SectionCard>

      <SectionCard title="Tài liệu chứng từ">
        {detail.documents.length > 0 && (
          <div style={{ display: 'grid', gap: 10 }}>
            {detail.documents.map((document: ShipmentDocument) => (
              <article key={document.id} style={listRowStyle}>
                <div>
                  <strong>{document.type ?? 'OTHER'}</strong>
                  <div style={mutedTextStyle}>{document.storageKey}</div>
                </div>
                <button
                  type="button"
                  style={secondaryBtnStyle}
                  disabled={Boolean(accountingLock)}
                  onClick={() => {
                    setReplaceDocumentTarget(document);
                    setDocumentForm({
                      type: (document.type ?? 'OTHER') as typeof EMPTY_DOC_FORM.type,
                      storageKey: '',
                      expiresAt: document.expiresAt ?? '',
                    });
                  }}
                >
                  Thay thế
                </button>
              </article>
            ))}
          </div>
        )}
        {!replaceDocumentTarget && (
          <SelectField
            label="Loại tài liệu"
            value={documentForm.type}
            onChange={(event) => setDocumentForm((current) => ({ ...current, type: (event.target as HTMLSelectElement).value as typeof EMPTY_DOC_FORM.type }))}
            disabled={savingDocument || Boolean(accountingLock)}
          >
            <option value="BOOKING">BOOKING</option>
            <option value="BL">BL</option>
            <option value="DO">DO</option>
            <option value="DECLARATION">DECLARATION</option>
            <option value="OTHER">OTHER</option>
          </SelectField>
        )}
        <TextField
          label={replaceDocumentTarget
            ? `Đường dẫn lưu trữ mới cho tài liệu ${replaceDocumentTarget.type ?? 'hiện tại'}`
            : 'Đường dẫn lưu trữ tài liệu'}
          value={documentForm.storageKey}
          onChange={(event) => setDocumentForm((current) => ({ ...current, storageKey: event.target.value }))}
          disabled={savingDocument || Boolean(accountingLock)}
        />
        <DateField
          label="Ngày hết hạn (nếu có)"
          value={documentForm.expiresAt}
          onChange={(value) => setDocumentForm((current) => ({ ...current, expiresAt: value }))}
          disabled={savingDocument || Boolean(accountingLock)}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={handleSaveDocument} disabled={savingDocument || Boolean(accountingLock)} style={primaryBtnStyle}>
            <Save size={16} /> {savingDocument ? 'Đang lưu…' : (replaceDocumentTarget ? 'Thay thế tài liệu' : 'Thêm tài liệu')}
          </button>
          {replaceDocumentTarget && (
            <button
              type="button"
              onClick={() => {
                setReplaceDocumentTarget(null);
                setDocumentForm(EMPTY_DOC_FORM);
              }}
              disabled={Boolean(accountingLock)}
              style={secondaryBtnStyle}
            >
              Hủy thay thế
            </button>
          )}
        </div>
        {lockReason && <p style={{ ...mutedTextStyle, color: 'var(--danger, #b91c1c)' }}>{lockReason}</p>}
        {documentMsg && <MsgLine msg={documentMsg} />}
      </SectionCard>

      <SectionCard title={canReview ? 'Yêu cầu thay đổi chờ xử lý' : 'Yêu cầu thay đổi đã gửi'}>
        {reviewMsg && <MsgLine msg={reviewMsg} />}
        {detail.pendingChangeRequests.length === 0 ? (
          <p style={mutedParagraphStyle}>Chưa có yêu cầu thay đổi nào đang chờ xử lý.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {detail.pendingChangeRequests.map((request) => (
              <article key={request.id} style={listRowStyle}>
                <div>
                  <strong>{request.requestKind === 'PLAN_UPDATE' ? 'Đổi kế hoạch' : 'Đổi công-te-nơ'}</strong>
                  <div style={mutedTextStyle}>
                    Phiên bản gốc {request.sourceVersion} · {request.requester?.fullName ?? request.requester?.username ?? 'Người dùng không xác định'}
                  </div>
                </div>
                {canReview ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      style={primaryBtnStyle}
                      disabled={reviewingRequestId === request.id}
                      onClick={() => handleReviewRequest(request, 'APPLIED')}
                    >
                      Áp dụng
                    </button>
                    <button
                      type="button"
                      style={dangerBtnStyle}
                      disabled={reviewingRequestId === request.id}
                      onClick={() => handleReviewRequest(request, 'REJECTED')}
                    >
                      Từ chối
                    </button>
                  </div>
                ) : (
                  <span style={mutedTextStyle}>Đang chờ quản lý hoặc điều vận xử lý</span>
                )}
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      {dialog}
      <CarrierAllocationDialog
        isOpen={carrierAllocationDialogOpen}
        title="Gán nhà xe"
        description="Phân bổ đúng số lượng container 20' và 40' theo từng nhà xe trước khi lưu."
        carrierOptions={normalizedCarrierOptions}
        demand={carrierDemand}
        value={carrierAllocations}
        onClose={() => setCarrierAllocationDialogOpen(false)}
        onSave={(rows) => { void handleSaveCarrierAllocations(rows); }}
      />
      <OperationalSiteDetailsDialog site={detailSite} isOpen={Boolean(detailSite)} onClose={() => setDetailSite(null)} />
    </div>
  );
}

// ─── Inline presentational helpers (kept local; the page is the only consumer) ──

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none',
  border: 'none', color: 'var(--fg-2)', fontSize: 14, minHeight: 44, padding: '8px 4px', cursor: 'pointer',
};

const twoColumnFieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
  minWidth: 0,
};

const threeColumnFieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 12,
  minWidth: 0,
};

const textareaLabelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  color: 'var(--fg-2)',
  fontSize: 14,
  fontWeight: 600,
};

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  minHeight: 44, padding: '0 20px', background: 'var(--fg-3)', color: '#fff',
  border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer', width: '100%',
};

const secondaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  minHeight: 44, padding: '0 20px', background: 'transparent', color: 'var(--accent, #2563eb)',
  border: '1px solid var(--accent, #2563eb)', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer',
};

const dangerBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  minHeight: 44, padding: '0 14px', background: 'transparent', color: 'var(--danger)',
  border: '1px solid var(--danger)', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

const readinessOkStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16,
  borderRadius: 8, fontSize: 14, color: 'var(--ok, #16a34a)',
  background: 'rgba(22,163,74,0.08)',
};

const readinessWarnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16,
  borderRadius: 8, fontSize: 14, color: 'var(--warn, #d97706)',
  background: 'rgba(217,119,6,0.08)',
};

const infoBannerStyle: React.CSSProperties = {
  padding: '10px 14px',
  marginBottom: 16,
  borderRadius: 8,
  fontSize: 14,
  color: 'var(--fg-2)',
  background: 'rgba(37,99,235,0.08)',
};

const rowCardStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: 12, marginBottom: 12,
  border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, background: 'var(--surface-2, #fafafa)',
};

const listRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
  padding: 12,
  borderRadius: 8,
  border: '1px solid var(--border, #e5e7eb)',
  flexWrap: 'wrap',
};

const mutedTextStyle: React.CSSProperties = {
  color: 'var(--fg-3)',
  fontSize: 13,
};

const mutedParagraphStyle: React.CSSProperties = {
  color: 'var(--fg-3)',
  fontSize: 14,
  margin: 0,
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid var(--border, #e5e7eb)',
  padding: 10,
  font: 'inherit',
};

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </section>
  );
}

function MsgLine({ msg }: { msg: { kind: 'ok' | 'err'; text: string } }) {
  return (
    <div role={msg.kind === 'err' ? 'alert' : 'status'} style={{
      color: msg.kind === 'err' ? 'var(--danger)' : 'var(--ok, #16a34a)',
      fontSize: 14, padding: '4px 0',
    }}>
      {msg.text}
    </div>
  );
}
