import { localDateTimeToIso } from '../../../lib/shipment-operations';
import { ShipmentStatus } from '@tingting/shared';

export type CargoMode = 'FCL' | 'LCL';
export type SaveIntent = 'DRAFT' | 'SUBMIT';

export interface ShipmentCreateFormState {
  customerId: string;
  routeId: string;
  cargoTypeId: string;
  bookingRef: string;
  blNumber: string;
  shippingLineName: string;
  declarationNumber: string;
  tradeDirection: '' | 'IMPORT' | 'EXPORT';
  cargoMode: CargoMode;
  isCombined: boolean;
  operationalSiteId: string;
  pickupWarehouseSiteId: string;
  customsCutoffAt: string;
  closingAt: string;
  plannedReturnAt: string;
  expectedDeliveryDate: string;
  /**
   * LCL split-lot extra delivery dates (doc Create Shipment Block 2B: "[+]"
   * adds more delivery days). The backend has no array column for these yet,
   * so they persist formatted inside the driver note; the first date is
   * `expectedDeliveryDate` proper and drives the auto-status rule.
   */
  extraDeliveryDates: string[];
  cargoWeightKg: string;
  cargoVolumeCbm: string;
  packageCount: string;
  packageType: string;
  operationalNotes: string;
}

export interface ShipmentContainerDraft {
  key: string;
  containerNumber: string;
  containerTypeId: string;
  /** Selected independently for this container. */
  routeId: string;
  pickupPortId: string;
  dropoffPortId: string;
  cargoWeightKg: string;
  cargoVolumeCbm: string;
  /** Ngày giờ đóng/trả của riêng container này, entered in Vietnam local time. */
  customerAppointmentAt: string;
  /** Per-container factory authority (SILVER L1): empty inherits nothing —
   *  the shipment factory pre-fills new rows as a suggestion only. */
  operationalSiteId: string;
}

export type ShipmentCreateSectionId = 'identity' | 'route' | 'cargo' | 'schedule';

export interface ShipmentCreateIssue {
  fieldId: string;
  message: string;
  sectionId: ShipmentCreateSectionId;
}

export interface ShipmentCreateSectionReadiness {
  id: ShipmentCreateSectionId;
  label: string;
  complete: boolean;
  missingCount: number;
}

export interface ShipmentCreateReadiness {
  draftReady: boolean;
  dispatchReady: boolean;
  initialStatus: ShipmentStatus.PENDING_DATE | ShipmentStatus.READY_FOR_DISPATCH;
  issues: ShipmentCreateIssue[];
  sections: ShipmentCreateSectionReadiness[];
  firstInvalidFieldId: string | null;
}

export const EMPTY_SHIPMENT_CREATE_FORM: ShipmentCreateFormState = {
  customerId: '',
  routeId: '',
  cargoTypeId: '',
  bookingRef: '',
  blNumber: '',
  shippingLineName: '',
  declarationNumber: '',
  tradeDirection: '',
  cargoMode: 'FCL',
  isCombined: false,
  operationalSiteId: '',
  pickupWarehouseSiteId: '',
  customsCutoffAt: '',
  closingAt: '',
  plannedReturnAt: '',
  expectedDeliveryDate: '',
  extraDeliveryDates: [],
  cargoWeightKg: '',
  cargoVolumeCbm: '',
  packageCount: '',
  packageType: '',
  operationalNotes: '',
};

export function createEmptyContainer(): ShipmentContainerDraft {
  return {
    key: crypto.randomUUID(),
    containerNumber: '',
    containerTypeId: '',
    routeId: '',
    pickupPortId: '',
    dropoffPortId: '',
    cargoWeightKg: '',
    cargoVolumeCbm: '',
    customerAppointmentAt: '',
    operationalSiteId: '',
  };
}

/**
 * Start a new FCL row from the preceding row's operational data. The physical
 * container number is the only value that must be entered again.
 */
export function createContainerFromPrevious(
  previous?: ShipmentContainerDraft,
): ShipmentContainerDraft {
  if (!previous) return createEmptyContainer();

  return {
    ...previous,
    key: crypto.randomUUID(),
    containerNumber: '',
  };
}

function issue(
  fieldId: string,
  message: string,
  sectionId: ShipmentCreateSectionId,
): ShipmentCreateIssue {
  return { fieldId, message, sectionId };
}

