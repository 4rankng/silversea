// SIL-171 (FB-147): "Sửa lô" reuses the Tạo lô hàng form in edit mode.
// This module owns the single mapping GET /shipments/:id → the create form's
// state (form + container drafts + customer note) plus the workflow's edit
// seed (id/version). It lives outside ShipmentCreateWorkspace
// so the workspace keeps its structure-guard shape and the mapping is
// unit-testable without React.
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';
import type { ShipmentDetail } from '../../../api/shipmentClient';
import {
  createEmptyContainer,
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
} from './shipment-create-model';

/**
 * GET /shipments/:id selects the FULL shipments + shipment_containers rows,
 * but the client's `Shipment`/`ShipmentContainer` interfaces only declare the
 * fields earlier surfaces read. The edit form needs the rest (catalog ids,
 * ad-hoc raw names, the customer note) — declared here instead of growing
 * shipmentClient.ts past its frozen structure ceiling.
 */
export type ShipmentEditDetail = ShipmentDetail & {
  shipment: ShipmentDetail['shipment'] & {
    cargoTypeId?: number | null;
    isCombined?: boolean | null;
    customerNotes?: string | null;
    rawCustomerName?: string | null;
    rawRouteName?: string | null;
  };
  containers: Array<ShipmentDetail['containers'][number] & {
    routeId?: number | null;
    operationalSiteId?: number | null;
    rawRouteName?: string | null;
    rawFactoryName?: string | null;
    rawPickupPortName?: string | null;
    rawDropoffPortName?: string | null;
  }>;
};

/** Optimistic-lock identity the create workflow's reconcile
 *  steps need to UPDATE the existing lot instead of creating a new one. */
export interface ShipmentEditSeed {
  shipmentId: number;
  version: number;
  /** FCL lots seed the container reconcile so the first save re-asserts the
   *  row set (and a delete-all edit still reaches the server). LCL is
   *  containerless by design and never reconciles. */
  fclContainers: boolean;
}

export interface ShipmentEditPrefill {
  form: ShipmentCreateFormState;
  containers: ShipmentContainerDraft[];
  customerNotes: string;
  seed: ShipmentEditSeed;
}

const idString = (value: number | null | undefined) =>
  value != null ? String(value) : '';

const isoDate = (value: string | null | undefined) =>
  value ? value.slice(0, 10) : '';

function containerDraftFromRow(row: ShipmentEditDetail['containers'][number]): ShipmentContainerDraft {
  return {
    key: crypto.randomUUID(),
    id: row.id,
    containerNumber: row.containerNumber ?? '',
    containerTypeId: idString(row.containerTypeId),
    routeId: idString(row.routeId),
    rawRouteName: row.rawRouteName ?? '',
    pickupPortId: idString(row.pickupPortId),
    dropoffPortId: idString(row.dropoffPortId),
    rawPickupPortName: row.rawPickupPortName ?? '',
    rawDropoffPortName: row.rawDropoffPortName ?? '',
    cargoWeightKg: row.cargoWeightKg ?? '',
    cargoVolumeCbm: row.cargoVolumeCbm ?? '',
    customerAppointmentAt: formatVietnamDateTimeInput(row.customerAppointmentAt),
    operationalSiteId: idString(row.operationalSiteId),
    rawFactoryName: row.rawFactoryName ?? '',
  };
}

/** Map the lot detail onto the create form's state. Hình thức XNK
 *  (tradeDirection) is the field the QA report called out — it rides the
 *  same radio the create form validates, so an edit cannot lose it. */
export function buildShipmentEditPrefill(detail: ShipmentEditDetail): ShipmentEditPrefill {
  const { shipment } = detail;
  const isLcl = shipment.cargoMode === 'LCL';
  // The create payload stores the kho free text on the direction-correct
  // lift/drop column (FB-105 §3); read it back the same way when no catalog
  // site was picked.
  const warehouseFreeText = shipment.tradeDirection === 'EXPORT'
    ? shipment.deliveryLocation ?? ''
    : shipment.pickupLocation ?? '';
  // SIL-521: tờ khai không còn prefill cấp lô — số tờ khai chỉ sống ở cấp cont.

  const form: ShipmentCreateFormState = {
    customerId: shipment.customerId != null ? String(shipment.customerId) : '',
    isAdHoc: shipment.isAdHoc ?? false,
    rawCustomerName: shipment.rawCustomerName ?? '',
    rawRouteName: shipment.rawRouteName ?? '',
    // Root factory/kho text only stands in when no catalog site is linked —
    // otherwise the pickers show the catalog selection.
    factoryName: isLcl && shipment.operationalSiteId == null ? shipment.factoryName ?? '' : '',
    routeId: isLcl ? idString(shipment.routeId) : '',
    cargoTypeId: idString(shipment.cargoTypeId),
    bookingRef: shipment.bookingRef ?? '',
    blNumber: shipment.blNumber ?? '',
    shippingLineName: shipment.shippingLineName ?? '',
    tradeDirection: shipment.tradeDirection ?? '',
    cargoMode: shipment.cargoMode ?? 'FCL',
    isCombined: shipment.isCombined ?? false,
    // Deposit is create-only intake intent (persists as its own tracker
    // rows); the edit form does not re-collect it.
    hasDeposit: false,
    depositAmount: '',
    operationalSiteId: isLcl ? idString(shipment.operationalSiteId) : '',
    pickupWarehouseSiteId: isLcl ? idString(shipment.pickupWarehouseSiteId) : '',
    pickupWarehouseName: isLcl && shipment.pickupWarehouseSiteId == null ? warehouseFreeText : '',
    customsCutoffAt: formatVietnamDateTimeInput(shipment.customsCutoffAt),
    closingAt: formatVietnamDateTimeInput(shipment.closingAt),
    plannedReturnAt: formatVietnamDateTimeInput(shipment.plannedReturnAt),
    expectedDeliveryDate: isLcl ? isoDate(shipment.expectedDeliveryDate) : '',
    // Extra delivery days persist inside the driver note (create model §);
    // they are not parsed back out — the note itself round-trips below.
    extraDeliveryDates: [],
    cargoWeightKg: shipment.cargoWeightKg ?? '',
    cargoVolumeCbm: shipment.cargoVolumeCbm ?? '',
    packageCount: shipment.packageCount != null ? String(shipment.packageCount) : '',
    packageType: shipment.packageType ?? '',
    operationalNotes: shipment.operationalNotes ?? '',
  };

  const containers = isLcl
    ? []
    : detail.containers.map(containerDraftFromRow);

  return {
    form,
    // An FCL lot with zero persisted container rows still opens the editor
    // with one empty row — the create form's own starting shape.
    containers: containers.length > 0 ? containers : (isLcl ? [] : [createEmptyContainer()]),
    customerNotes: shipment.customerNotes ?? '',
    seed: {
      shipmentId: shipment.id,
      version: shipment.version,
      fclContainers: !isLcl,
    },
  };
}
