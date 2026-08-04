import { api } from '../lib/api';
import type { CursorPaginatedResponse } from '@tingting/shared';

export interface DispatchTruck {
  id: number;
  licensePlate: string;
  status: string;
  trailerType: string | null;
  currentTrailerId: number | null;
  currentTrailerPlate: string | null;
  capacityKg: string | null;
  assignedDriverId: number | null;
  assignedDriverName: string | null;
}

export interface DispatchDriver {
  id: number;
  name: string;
  phone: string | null;
  status: string;
  assignedTruckId: number | null;
  assignedTruckPlate: string | null;
  userId: number | null;
}

export interface DispatchExternalCarrier {
  id: number;
  name: string;
  isActive?: boolean;
}

export interface DispatchCarrierVehicle {
  id: number;
  carrierId: number;
  licensePlate: string;
  isActive: boolean;
}

export interface DispatchAccountingLock {
  billingDocumentId: number;
  billingDocumentNumber?: string | null;
  activatedAt: string;
  activatedByName?: string | null;
  reason: string;
}

export interface DispatchPlannedCarrier {
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  carrierName: string | null;
  vehicleId?: number | null;
  vehiclePlate?: string | null;
}

export interface DispatchQueueItem {
  fulfillmentId: number;
  shipmentId: number;
  handoffId: number;
  handoffVersion: number;
  fulfillmentVersion: number;
  shipmentVersion: number;
  taskStatus: 'READY' | 'DISPATCHED';
  urgency: 'NORMAL' | 'URGENT';
  cargoMode: 'FCL' | 'LCL';
  fulfillmentType: 'FCL_CONTAINER' | 'LCL_SHIPMENT';
  tripId: number | null;
  customer: { id: number; name: string };
  route: { id: number; name: string; distanceKm: number | null; serviceDurationMinutes: number | null };
  operationalSite: { id: number | null; name: string | null; address: string | null; googleMapsUrl: string | null; strictRules: string | null };
  pickupWarehouse: { id: number | null; name: string | null; address: string | null; googleMapsUrl: string | null; strictRules: string | null };
  shipment: { code: string | null; bookingRef: string | null; blNumber: string | null; declarationNumbers: string[]; closingAt: string | null; plannedReturnAt: string | null; customsCutoffAt: string | null; operationalNotes: string | null };
  unitSummary: { label: string; containerNumber: string | null; containerTypeLabel: string | null; shippingLineName: string | null; pickupPortName: string | null; dropoffPortName: string | null; packageType: string | null; packageCount: number | null; cargoWeightKg: string | null; cargoVolumeCbm: string | null };
  plannedCarrier?: DispatchPlannedCarrier | null;
  accountingLock?: DispatchAccountingLock | null;
  dispatch: { tripId: number; tripVersion: number | null; tripCode: string | null; tripStatus: string | null; plannedStartAt: string | null; plannedEndAt: string | null; carrierType: 'OWN' | 'EXTERNAL' | null; truckId: number | null; truckPlate: string | null; trailerId: number | null; trailerPlate: string | null; driverId: number | null; driverName: string | null; externalCarrierId: number | null; externalCarrierName: string | null; externalPlateNumber: string | null; externalDriverName: string | null; externalDriverPhone: string | null } | null;
}

export interface DispatchFleet {
  trucks: CursorPaginatedResponse<DispatchTruck>;
  drivers: CursorPaginatedResponse<DispatchDriver>;
  externalCarriers: CursorPaginatedResponse<DispatchExternalCarrier>;
}

export interface DispatchHandoffItem {
  handoffId: number; version: number; status: 'UNSEEN' | 'SEEN'; shipmentId: number; shipmentVersion: number;
  urgency: 'NORMAL' | 'URGENT'; vehicleNeededBy: string | null; operationalNote: string | null; dispatchedAt: string;
  customer: { id: number; name: string };
  route: { id: number | null; name: string | null; distanceKm?: number | null; serviceDurationMinutes?: number | null };
  operationalSite: { id: number | null };
  pickupWarehouse: { id: number | null; name: string | null; address: string | null; googleMapsUrl: string | null; strictRules: string | null } | null;
  shipment: { code: string | null; bookingRef: string | null; blNumber: string | null; cargoMode: 'FCL' | 'LCL' | null; declarationNumbers: string[]; closingAt: string | null; plannedReturnAt: string | null; customsCutoffAt: string | null; operationalNotes: string | null };
  summary: { containerNumbers: string[]; lclLabel: string | null };
}

function queryString(values: Record<string, string | number | Array<string> | null | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
      return;
    }
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  return params.toString();
}

