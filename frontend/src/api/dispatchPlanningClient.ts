import { api } from '../lib/api';
import { SHIPMENTS } from '@tingting/shared';
import type { CursorPaginatedResponse, PaginatedResponse, DispatchClassification, TruckSuggestion } from '@tingting/shared';

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
  /** Owning nhà xe when the truck is a subcontracted tractor linked on the
   *  fleet page; null = xe nhà (own fleet). Only ACTIVE carrier links ride
   *  the wire — a LOCKED carrier reads as unlinked. */
  carrierId: number | null;
  carrierName: string | null;
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

function queryString(values: Record<string, string | number | boolean | Array<string> | null | undefined>) {
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
  filters: { cursor?: string | null; limit?: number; q?: string; carrierId?: number | null; fulfillmentId?: number } = {},
) {
  return api.get<
    CursorPaginatedResponse<DispatchFleetResourceItem<R>>
    // Advisory LH D-1/D+1 truck suggestions (TRUCK + fulfillmentId only) — ranking, never eligibility.
    & { suggestedItems?: TruckSuggestion[] }
  >(`/shipments/dispatch-fleet?${queryString({ resource, ...filters })}`);
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

/** Card 101026043010 — quick-add an own-fleet tractor from the dispatch
 *  editor's INTERNAL plate picker, through the SAME API the fleet-catalog
 *  create uses (POST /api/trucks → an ACTIVE truck row, selectable in the
 *  picker's own-fleet list). */
export function createInternalTruck(body: { licensePlate: string }) {
  return api.post<Pick<DispatchTruck, 'id' | 'licensePlate'>>('/trucks', body);
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

// ─── Dispatch detail plan grid ("Kế hoạch Chi tiết Xe") ─────────────────────

/** FB-092 — LCL row facts: the lot's own cargo + its cost-group identity. */
export interface LclRowFacts {
  packageCount: number | null;
  packageType: string | null;
  cargoVolumeCbm: string | null;
  group: {
    groupId: string;
    order: number | null;
    memberCount: number | null;
    actualTruckNo: string | null;
    billingTruckNo: string | null;
    vehicleClassCode: string | null;
    vehicleClassName: string | null;
  } | null;
}

/**
 * FB-092 — assign one truck to the selected LCL lots (cost group).
 *
 * Spec 23/10 (261023110000 §3): the ĐV assign carries EXACTLY the 4 cost-side
 * fields — BKS báo khách ("xe ảo") is a CUS output and never rides this call
 * (the server strips unknown keys; the type drops them so the ĐV flow cannot
 * even construct them).
 */
export async function assignLclCostGroup(input: {
  shipmentIds: number[];
  vehicleSizeClassId: number;
  actualTruckNo: string;
  /** 161026232309 — the group's nhà xe (customers.isCarrier). */
  carrierId?: number;
  /** 161026232309 — OWN = Đội xe nội bộ SilverSea (container classes). */
  carrierType?: 'OWN' | 'EXTERNAL';
  /** 161026232319 — Điều vận nhập tay cước trả ĐV của Lô 1 (VND). */
  freightCost?: number;
}) {
  return api.post<{ groupId: string; memberCount: number; members: Array<{ shipmentId: number; order: number; reference: string }> }>(
    SHIPMENTS.LCL_COST_GROUP,
    input,
  );
}

/**
 * FB-093 — merge the selected same-customer LCL lots into one bill (rev
 * group). Spec 23/10 §4.2: the ACTIVE merge law is Lô 1 = 100% cước thu,
 * members 2..N = 0₫; `freightRevenue` (optional) is the manual "Cước thu
 * khách Lô 1" override — omitted ⇒ auto-trace bảng giá thu khách.
 */
export async function mergeLclRevGroup(input: {
  shipmentIds: number[];
  vehicleSizeClassId: number;
  billingTruckNo?: string;
  /** Spec 23/10 §4.2 — "Cước thu khách Lô 1 (đ) – nhập tay" (VND). */
  freightRevenue?: number;
}) {
  return api.post<{ groupId: string; memberCount: number; members: Array<{ shipmentId: number; order: number; reference: string }> }>(
    SHIPMENTS.LCL_REV_GROUP,
    input,
  );
}

/** FB-093 — quick-edit a lot's (or its cost group's) BKS pair.
 * FB-141: `billingTruckNo: null` (hoặc '') clears the CUS output — the lot
 * falls back to reporting the ĐV-assigned BKS thực. */
export async function updateLclTruck(input: { shipmentId: number; actualTruckNo?: string; billingTruckNo?: string | null }) {
  return api.post<{ updatedShipmentIds: number[] }>(SHIPMENTS.LCL_TRUCK, input);
}

/**
 * 161026232349 (§II.3.2 "Thu riêng từng lô") + spec 23/10 §4.1 — CUS per-lot
 * outputs of ONE ungrouped LCL lot: Loại xe thu khách and/or Giá cước thu
 * nhập tay. The lot's CƯỚC VẬN TẢI (AUTO) jumps to the class' lane price
 * unless `freightRevenue` overrides it; `freightAuto` comes back null (never
 * 0) when the lane has no price row — the class still saves.
 */
export async function setLclLotRevClass(input: { shipmentId: number; vehicleSizeClassId?: number; freightRevenue?: number }) {
  return api.post<{
    shipmentId: number;
    reference: string;
    vehicleSizeClassId: number;
    vehicleClassCode: string;
    freightAuto: string | null;
    channel: 'TRIP' | 'SNAPSHOT' | 'NONE';
    reason: string | null;
  }>('/shipments/lcl/rev-class', input);
}
/** FB-095 — un-merge one lot from a group dimension. */
export async function unmergeLclLot(input: { shipmentId: number; dimension: 'COST' | 'REV' }) {
  return api.post<{
    dimension: 'COST' | 'REV';
    groupId: string;
    leaver: { shipmentId: number; order: number; reference: string };
    promoted: { shipmentId: number; order: number; reference: string } | null;
    transferredAmount: string | null;
    remaining: Array<{ shipmentId: number; order: number; reference: string }>;
    dissolved: boolean;
  }>(SHIPMENTS.LCL_UNMERGE, input);
}

/** FB-095 — un-merge / dissolve an entire LCL group. */
export async function unmergeLclGroup(input: { groupId: string; dimension: 'COST' | 'REV' }) {
  return api.post<{
    dimension: 'COST' | 'REV';
    groupId: string;
    memberCount: number;
    members: Array<{ shipmentId: number; order: number; reference: string }>;
    dissolved: true;
    /**
     * FB-145 — the dissolved REV group's loại xe (vehicle_size_classes.id,
     * captured before the unmerge clears it off the lots) so the FE toast's
     * [Hoàn tác] can re-merge with the same class. Null for COST and for
     * legacy class-less groups.
     */
    vehicleClassId: number | null;
  }>(SHIPMENTS.LCL_UNMERGE_GROUP, input);
}

export interface DispatchDetailPlanRow {
  fulfillmentId: number;
  version: number;
  shipmentId: number;
  shipmentVersion: number;
  shipmentContainerId?: number | null; // decompose target (branch rows)
  shipmentCode: string | null;
  isCombined: boolean;
  fulfillmentType: 'FCL_CONTAINER' | 'LCL_SHIPMENT';
  cargoMode: 'FCL' | 'LCL';
  taskStatus: 'READY' | 'DISPATCHED' | 'COMPLETED';
  /** Full run timestamp (appointment → closing → planned return) —
   * minutes-preserving display + chronological sort. Optional for older
   * fixtures; runHour stays for the issue-order dialog. */
  time: { deliveryDate: string | null; runAt?: string | null; runHour: number | null };
  customerRoute: { customerName: string; factoryName: string | null; deliveryPoint: string | null; routeName?: string | null };
  docs: { billNumber: string | null; tradeDirection: 'IMPORT' | 'EXPORT' | null; declarationNumbers: string[] };
  container: { containerNumber: string | null; containerTypeLabel: string | null; cargoWeightKg: string | null; declarationNumber?: string | null };
  /** FB-092 LCL facts — the lot's own cargo for the CONTAINER cell's 2nd/3rd
   *  lines and its cost-group tag/truck identity. Absent on older fixtures
   *  and on FCL rows. */
  lcl?: LclRowFacts | null;
  /** FB-105 §3 LCL lift/drop inputs — an LCL lot owns no container, so its
   *  Nâng/Trả columns resolve from these instead of `ports` (which stay the FCL
   *  container port pair): the frozen "Kho (CFS/Cảng)" intake site plus the
   *  lot's stored free-text lift/drop points, which back a side whose catalog
   *  site was never picked. Optional for older wire shapes; FCL rows do not
   *  read it. */
  liftDrop?: {
    warehouseName: string | null;
    liftFallback: string | null;
    dropFallback: string | null;
  } | null;
  notes: { vehicleNote: string | null; customerNote: string | null; opsRecoveryNotes?: string[] };
  dispatch: {
    /** Present once the dispatch order has created a live trip. */
    tripId?: number | null;
    /** True once the trip's driver acknowledged the order (ORDER_RECEIVED
     *  milestone) — locks reassignment. Optional for older fixtures. */
    driverAccepted?: boolean;
    tripStatus?: string | null;
    /** Null on carrier-less planned rows — no carrier chosen yet (8afc13a9). */
    carrierType: 'OWN' | 'EXTERNAL' | null;
    carrierName: string | null;
    externalCarrierId: number | null;
    externalCarrierVehicleId: number | null;
    assignedPlate: string | null;
    /** Trip driver once issued, otherwise current OWN truck assignment. */
    assignedDriverName?: string | null;
    /** FB-036 (card 201026135900): driver SĐT on the same branch as the name —
     *  trip driver (or external contact) once issued, else roster driver of
     *  the planned plate. */
    assignedDriverPhone?: string | null;
    pairKind?: 'KEP' | 'KET_HOP' | null;
  };
  estimates: { plannedRevenue: string | null; plannedCarrierCost: string | null };
  /** Giờ trả hàng — staged pre-issuance on the fulfillment; null until set. */
  plannedEndAt: string | null;
  // NOT NULL DEFAULT 'SINGLE' (mig 0028): every row carries a value — fresh
  // containers start as "Đơn" until dispatch reclassifies them.
  classification: DispatchClassification;
  ports: { pickupPortId: number | null; pickupPortName: string | null; pickupPortShortName: string | null; dropoffPortId: number | null; dropoffPortName: string | null; dropoffPortShortName: string | null };
  lotFullyPlated: boolean;
}

export interface DispatchDetailPlanFilters {
  q?: string;
  date?: string;
  /** Inclusive transport-date range — the topbar month scope (20260922_32). */
  dateFrom?: string;
  dateTo?: string;
  direction?: 'IMPORT' | 'EXPORT' | '';
  assignmentStatus?: 'UNASSIGNED' | 'ASSIGNED' | '';
  pickupIds?: number[];
  dropoffIds?: number[];
  deliveryPointIds?: number[];
  hourFrom?: string;
  hourTo?: string;
  /** Zone code from the DB taxonomy (GET /dispatch-zones). */
  zone?: string;
  customerId?: number | null; dataStatus?: 'COMPLETE' | 'MISSING' | ''; // card _50 ribbon
  /** Card 171026154000: lot cargo mode (Loại hàng) — LCL/FCL scope. */
  cargoMode?: 'FCL' | 'LCL' | '';
}

/** Chip counts of the detail plan grid (card 20261008_3) — full-set over the
 *  UNION of both row branches (fulfillment + điều phối), every other filter
 *  held. UNASSIGNED includes the inherently-unassigned điều phối branch;
 *  ASSIGNED counts fulfillment rows with a planned plate. `UNASSIGNED +
 *  ASSIGNED` partitions `total`. */
export interface DispatchDetailPlanAssignmentCounts {
  UNASSIGNED: number;
  ASSIGNED: number;
}

/** One page of the detail plan grid — the rows plus the chips' union counts. */
export interface DispatchDetailPlanPage extends PaginatedResponse<DispatchDetailPlanRow> {
  assignmentStatusCounts: DispatchDetailPlanAssignmentCounts;
}

export function listDispatchDetailPlanRows(filters: { page?: number; limit?: number } & DispatchDetailPlanFilters = {}) {
  return api.get<DispatchDetailPlanPage>(
    `/shipments/dispatch-detail-plan-rows?${queryString(filters as Record<string, string | number | Array<string> | boolean | null | undefined>)}`,
  );
}

// ─── Zone truck presence (detail plan advisory panel) ────────────────────────

export interface ZoneTruckPresenceEvidence {
  reason: 'D-1_DROP' | 'D+1_PICKUP';
  date: string;
  containerNumber: string | null;
  portName: string;
}

export interface ZoneTruckPresenceItem {
  truckId: number;
  plateNumber: string;
  evidence: ZoneTruckPresenceEvidence[];
}

export function listZoneTruckPresence(filters: { zone: string; date?: string }) {
  return api.get<{ date: string; zone: string; zoneLabel: string; items: ZoneTruckPresenceItem[] }>(
    `/shipments/dispatch-zone-truck-presence?${queryString(filters)}`,
  );
}

export function listDispatchDeliveryPointFacets(filters: { q?: string } = {}) {
  return api.get<{ items: Array<{ id: number; name: string }> }>(
    `/shipments/dispatch-delivery-point-facets?${queryString(filters)}`,
  );
}

export function listDispatchPickupPortFacets(filters: { q?: string } = {}) {
  return api.get<{ items: Array<{ id: number; name: string }> }>(
    `/shipments/dispatch-pickup-port-facets?${queryString(filters)}`,
  );
}

export function listDispatchDropoffPortFacets(filters: { q?: string } = {}) {
  return api.get<{ items: Array<{ id: number; name: string }> }>(
    `/shipments/dispatch-dropoff-port-facets?${queryString(filters)}`,
  );
}

export function reassignTruckDriver(truckId: number, driverId: number | null) {
  return api.patch<{ truckId: number; driverId: number | null; previousDriverId: number | null }>(
    `/shipments/dispatch-fleet/trucks/${truckId}/assigned-driver`,
    { driverId },
  );
}

export function assignDispatchDetailPlate(fulfillmentId: number, body: {
  expectedVersion: number;
  truckId?: number | null;
  externalCarrierVehicleId?: number | null;
  plateNumber?: string | null;
  clear?: boolean;
}) {
  return api.patch<{
    fulfillmentId: number;
    version: number;
    lotFullyPlated: boolean;
    driverNotified: boolean;
    assignedPlate: string | null;
    assignedDriverId: number | null;
    assignedDriverName: string | null;
    assignedDriverPhone: string | null;
    driverHint: string | null;
  }>(`/shipments/dispatch-detail-plan-rows/${fulfillmentId}/plate`, body, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}

export function assignDispatchDetailCarrier(fulfillmentId: number, body: {
  expectedVersion: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId?: number | null;
}) {
  return api.patch<{
    fulfillmentId: number;
    version: number;
    carrierType: 'OWN' | 'EXTERNAL';
    externalCarrierId: number | null;
    carrierName: string;
    externalCarrierVehicleId: null;
    assignedPlate: null;
    lotFullyPlated: boolean;
  }>(`/shipments/dispatch-detail-plan-rows/${fulfillmentId}/carrier`, body, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}

export function updateDispatchDetailEstimates(fulfillmentId: number, body: {
  expectedVersion: number;
  plannedRevenue: number | null;
  plannedCarrierCost: number | null;
}) {
  return api.patch<{
    fulfillmentId: number;
    version: number;
    plannedRevenue: string | null;
    plannedCarrierCost: string | null;
  }>(`/shipments/dispatch-detail-plan-rows/${fulfillmentId}/estimates`, body, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}

// One atomic save for the whole editor: carrier + vehicle + estimates +
// classification + isCombined (and the driver note) guarded by both row
// versions.
export function updateDispatchDetailPlan(fulfillmentId: number, body: {
  expectedFulfillmentVersion: number;
  expectedShipmentVersion: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId?: number | null;
  truckId?: number | null;
  externalCarrierVehicleId?: number | null;
  plateNumber?: string | null;
  clearVehicle?: boolean;
  plannedRevenue: number | null;
  plannedCarrierCost: number | null;
  /** Giờ trả hàng — omit to leave stored value untouched, null to clear, zone-aware ISO to set. */
  plannedEndAt?: string | null;
  /** Phân loại (Đơn/Kẹp/Kết hợp) — dispatcher's call; optional so CUS-derived values stay valid. */
  classification?: DispatchClassification;
  isCombined?: boolean;
  operationalNotes?: string | null;
  /** dis-03 (card 211026131857): the kẹp-candidate overlap warn was confirmed
   *  in the dialog — the confirmed retry rides the flag, exactly like the
   *  issue path's rigOverlapCompletedConfirmed. */
  rigOverlapCompletedConfirmed?: boolean;
}) {
  return api.patch<{
    fulfillmentId: number;
    fulfillmentVersion: number;
    shipmentId: number;
    shipmentVersion: number;
    classification: DispatchClassification;
    isCombined: boolean;
    operationalNotes: string | null;
    plannedEndAt: string | null;
    dispatch: {
      carrierType: 'OWN' | 'EXTERNAL';
      carrierName: string | null;
      externalCarrierId: number | null;
      externalCarrierVehicleId: number | null;
      assignedPlate: string | null;
      assignedDriverName?: string | null;
      assignedDriverPhone?: string | null;
    };
    estimates: { plannedRevenue: string | null; plannedCarrierCost: string | null };
    lotFullyPlated: boolean;
    driverNotified: boolean;
    driverHint: string | null;
    replayed: boolean;
  }>(`/shipments/dispatch-detail-plan-rows/${fulfillmentId}/plan`, body, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}

// ─── Dispatch task tags (note-composer pool) ─────────────────────────────────

/** Điều vận/CUS completes an external-carrier trip on the driver's behalf —
 *  external carriers don't use the app, so the grid is the only surface that
 *  can close their trips (trips complete-external, feedback 2026-09-08). */
export function completeDispatchExternalTrip(tripId: number) {
  return api.post<{
    tripId: number;
    tripCode: string | null;
    fulfillmentId: number | null;
    status: string;
    version: number;
    completedAt: string | null;
    replayed: boolean;
  }>(`/trips/${tripId}/complete-external`, {}, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}

export interface DispatchTaskTag {
  id: number;
  label: string;
  displayOrder?: number | null;
}

export function listDispatchTaskTags() {
  return api.get<{ items: DispatchTaskTag[] }>('/shipments/dispatch-task-tags');
}

export function createDispatchTaskTag(label: string) {
  return api.post<{ id: number; label: string }>('/shipments/dispatch-task-tags', { label });
}

export function updateDispatchTaskTag(id: number, label: string) {
  return api.patch<{ id: number; label: string }>(`/shipments/dispatch-task-tags/${id}`, { label });
}

export function deactivateDispatchTaskTag(id: number) {
  return api.delete<{ ok: true }>(`/shipments/dispatch-task-tags/${id}`);
}
