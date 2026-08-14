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
  operationalSiteId: string;
  pickupWarehouseSiteId: string;
  customsCutoffAt: string;
  closingAt: string;
  plannedReturnAt: string;
  expectedDeliveryDate: string;
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
  pickupPortId: string;
  dropoffPortId: string;
  cargoWeightKg: string;
  cargoVolumeCbm: string;
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
  operationalSiteId: '',
  pickupWarehouseSiteId: '',
  customsCutoffAt: '',
  closingAt: '',
  plannedReturnAt: '',
  expectedDeliveryDate: '',
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
    pickupPortId: '',
    dropoffPortId: '',
    cargoWeightKg: '',
    cargoVolumeCbm: '',
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
  carrierAllocationError: string | null,
): ShipmentCreateReadiness {
  const issues: ShipmentCreateIssue[] = [];

  if (!form.customerId) {
    issues.push(issue('shipment-customer', 'Chọn khách hàng.', 'identity'));
  }
  if (!form.bookingRef && !form.blNumber) {
    issues.push(issue('shipment-booking-ref', 'Nhập số Bill hoặc số Booking.', 'identity'));
  }
  if (form.cargoMode === 'FCL' && !form.shippingLineName) {
    issues.push(issue('shipment-shipping-line', 'Nhập hãng tàu của lô hàng.', 'identity'));
  }
  if (!form.routeId) {
    issues.push(issue('shipment-route', 'Chọn tuyến đường.', 'route'));
  }

  if (form.cargoMode === 'FCL') {
    if (!form.operationalSiteId) {
      issues.push(issue('shipment-operational-site', 'Chọn nhà máy giao hàng.', 'route'));
    }
    containers.forEach((row, index) => {
      const prefix = `container-${row.key}`;
      const label = `Container ${index + 1}`;
      if (!row.containerNumber) issues.push(issue(`${prefix}-number`, `${label}: nhập số container.`, 'cargo'));
      if (!row.containerTypeId) issues.push(issue(`${prefix}-type`, `${label}: chọn loại container.`, 'cargo'));
      if (!row.pickupPortId) issues.push(issue(`${prefix}-pickup-port`, `${label}: chọn cảng nâng.`, 'cargo'));
      if (!row.dropoffPortId) issues.push(issue(`${prefix}-dropoff-port`, `${label}: chọn cảng hạ.`, 'cargo'));
    });
    if (carrierAllocationError) {
      issues.push(issue('shipment-carrier-allocation', carrierAllocationError, 'cargo'));
    }
    if (!form.expectedDeliveryDate && !form.closingAt && !form.plannedReturnAt) {
      issues.push(issue(
        'shipment-expected-delivery',
        'Nhập ngày giao dự kiến, hạn hạ container hoặc thời điểm trả container trước khi gửi điều phối.',
        'schedule',
      ));
    }
  } else {
    if (!form.pickupWarehouseSiteId) issues.push(issue('shipment-pickup-warehouse', 'Chọn kho lấy hàng.', 'route'));
    if (!form.cargoTypeId) issues.push(issue('shipment-cargo-type', 'Chọn loại hàng để tính cước lô hàng lẻ.', 'cargo'));
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
    initialStatus: form.expectedDeliveryDate || form.closingAt || form.plannedReturnAt
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
      : [issue('shipment-customer', 'Chọn khách hàng để lưu bản nháp.', 'identity')];
  }
  return readiness.issues;
}

interface OperationalSiteName {
  id: number;
  name: string;
}

export function buildShipmentRootPayload(
  form: ShipmentCreateFormState,
  containers: ShipmentContainerDraft[],
  sites: OperationalSiteName[],
) {
  return {
    customerId: Number(form.customerId),
    routeId: form.routeId ? Number(form.routeId) : null,
    cargoTypeId: form.cargoTypeId ? Number(form.cargoTypeId) : null,
    bookingRef: form.bookingRef || null,
    blNumber: form.blNumber || null,
    tradeDirection: form.tradeDirection || null,
    cargoMode: form.cargoMode,
    operationalSiteId: form.cargoMode === 'FCL' && form.operationalSiteId ? Number(form.operationalSiteId) : null,
    pickupWarehouseSiteId: form.cargoMode === 'LCL' && form.pickupWarehouseSiteId ? Number(form.pickupWarehouseSiteId) : null,
    factoryName: form.cargoMode === 'FCL'
      ? sites.find((site) => String(site.id) === form.operationalSiteId)?.name ?? null
      : null,
    shippingLineName: form.cargoMode === 'FCL' ? form.shippingLineName || null : null,
    customsCutoffAt: localDateTimeToIso(form.customsCutoffAt),
    closingAt: localDateTimeToIso(form.closingAt),
    plannedReturnAt: localDateTimeToIso(form.plannedReturnAt),
    expectedDeliveryDate: form.expectedDeliveryDate || null,
    cargoWeightKg: form.cargoMode === 'LCL' ? form.cargoWeightKg || null : null,
    cargoVolumeCbm: form.cargoMode === 'LCL' ? form.cargoVolumeCbm || null : null,
    packageCount: form.cargoMode === 'LCL' && form.packageCount ? Number(form.packageCount) : null,
    packageType: form.cargoMode === 'LCL' ? form.packageType || null : null,
    operationalNotes: [
      form.declarationNumber ? `Số tờ khai: ${form.declarationNumber}` : '',
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
    pickupPortId: row.pickupPortId ? Number(row.pickupPortId) : null,
    dropoffPortId: row.dropoffPortId ? Number(row.dropoffPortId) : null,
    cargoWeightKg: row.cargoWeightKg || null,
    cargoVolumeCbm: row.cargoVolumeCbm || null,
  }));
}