export function listDispatchQueue(filters: { cursor?: string | null; limit?: number; q?: string; urgency?: '' | 'NORMAL' | 'URGENT'; status?: Array<'READY' | 'DISPATCHED'>; date?: string }) {
  return api.get<CursorPaginatedResponse<DispatchQueueItem> & { readyCount: number; dispatchedCount: number }>(`/shipments/dispatch-queue?${queryString(filters)}`);
}

type DispatchResource = 'TRUCK' | 'DRIVER' | 'EXTERNAL_CARRIER';
type DispatchResourceItem<R extends DispatchResource> = R extends 'TRUCK'
  ? DispatchTruck
  : R extends 'DRIVER'
    ? DispatchDriver
    : DispatchExternalCarrier;

export type DispatchFleetResource = DispatchResource | 'EXTERNAL_VEHICLE';
type DispatchFleetResourceItem<R extends DispatchFleetResource> = R extends 'TRUCK'
  ? DispatchTruck
  : R extends 'DRIVER'
    ? DispatchDriver
    : R extends 'EXTERNAL_CARRIER'
      ? DispatchExternalCarrier
      : DispatchCarrierVehicle;

export function listDispatchFleetResources<R extends DispatchFleetResource>(
  resource: R,
  filters: { cursor?: string | null; limit?: number; q?: string; carrierId?: number | null } = {},
) {
  return api.get<CursorPaginatedResponse<DispatchFleetResourceItem<R>>>(`/shipments/dispatch-fleet?${queryString({ resource, ...filters })}`);
}

export async function getDispatchFleet(filters: { limit?: number } = {}): Promise<DispatchFleet> {
  const limit = filters.limit ?? 100;
  const [trucks, drivers, externalCarriers] = await Promise.all([
    listDispatchFleetResources('TRUCK', { limit }),
    listDispatchFleetResources('DRIVER', { limit }),
    listDispatchFleetResources('EXTERNAL_CARRIER', { limit }),
  ]);
  return { trucks, drivers, externalCarriers };
}

export function listDispatchHandoffs(filters: { cursor?: string | null; limit?: number; q?: string; urgency?: '' | 'NORMAL' | 'URGENT' }) {
  return api.get<CursorPaginatedResponse<DispatchHandoffItem> & { unseenCount: number; seenCount: number }>(`/shipments/dispatch-handoffs?${queryString(filters)}`);
}

export function listCarrierFleetVehicles(carrierId: number) {
  return api.get<{ items: DispatchCarrierVehicle[] }>(`/shipments/carrier-fleet-vehicles?carrierId=${carrierId}`);
}

export function createCarrierFleetVehicle(body: { carrierId: number; licensePlate: string }) {
  return api.post<DispatchCarrierVehicle>('/shipments/carrier-fleet-vehicles', body, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}

export function updateCarrierFleetVehicle(vehicleId: number, body: { isActive: boolean }) {
  return api.patch<DispatchCarrierVehicle>(`/shipments/carrier-fleet-vehicles/${vehicleId}`, body, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}

export function resolveDispatchHandoff(item: DispatchHandoffItem, resolution: 'SEEN' | 'ACCEPTED' | 'REJECTED') {
  return api.post<{ handoff: { id: number; status: string; version: number }; fulfillments?: DispatchQueueItem[]; replayed?: boolean }>(
    `/shipments/${item.shipmentId}/dispatch-handoffs/${item.handoffId}/resolve`,
    { resolution, expectedVersion: item.version },
    { headers: { 'Idempotency-Key': crypto.randomUUID() } },
  );
}

export function issueDispatchOrder(item: DispatchQueueItem, body: {
  plannedStartAt: string; plannedEndAt: string; endTimeConfirmed: boolean;
  carrierType: 'OWN' | 'EXTERNAL'; truckId?: number | null; driverId?: number | null; trailerId?: number | null;
  pricingRateKey?: string | null;
  externalCarrierId?: number | null; externalCarrierVehicleId?: number | null; externalPlateNumber?: string | null; externalDriverName?: string | null; externalDriverPhone?: string | null;
}) {
  return api.post<{ fulfillmentId: number; version: number; trip: { id: number; tripCode: string; status: 'CREATED' }; notification: { deliveredInApp: true; pushAttempted: boolean }; replayed: boolean }>(
    `/shipments/${item.shipmentId}/dispatch`,
    { fulfillmentId: item.fulfillmentId, expectedVersion: item.fulfillmentVersion, ...body },
    { headers: { 'Idempotency-Key': crypto.randomUUID() } },
  );
}
