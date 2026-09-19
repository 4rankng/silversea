// Shared shipment type definitions (T3b split).
//
// Pure types only — no runtime imports. Both shipment.service (mutation
// surface) and the leaf services (containers, documents, intake) import from
// here, which keeps every module edge one-way at runtime.

import * as s from '../db/schema';

export type ShipmentDocumentTypeValue = (typeof s.shipmentDocuments.type.enumValues)[number];
export type ShipmentDeclarationScopeValue = (typeof s.shipmentDeclarations.scope.enumValues)[number];

export interface ShipmentContainerInput {
  id?: number;
  containerTypeId?: number | null;
  containerNumber?: string | null;
  sealNumber?: string | null;
  cargoWeightKg?: string | number | null;
  cargoVolumeCbm?: string | number | null;
  shippingLineName?: string | null;
  routeId?: number | null;
  pickupPortId?: number | null;
  dropoffPortId?: number | null;
  /** Ad-hoc (Lệnh chạy ngoài) free-text cảng nâng/hạ — XOR with the port ids. */
  rawPickupPortName?: string | null;
  rawDropoffPortName?: string | null;
  operationalSiteId?: number | null;
  /** Ad-hoc row-tier free-text factory/route — XOR with the ids above. */
  rawFactoryName?: string | null;
  rawRouteName?: string | null;
  customerAppointmentAt?: string | null;
  notes?: string | null;
}

export interface UpdateShipmentInput {
  expectedVersion?: number; // Required for optimistic-lock check
  version?: number;
  customerId?: number;
  routeId?: number | null;
  cargoTypeId?: number | null;
  responsibleUnitId?: number | null;
  bookingRef?: string | null;
  blNumber?: string | null;
  tradeDirection?: typeof s.shipmentTradeDirectionEnum.enumValues[number] | null;
  cargoMode?: typeof s.shipmentCargoModeEnum.enumValues[number] | null;
  operationalSiteId?: number | null;
  pickupWarehouseSiteId?: number | null;
  factoryName?: string | null;
  isCombined?: boolean;
  shippingLineName?: string | null;
  expectedDeliveryDate?: string | null;
  customsCutoffAt?: string | null;
  closingAt?: string | null;
  plannedReturnAt?: string | null;
  cargoWeightKg?: string | number | null;
  cargoVolumeCbm?: string | number | null;
  packageCount?: number | null;
  packageType?: string | null;
  operationalNotes?: string | null;
  customerNotes?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  updatedBy?: number | null;
}

export type ShipmentDeclarationMutationInput = {
  id?: number;
  declarationNumber?: string | null;
  issuedAt?: string | null;
  scope?: typeof s.shipmentDeclarations.scope.enumValues[number];
  note?: string | null;
  channel?: typeof s.shipmentDeclarations.channel.enumValues[number] | null;
  updatedBy?: number | null;
};

/** Result of a container batch-upsert / reconcile (moved type surface). */
export interface ShipmentContainerMutationResult {
  items: Array<typeof s.shipmentContainers.$inferSelect>;
  upsertedIds: number[];
  shipmentVersion: number;
  changeMode: 'DIRECT' | 'REQUESTED' | 'NOOP';
  changeRequestId: number | null;
  message?: string;
  notificationDelivered?: boolean;
}
export type ShipmentStatus =
  | 'NEW'
  | 'PENDING_DATE'
  | 'READY_FOR_DISPATCH'
  | 'DISPATCHED'
  | 'IN_TRANSIT'
  | 'COMPLETED'
  | 'CANCELED';