export function getShipmentCreateReadiness(
  form: ShipmentCreateFormState,
  containers: ShipmentContainerDraft[],
): ShipmentCreateReadiness {
  const issues: ShipmentCreateIssue[] = [];

  if (!form.customerId) {
    issues.push(issue('shipment-customer', 'Chọn khách hàng.', 'identity'));
  }
  if (!form.tradeDirection) {
    issues.push(issue('shipment-trade-direction', 'Chọn hình thức nhập khẩu hoặc xuất khẩu.', 'identity'));
  } else if (form.tradeDirection === 'IMPORT' && !form.blNumber) {
    issues.push(issue('shipment-booking-ref', 'Hàng Nhập cần Số Bill.', 'identity'));
  } else if (form.tradeDirection === 'EXPORT' && !form.bookingRef) {
    issues.push(issue('shipment-booking-ref', 'Hàng Xuất cần Số Booking.', 'identity'));
  }
  if (form.cargoMode === 'LCL' && !form.routeId) {
    issues.push(issue('shipment-route', 'Chọn tuyến đường.', 'route'));
  }

  if (form.cargoMode === 'FCL') {
    containers.forEach((row, index) => {
      const prefix = `container-${row.key}`;
      const label = `Container ${index + 1}`;
      if (!row.containerTypeId) issues.push(issue(`${prefix}-type`, `${label}: chọn loại container.`, 'cargo'));
      if (!row.operationalSiteId) issues.push(issue(`${prefix}-factory`, `${label}: chọn nhà máy.`, 'cargo'));
      if (!row.routeId) issues.push(issue(`${prefix}-route`, `${label}: chọn tuyến đường.`, 'cargo'));
      if (!row.pickupPortId) issues.push(issue(`${prefix}-pickup-port`, `${label}: chọn cảng nâng.`, 'cargo'));
      if (!row.dropoffPortId) issues.push(issue(`${prefix}-dropoff-port`, `${label}: chọn cảng hạ.`, 'cargo'));
      if (!row.customerAppointmentAt) issues.push(issue(`${prefix}-customer-appointment`, `${label}: chọn ngày giờ đóng/trả.`, 'schedule'));
    });
  } else {
    if (!form.pickupWarehouseSiteId) issues.push(issue('shipment-pickup-warehouse', 'Chọn kho lấy hàng.', 'route'));
    if (!form.packageType) issues.push(issue('shipment-package-type', 'Nhập quy cách đóng gói.', 'cargo'));
    if (!form.packageCount || Number(form.packageCount) < 1) issues.push(issue('shipment-package-count', 'Nhập số lượng kiện lớn hơn 0.', 'cargo'));
    if (!form.cargoWeightKg || Number(form.cargoWeightKg) <= 0) issues.push(issue('shipment-cargo-weight', 'Nhập trọng lượng lớn hơn 0.', 'cargo'));
    if (!form.cargoVolumeCbm || Number(form.cargoVolumeCbm) <= 0) issues.push(issue('shipment-cargo-volume', 'Nhập thể tích lớn hơn 0.', 'cargo'));
    if (!form.expectedDeliveryDate) issues.push(issue('shipment-expected-delivery', 'Chọn ngày giao dự kiến.', 'schedule'));
  }

  const sectionDefinitions: Array<[ShipmentCreateSectionId, string]> = [
    ['identity', 'Nhận diện lô'],
    ['route', 'Điểm vận hành & tuyến'],
    ['cargo', 'Thông tin hàng'],
    ['schedule', 'Lịch & ghi chú'],
  ];
  const sections = sectionDefinitions.map(([id, label]) => {
    const missingCount = issues.filter((item) => item.sectionId === id).length;
    return { id, label, complete: missingCount === 0, missingCount };
  });

  return {
    draftReady: Boolean(form.customerId),
    dispatchReady: issues.length === 0,
    initialStatus: form.cargoMode === 'LCL' && (form.expectedDeliveryDate || form.closingAt || form.plannedReturnAt)
      ? ShipmentStatus.READY_FOR_DISPATCH
      : ShipmentStatus.PENDING_DATE,
    issues,
    sections,
    firstInvalidFieldId: issues[0]?.fieldId ?? null,
  };
}

export function validateShipmentCreate(
  intent: SaveIntent,
  readiness: ShipmentCreateReadiness,
): ShipmentCreateIssue[] {
  if (intent === 'DRAFT') {
    return readiness.draftReady
      ? []
      : [issue('shipment-customer', 'Chọn khách hàng để tạo lô hàng.', 'identity')];
  }
  return readiness.issues;
}

interface OperationalSiteName {
  id: number;
  name: string;
  shortName?: string;
}

export function buildShipmentRootPayload(
  form: ShipmentCreateFormState,
  containers: ShipmentContainerDraft[],
  sites: OperationalSiteName[],
) {
  return {
    customerId: Number(form.customerId),
    // Route authority for FCL lives in shipment_containers. Keep the root
    // column empty so no later reader can mistake it for a lot-level route.
    routeId: form.cargoMode === 'LCL' && form.routeId ? Number(form.routeId) : null,
    cargoTypeId: form.cargoTypeId ? Number(form.cargoTypeId) : null,
    bookingRef: form.tradeDirection === 'EXPORT' ? form.bookingRef || null : null,
    blNumber: form.tradeDirection === 'IMPORT' ? form.blNumber || null : null,
    tradeDirection: form.tradeDirection || null,
    cargoMode: form.cargoMode,
    isCombined: form.isCombined,
    operationalSiteId: form.cargoMode === 'LCL' && form.operationalSiteId ? Number(form.operationalSiteId) : null,
    pickupWarehouseSiteId: form.cargoMode === 'LCL' && form.pickupWarehouseSiteId ? Number(form.pickupWarehouseSiteId) : null,
    factoryName: (() => {
      if (form.cargoMode !== 'LCL') return null;
      const site = sites.find((item) => String(item.id) === form.operationalSiteId);
      return site?.shortName || site?.name || null;
    })(),
    shippingLineName: form.cargoMode === 'FCL' ? form.shippingLineName || null : null,
    customsCutoffAt: localDateTimeToIso(form.customsCutoffAt),
    closingAt: localDateTimeToIso(form.closingAt),
    plannedReturnAt: localDateTimeToIso(form.plannedReturnAt),
    // FCL's lot date is derived by the container reconcile in the backend;
    // only LCL retains a shipment-level delivery date.
    expectedDeliveryDate: form.cargoMode === 'LCL' ? form.expectedDeliveryDate || null : undefined,
    cargoWeightKg: form.cargoMode === 'LCL' ? form.cargoWeightKg || null : null,
    cargoVolumeCbm: form.cargoMode === 'LCL' ? form.cargoVolumeCbm || null : null,
    packageCount: form.cargoMode === 'LCL' && form.packageCount ? Number(form.packageCount) : null,
    packageType: form.cargoMode === 'LCL' ? form.packageType || null : null,
    driverNotes: [
      form.cargoMode === 'LCL' && form.extraDeliveryDates.length > 0
        ? `Ngày giao bổ sung: ${form.extraDeliveryDates.filter(Boolean).join(', ')}`
        : '',
      form.operationalNotes,
    ].filter(Boolean).join('\n') || null,
  };
}

export function buildShipmentContainerPayload(
  form: ShipmentCreateFormState,
  containers: ShipmentContainerDraft[],
) {
  const rows = form.cargoMode === 'FCL'
    ? containers.filter((row) => Object.entries(row).some(([key, value]) => key !== 'key' && value))
    : [];
  return rows.map((row) => ({
    containerNumber: row.containerNumber || null,
    containerTypeId: row.containerTypeId ? Number(row.containerTypeId) : null,
    shippingLineName: form.shippingLineName || null,
    routeId: row.routeId ? Number(row.routeId) : null,
    pickupPortId: row.pickupPortId ? Number(row.pickupPortId) : null,
    dropoffPortId: row.dropoffPortId ? Number(row.dropoffPortId) : null,
    operationalSiteId: row.operationalSiteId ? Number(row.operationalSiteId) : null,
    cargoWeightKg: row.cargoWeightKg || null,
    cargoVolumeCbm: row.cargoVolumeCbm || null,
    customerAppointmentAt: localDateTimeToIso(row.customerAppointmentAt),
  }));
}
