// Shipment API client — frontend transport layer for `/api/shipments/*`.
//
// Mirrors the `tripClient.ts` / `configClient.ts` pattern: thin helpers over
// the shared `api` fetch wrapper, with response shapes typed for the
// consuming hooks/pages. Today this covers the M10.1 clerk quick-create
// surface; later clerk/shipment operations (M10.2 doc entry, M10.3 handoff)
// grow this file.

import {
  SHIPMENTS,
  ShipmentStatus,
  TripPodFileType,
  TripPodStatus,
  type ShipmentCusWorkspaceDetail,
  type ShipmentCusWorkspaceListResponse,
  type ShipmentCusContainerFlatResponse,
  type ShipmentCusFinanceConfirmationCreateInput,
  type ShipmentCusDocumentCustodyUpdateInput,
  type ShipmentCusLockInput,
  type ShipmentCusReopenRequestInput,
  type ShipmentCusContainerLineUpdateInput,
  type ShipmentCusContainerLineUpdateResult,
  type ShipmentCusContainerSortKey,
  type ShipmentCusWorkspaceSortKey,
  type ShipmentAccountingLockSummary,
} from '@tingting/shared';
import { api } from '../lib/api';

export interface ShipmentPricingBreakdownLine {
  label: string;
  quantity: number;
  amount: number;
  formula: string;
}

export interface ShipmentPricingProjection {
  readiness: 'READY' | 'MISSING_INPUT' | 'MISSING_AUTHORITY';
  message: string;
  freightPrice: number | null;
  freightSource: 'TIER' | 'TABLE' | 'MANUAL' | null;
  freightFormula: string | null;
  expectedFuelSurcharge: number | null;
  expectedFuelLiters: number | null;
  estimationDate: string | null;
  breakdown: ShipmentPricingBreakdownLine[];
}

export interface ShipmentCarrierAllocationGroup {
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  carrierName?: string | null;
  count20: number;
  count40: number;
  appointmentDate?: string | null;
}

export type ShipmentAccountingLock = ShipmentAccountingLockSummary;

/** Row shape returned by `/api/shipments/quick` and `/api/shipments/:id`. */
export interface Shipment {
  id: number;
  shipmentCode: string | null;
  version: number;
  customerId: number;
  routeId?: number | null;
  responsibleUnitId: number | null;
  status: ShipmentStatus;
  bookingRef: string | null;
  blNumber: string | null;
  expectedDeliveryDate: string | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  contactName: string | null;
  contactPhone: string | null;
  tradeDirection?: 'IMPORT' | 'EXPORT' | null;
  cargoMode?: 'FCL' | 'LCL' | null;
  operationalSiteId?: number | null;
  pickupWarehouseSiteId?: number | null;
  factoryName?: string | null;
  shippingLineName?: string | null;
  customsCutoffAt?: string | null;
  closingAt?: string | null;
  plannedReturnAt?: string | null;
  cargoWeightKg?: string | null;
  cargoVolumeCbm?: string | null;
  packageCount?: number | null;
  packageType?: string | null;
  operationalNotes?: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  pricingProjection?: ShipmentPricingProjection | null;
  carrierAllocationSummary?: ShipmentCarrierAllocationGroup[] | null;
  accountingLock?: ShipmentAccountingLock | null;
}

export interface ShipmentDispatchHandoff {
  id: number;
  shipmentId: number;
  status: 'UNSEEN' | 'SEEN' | 'ACCEPTED' | 'REJECTED';
}

/** Body for `POST /api/shipments/quick` — matches `quickCreateShipmentSchema`. */
export interface QuickCreateShipmentRequest {
  /** Null for ad-hoc orders (Lệnh chạy ngoài) — rawCustomerName carries the text. */
  customerId?: number | null;
  isAdHoc?: boolean;
  rawCustomerName?: string | null;
  rawRouteName?: string | null;
  routeId?: number | null;
  cargoTypeId?: number | null;
  responsibleUnitId?: number | null;
  bookingRef?: string | null;
  blNumber?: string | null;
  expectedDeliveryDate?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  tradeDirection?: 'IMPORT' | 'EXPORT' | null;
  cargoMode?: 'FCL' | 'LCL' | null;
  operationalSiteId?: number | null;
  pickupWarehouseSiteId?: number | null;
  factoryName?: string | null;
  shippingLineName?: string | null;
  customsCutoffAt?: string | null;
  closingAt?: string | null;
  plannedReturnAt?: string | null;
  cargoWeightKg?: string | number | null;
  cargoVolumeCbm?: string | number | null;
  packageCount?: number | null;
  packageType?: string | null;
  driverNotes?: string | null;
  /** @deprecated Use driverNotes for shipment write requests. */
  operationalNotes?: string | null;
  customerNotes?: string | null;
}

export interface ShipmentPricingPreviewRequest {
  customerId: number;
  routeId?: number | null;
  cargoMode?: 'FCL' | 'LCL' | null;
  cargoTypeId?: number | null;
  expectedDeliveryDate?: string | null;
  cargoWeightKg?: string | number | null;
  containerCount?: number | null;
  containerTypeIds?: number[];
}

/**
 * Quick-create a shipment (M10.1). The `idempotencyKey` is sent in the
 * `Idempotency-Key` header so a flaky-network resubmit returns the original
 * shipment instead of creating a duplicate (PRD M10-01-03, Q23 proposal).
 *
 * Caller is responsible for generating a fresh UUID v4 per form submission
 * attempt and reusing the SAME key for any retry of that attempt (e.g. when
 * the offline-queue lib lands and replays a queued request). The server
 * returns 201 on first create and 200 on an idempotent replay — both are
 * success states for the UI.
 */
export async function quickCreateShipment(
  body: QuickCreateShipmentRequest,
  idempotencyKey: string,
): Promise<Shipment> {
  return api.post<Shipment>('/shipments/quick', body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function getShipmentPricingPreview(
  body: ShipmentPricingPreviewRequest,
): Promise<ShipmentPricingProjection> {
  return api.post<ShipmentPricingProjection>('/shipments/pricing-preview', body);
}

// ─── M10.2 slice 3 — clerk doc-entry surface ────────────────────────────────
//
// The doc-entry page edits an existing DRAFT shipment's BL number + container
// set and (for MANAGER/ADMIN) dispatches it. Container numbers are validated
// server-side via ISO 6346 + duplicate-within-shipment checks (slice 1); the
// dispatch response carries `preDispatchWarnings` (slice 2) shown in a confirm
// dialog before the operator commits.

/** Container row on a shipment detail payload. */
export interface ShipmentContainer {
  id: number;
  shipmentId: number;
  containerTypeId: number | null;
  containerTypeCode?: string | null;
  containerTypeName?: string | null;
  containerNumber: string | null;
  sealNumber: string | null;
  cargoWeightKg: string | null;
  cargoVolumeCbm?: string | null;
  shippingLineName?: string | null;
  customerAppointmentAt?: string | null;
  pickupPortId?: number | null;
  dropoffPortId?: number | null;
  plannedCarrierType?: 'OWN' | 'EXTERNAL' | null;
  plannedExternalCarrierId?: number | null;
  plannedCarrierName?: string | null;
  plannedVehiclePlate?: string | null;
  /** Kind of the ACTIVE trip pair (Kẹp/Kết hợp) on this container's live trip — tag source. */
  pairKind?: 'KEP' | 'KET_HOP' | null;
  notes: string | null;
}

export interface OperationalSite {
  id: number;
  customerId: number;
  code: string;
  name: string;
  shortName?: string;
  siteType: 'FACTORY' | 'WAREHOUSE';
  routeId: number | null;
  address: string;
  googleMapsUrl: string | null;
  contactName: string | null;
  contactPhone: string | null;
  warehouseContactInfo: string | null;
  liftInfo: string | null;
  dropInfo: string | null;
  cleaningInfo: string | null;
  liftFeeInvoiceName: string | null;
  liftFeeInvoiceAddress: string | null;
  liftFeeTaxCode: string | null;
  strictRules: string | null;
  version: number;
}

/** Full detail payload returned by `GET /api/shipments/:id`. */
export interface ShipmentDetail {
  shipment: Shipment & {
    customerName: string | null;
    /** Factory display label resolved through `operational_sites` catalog
     *  when `factoryName` / shipment-level `operationalSiteId` are empty.
     *  Falls back to per-container `operationalSiteId` lookup. Mirrors the
     *  cus-workspace `effectiveFactoryNames` priority so the detail header
     *  agrees with the dashboard list (regression bug 2026-09-07). */
    effectiveFactoryName: string | null;
  };
  containers: ShipmentContainer[];
  documents: ShipmentDocument[];
  declarations: ShipmentDeclaration[];
  statusHistory: ShipmentStatusHistoryEntry[];
  pendingChangeRequests: ShipmentChangeRequest[];
  podReviews: ShipmentPodReviewItem[];
  carrierAssignments: Array<{
    fulfillmentId: number;
    fulfillmentVersion: number;
    shipmentContainerId: number | null;
    containerTypeCode: string | null;
    containerTypeName: string | null;
    carrierType: 'OWN' | 'EXTERNAL' | null;
    externalCarrierId: number | null;
    externalCarrierName: string | null;
  }>;
  accountingLock: ShipmentAccountingLock | null;
}

export interface ShipmentPodReviewFile {
  id: number;
  fileType: TripPodFileType;
  label: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
}

export interface ShipmentPodSubmission {
  id: number;
  tripId: number;
  fulfillmentId: number;
  submissionVersion: number;
  status: TripPodStatus;
  version: number;
  createdAt: string;
  submittedAt: string | null;
  submittedBy: number | null;
  reviewedAt: string | null;
  reviewedBy: number | null;
  rejectionReason: string | null;
  supersedesSubmissionId: number | null;
  sourceTripVersion: number;
  missingRequiredFileTypes: TripPodFileType[];
  isReadyForReview: boolean;
  files: ShipmentPodReviewFile[];
}

export interface ShipmentPodReviewItem {
  fulfillmentId: number;
  fulfillmentVersion: number;
  shipmentId: number;
  fulfillmentType: 'FCL_CONTAINER' | 'LCL_SHIPMENT';
  cargoMode: 'FCL' | 'LCL';
  shipmentContainerId: number | null;
  containerNumber: string | null;
  canceledAt: string | null;
  cancellationDisposition: 'REPLACED' | 'NOT_REQUIRED' | null;
  replacementFulfillmentId: number | null;
  notRequiredReason: string | null;
  required: boolean;
  tripId: number | null;
  tripCode: string | null;
  tripStatus: ShipmentStatus | 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELED' | null;
  tripVersion: number | null;
  driverName: string | null;
  currentSubmission: ShipmentPodSubmission | null;
  history: ShipmentPodSubmission[];
}

/** Body for `PUT /api/shipments/:id` — version is required (optimistic lock). */
export interface UpdateShipmentRequest {
  expectedVersion: number;
  customerId?: number | null;
  isAdHoc?: boolean;
  rawCustomerName?: string | null;
  rawRouteName?: string | null;
  routeId?: number | null;
  responsibleUnitId?: number | null;
  blNumber?: string | null;
  bookingRef?: string | null;
  expectedDeliveryDate?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  tradeDirection?: 'IMPORT' | 'EXPORT' | null;
  cargoMode?: 'FCL' | 'LCL' | null;
  operationalSiteId?: number | null;
  pickupWarehouseSiteId?: number | null;
  factoryName?: string | null;
  shippingLineName?: string | null;
  customsCutoffAt?: string | null;
  closingAt?: string | null;
  plannedReturnAt?: string | null;
  cargoWeightKg?: string | number | null;
  cargoVolumeCbm?: string | number | null;
  packageCount?: number | null;
  packageType?: string | null;
  driverNotes?: string | null;
  /** @deprecated Use driverNotes for shipment write requests. */
  operationalNotes?: string | null;
  customerNotes?: string | null;
}

/** Body for `PUT /api/shipments/:id/containers` (full reconcile). */
export interface ShipmentContainerBatch {
  expectedVersion: number;
  carrierAllocations?: ShipmentCarrierAllocationGroup[];
  containers: Array<{
    id?: number;
    containerTypeId?: number | null;
    containerNumber?: string | null;
    sealNumber?: string | null;
    cargoWeightKg?: string | number | null;
    cargoVolumeCbm?: string | number | null;
    shippingLineName?: string | null;
    /** FCL route authority. Omitted updates preserve a pre-existing value. */
    routeId?: number | null;
    customerAppointmentAt?: string | null;
    pickupPortId?: number | null;
    dropoffPortId?: number | null;
    /** Per-container factory authority (SILVER L1). Omitted (never nulled)
     *  by surfaces that don't manage it, so the reconcile preserves it. */
    operationalSiteId?: number | null;
    notes?: string | null;
  }>;
}

/** Response shape from `PUT /api/shipments/:id/containers`. */
export interface ShipmentContainerBatchResponse {
  items: ShipmentContainer[];
  upsertedIds: number[];
  shipmentVersion: number;
  changeMode: 'DIRECT' | 'REQUESTED' | 'NOOP';
  changeRequestId: number | null;
  message?: string;
  notificationDelivered?: boolean;
}

export interface ShipmentCarrierAllocationAssignment {
  fulfillmentId: number;
  shipmentContainerId: number | null;
  plannedCarrierType: 'OWN' | 'EXTERNAL' | null;
  plannedExternalCarrierId: number | null;
  version: number;
}

export interface ShipmentCarrierAllocationResponse {
  shipment: Shipment;
  assignments: ShipmentCarrierAllocationAssignment[];
}

export interface ShipmentUpdateResponse extends Shipment {
  changeMode: 'DIRECT' | 'REQUESTED' | 'NOOP';
  changeRequestId: number | null;
  message?: string;
  notificationDelivered?: boolean;
}

export interface ShipmentDocument {
  id: number;
  shipmentId: number;
  type: 'BOOKING' | 'BL' | 'DO' | 'DECLARATION' | 'OTHER' | null;
  storageKey: string;
  uploadedBy: number | null;
  expiresAt: string | null;
  replacedBy: number | null;
  createdAt: string;
}

export interface ShipmentDeclaration {
  id: number;
  shipmentId: number;
  declarationNumber: string | null;
  issuedAt: string | null;
  scope: 'SINGLE' | 'SHARED' | null;
  note: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentStatusHistoryEntry {
  id: number;
  shipmentId: number;
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  reason: string | null;
  changedBy: number | null;
  changedAt: string;
}

export interface ShipmentChangeRequest {
  id: number;
  shipmentId: number;
  sourceVersion: number;
  requestKind: 'PLAN_UPDATE' | 'CONTAINER_RECONCILE';
  requestedBy: number;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  createdAt: string;
  requester: {
    id: number;
    fullName: string | null;
    username: string | null;
  } | null;
}

export interface ShipmentDeclarationRequest {
  declarationNumber?: string | null;
  issuedAt?: string | null;
  scope?: 'SINGLE' | 'SHARED';
  note?: string | null;
}

export interface ShipmentDocumentRequest {
  type: 'BOOKING' | 'BL' | 'DO' | 'DECLARATION' | 'OTHER';
  storageKey: string;
}

export interface ShipmentDocumentReplacementRequest {
  expectedVersion: number;
  storageKey: string;
  expiresAt?: string | null;
}

export interface ShipmentDocumentReplacementResponse extends ShipmentDocument {
  shipmentVersion: number;
}

export interface ReviewShipmentPodRequest {
  expectedVersion: number;
  resolution: 'ACCEPT' | 'REJECT';
  rejectionReason?: string | null;
  /** O2C C1: required when ACCEPT — confirms paper POD is in hand. */
  podRecovered?: boolean;
}

export interface ReviewShipmentPodResponse {
  shipment: Shipment;
  submissionId: number;
  submissionStatus: TripPodStatus;
  tripId: number;
  tripStatus: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELED';
  shipmentVersion: number;
  replayed: boolean;
}

export interface CompleteShipmentRequest {
  expectedVersion: number;
  vatRate: 0 | 0.05 | 0.08 | 0.1;
  confirmZeroRevenue: boolean;
  trips: Array<{
    tripId: number;
    expectedVersion: number;
  }>;
}

export interface CompleteShipmentResponse {
  shipment: Pick<Shipment, 'id' | 'shipmentCode' | 'status' | 'version'>;
  completedTripIds: number[];
  vatRate: CompleteShipmentRequest['vatRate'];
  replayed: boolean;
}

export interface CancelShipmentFulfillmentRequest {
  expectedVersion: number;
  disposition: 'REPLACED' | 'NOT_REQUIRED';
  reason: string;
}

export interface CancelShipmentFulfillmentResponse {
  shipment: Shipment;
  fulfillmentId: number;
  replacementFulfillmentId: number | null;
  shipmentVersion: number;
  replayed: boolean;
}

export interface ShipmentChangeRequestReviewResponse {
  shipment: Shipment;
  resolution: 'APPLIED' | 'REJECTED';
  changeRequestId: number;
  shipmentVersion: number;
  notificationDelivered: boolean;
  message: string;
}

/** Dispatch master-plan: how much of the container demand has a planned carrier. */
export type ShipmentAllocationStatus = 'NOT_ALLOCATED' | 'PARTIALLY_ALLOCATED' | 'FULLY_ALLOCATED';

/** Per-carrier 20'/40' planned allocation counts (dispatch master-plan chips). */
export interface ShipmentCarrierAllocationSummaryEntry {
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  carrierLabel: string;
  count20: number;
  count40: number;
}

export interface ShipmentListItem extends Shipment {
  customerName: string | null;
  /** Route operational name (short-name authority) for the master-plan
   *  primary line; null when the shipment has no route. */
  routeName?: string | null;
  /** All effective factory labels of the lot (container-site authority first,
   *  shipment-site fallback) — master plan lists every factory. */
  factoryNames?: string[];
  /** Factory operating notes ("Ghi chú nhà máy") for the notes column. */
  factoryNotes?: string | null;
  /** Containers without a đóng/trả appointment; badge shows "Còn X/Y cont chưa chốt ngày đóng trả" when X > 0. */
  containersMissingAppointment?: number;
  containerTotal?: number;
  containerCount20: number;
  containerCount40: number;
  /** e.g. "2 x 40HC + 1 x 20DC" */
  containerTypeSummary: string | null;
  totalCargoWeightKg: number | null;
  allocationStatus: ShipmentAllocationStatus;
  carrierAllocationSummary: ShipmentCarrierAllocationSummaryEntry[];
  /** Per-instant container appointment groups (EPIC 2.4 mapping). One entry
   *  per distinct (appointment instant, effective factory) so the dispatch
   *  master-plan "Giờ:" cell can render N rows for multi-container lots
   *  whose containers have different close/return times. Mirrors the
   *  `appointmentGroups` shape from the CUS workspace list response. */
  appointmentGroups: ShipmentAppointmentGroup[];
  /** Per-container lift/drop pairs for the dispatch master-plan. Optional so
   *  a frontend can tolerate an older API during a rolling deployment. */
  containerPortGroups?: ShipmentContainerPortGroup[];
}

export interface ShipmentContainerPortGroup {
  pickupPortName: string | null;
  dropoffPortName: string | null;
  /**
   * Business-zone local date for the cont appointment that produced this
   * port pair. Customer feedback L2 (24/08/2026) — the dispatch master-plan
   * grid uses this to recompute the Cảng nâng / Cảng hạ cells when the
   * user filters by a single day. `null` when the cont has no
   * customerAppointmentAt yet.
   */
  localDate?: string | null;
  containerSummary: string;
}

export interface ShipmentAppointmentGroup {
  /** ISO 8601 timestamp of the appointment instant (per-container). */
  at: string;
  /** Local-date in the business zone (Asia/Ho_Chi_Minh) — YYYY-MM-DD. */
  localDate: string;
  /** Backward-compatible operational label: the factory short name. */
  factoryName: string | null;
  /** Effective factory short name for operational surfaces. */
  factoryShortName: string | null;
  /** Effective factory full name for legal-document preparation. */
  factoryFullName: string | null;
  /** Compact per-type container summary, e.g. "1 x 40DC + 1 x 20DC". */
  containerSummary: string;
}

export interface ShipmentListResponse {
  items: ShipmentListItem[];
  total: number;
  page: number;
  limit: number;
  /** Present when includeDispatchSummary=true: cargo totals over the complete
   *  filtered set (never the loaded page). */
  dispatchSummary?: {
    totalFclContainers: number;
    size20ft: number;
    size40ft: number;
    sizeOther: number;
    lclFulfillments: number;
  };
}

/** Port option for a master-plan zone facet. */
export interface DispatchPortFacetItem {
  id: number;
  name: string;
  code: string | null;
}

export async function listZonePortFacets(zone: string, q?: string): Promise<{ items: DispatchPortFacetItem[] }> {
  const params = new URLSearchParams({ zone });
  if (q) params.set('q', q);
  return api.get<{ items: DispatchPortFacetItem[] }>(`/shipments/dispatch-zone-port-facets?${params.toString()}`);
}

/** Body for `POST /api/shipments/:id/dispatch` — "phát lệnh" for a fulfillment
 *  that already has a carrier/vehicle planned ("xếp xe"). Mirrors the backend
 *  `fulfillmentDispatchSchema` (backend/src/routes/shipments/core.routes.ts). */
export interface DispatchShipmentRequest {
  fulfillmentId: number;
  expectedVersion: number;
  plannedStartAt: string;
  plannedEndAt: string;
  endTimeConfirmed: boolean;
  carrierType: 'OWN' | 'EXTERNAL';
  cargoTypeId?: number | null;
  truckId?: number | null;
  driverId?: number | null;
  trailerId?: number | null;
  containerTypeId?: number | null;
  pricingRateKey?: string | null;
  externalCarrierId?: number | null;
  externalCarrierVehicleId?: number | null;
  externalPlateNumber?: string | null;
  externalDriverName?: string | null;
  externalDriverPhone?: string | null;
}

/** Response from `POST /api/shipments/:id/dispatch` — the trip it created (or
 *  reused, on idempotency replay) plus the fulfillment's fresh version. */
export interface DispatchShipmentResponse {
  fulfillmentId: number;
  version: number;
  trip: {
    id: number;
    version: number;
    tripCode: string | null;
    status: string;
    plannedStartAt: string | null;
    plannedEndAt: string | null;
    carrierType: 'OWN' | 'EXTERNAL';
    truckId: number | null;
    trailerId: number | null;
    driverId: number | null;
    externalCarrierId: number | null;
    externalPlateNumber: string | null;
    externalDriverName: string | null;
    externalDriverPhone: string | null;
  };
  notification: { type: string; deliveredInApp: boolean; pushAttempted: boolean };
  replayed: boolean;
}

/** Fetch the full detail (shipment + containers + documents + …). */
export async function getShipmentDetail(id: number): Promise<ShipmentDetail> {
  return api.get<ShipmentDetail>(`/shipments/${id}`);
}

/** Update BL number (and optionally other fields) — version-gated (409 on stale). */
export async function updateShipment(
  id: number,
  body: UpdateShipmentRequest,
): Promise<ShipmentUpdateResponse> {
  return api.put<ShipmentUpdateResponse>(`/shipments/${id}`, body);
}

/** Full-reconcile the shipment's container set (slice-1 validation applies). */
export async function saveShipmentContainers(
  id: number,
  body: ShipmentContainerBatch,
): Promise<ShipmentContainerBatchResponse> {
  return api.put<ShipmentContainerBatchResponse>(`/shipments/${id}/containers`, body);
}

export async function saveShipmentCarrierAllocations(
  id: number,
  body: { expectedVersion: number; carrierAllocations: ShipmentCarrierAllocationGroup[] },
  idempotencyKey?: string,
  /** `partial` allows under-allocation (dispatch master-plan). Default: exact. */
  mode?: 'partial',
): Promise<ShipmentCarrierAllocationResponse> {
  const suffix = mode === 'partial' ? '?mode=partial' : '';
  return api.post<ShipmentCarrierAllocationResponse>(`/shipments/${id}/carrier-allocations${suffix}`, body, {
    headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() },
  });
}

export async function listOperationalSites(customerId: number): Promise<OperationalSite[]> {
  const response = await api.get<{ items: OperationalSite[] }>(
    `/shipments/operational-sites?customerId=${encodeURIComponent(customerId)}`,
  );
  return response.items;
}

/** Body for `POST /api/shipments/operational-sites`. Optional fields may be null. */
export interface CreateOperationalSiteBody {
  customerId: number;
  code: string;
  name: string;
  shortName: string;
  siteType: 'FACTORY' | 'WAREHOUSE';
  routeId?: number | null;
  address: string;
  googleMapsUrl?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  liftFeeInvoiceName?: string | null;
  liftFeeInvoiceAddress?: string | null;
  liftFeeTaxCode?: string | null;
  strictRules?: string | null;
}

/**
 * Create a customer-owned factory/warehouse from the intake form so a user is
 * never blocked by an empty dropdown. Mirrors the operational-site schema on
 * the backend; the service reconciles by `(customerId, code)` so re-submitting
 * the same code updates the live master row.
 */
export async function createOperationalSite(body: CreateOperationalSiteBody): Promise<OperationalSite> {
  return api.post<OperationalSite>('/shipments/operational-sites', body);
}

/** Master-data row for the ADMIN/MANAGER "Nhà máy" config surface. */
export interface AdminOperationalSite extends OperationalSite {
  customerName: string;
  routeName: string | null;
  isActive: boolean;
}

/** Body for `PATCH /api/shipments/operational-sites/:id` — partial, version-checked. */
export interface UpdateOperationalSiteBody {
  expectedVersion: number;
  name?: string;
  shortName?: string;
  routeId?: number | null;
  address?: string;
  googleMapsUrl?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  warehouseContactInfo?: string | null;
  liftInfo?: string | null;
  dropInfo?: string | null;
  cleaningInfo?: string | null;
  liftFeeInvoiceName?: string | null;
  liftFeeInvoiceAddress?: string | null;
  liftFeeTaxCode?: string | null;
  strictRules?: string | null;
  isActive?: boolean;
}

/** Every live customer-owned site across all customers (includes deactivated). */
export async function listAdminOperationalSites(): Promise<AdminOperationalSite[]> {
  const response = await api.get<{ items: AdminOperationalSite[] }>('/shipments/operational-sites/admin');
  return response.items;
}

/** Version-checked partial update from the admin config surface (409 on stale). */
export async function updateAdminOperationalSite(
  siteId: number,
  body: UpdateOperationalSiteBody,
): Promise<OperationalSite> {
  return api.patch<OperationalSite>(`/shipments/operational-sites/${siteId}`, body);
}

export async function submitShipmentForDispatch(
  id: number,
  body: {
    expectedVersion: number;
    priority?: 'NORMAL' | 'URGENT';
    operationalNote?: string | null;
    carrierAllocations?: ShipmentCarrierAllocationGroup[];
  },
  idempotencyKey: string,
) {
  return api.post<{ shipment: Shipment; handoff: ShipmentDispatchHandoff; replayed: boolean }>(
    `/shipments/${id}/submit-for-dispatch`,
    body,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export async function getShipmentDispatchHandoff(id: number): Promise<ShipmentDispatchHandoff | null> {
  return api.get<ShipmentDispatchHandoff | null>(`/shipments/${id}/dispatch-handoff`);
}

export async function addShipmentDocument(
  id: number,
  body: ShipmentDocumentRequest,
): Promise<ShipmentDocument> {
  return api.post<ShipmentDocument>(`/shipments/${id}/documents`, body);
}

export async function replaceShipmentDocument(
  shipmentId: number,
  documentId: number,
  body: ShipmentDocumentReplacementRequest,
): Promise<ShipmentDocumentReplacementResponse> {
  return api.post<ShipmentDocumentReplacementResponse>(`/shipments/${shipmentId}/documents/${documentId}/replace`, body);
}

export async function createShipmentDeclaration(
  shipmentId: number,
  body: ShipmentDeclarationRequest,
): Promise<ShipmentDeclaration> {
  return api.post<ShipmentDeclaration>(`/shipments/${shipmentId}/declarations`, body);
}

export async function updateShipmentDeclaration(
  shipmentId: number,
  declarationId: number,
  body: ShipmentDeclarationRequest,
): Promise<ShipmentDeclaration> {
  return api.put<ShipmentDeclaration>(`/shipments/${shipmentId}/declarations/${declarationId}`, body);
}

export async function reviewShipmentChangeRequest(
  shipmentId: number,
  requestId: number,
  resolution: 'APPLIED' | 'REJECTED',
): Promise<ShipmentChangeRequestReviewResponse> {
  return api.post<ShipmentChangeRequestReviewResponse>(
    `/shipments/${shipmentId}/change-requests/${requestId}/review`,
    { resolution },
  );
}

export async function requestShipmentDelete(
  shipmentId: number,
  version: number,
  reason: string,
): Promise<{ pendingApproval: boolean }> {
  return api.post<{ pendingApproval: boolean }>(
    `/shipments/cus-workspace/${shipmentId}/delete-request`,
    { version, reason },
  );
}

export async function decideShipmentDeleteRequest(
  shipmentId: number,
  actionId: number,
  decision: 'APPROVE' | 'REJECT',
  expectedVersion: number,
  reason: string,
): Promise<{ deleted: boolean }> {
  return api.post<{ deleted: boolean }>(
    `/shipments/cus-workspace/${shipmentId}/delete-requests/${actionId}/decision`,
    { decision, expectedVersion, reason },
  );
}

export async function requestContainerEdit(
  shipmentId: number,
  containerId: number,
  fields: Record<string, unknown>,
  reason: string,
): Promise<{ replayed: boolean }> {
  return api.post<{ replayed: boolean }>(
    `/shipments/cus-workspace/${shipmentId}/container-edit-request`,
    { containerId, fields, reason },
  );
}

export async function reviewShipmentPod(
  shipmentId: number,
  submissionId: number,
  body: ReviewShipmentPodRequest,
  idempotencyKey: string,
): Promise<ReviewShipmentPodResponse> {
  return api.post<ReviewShipmentPodResponse>(
    `/shipments/${shipmentId}/pod-reviews/${submissionId}/review`,
    body,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export async function completeShipment(
  shipmentId: number,
  body: CompleteShipmentRequest,
  idempotencyKey: string,
): Promise<CompleteShipmentResponse> {
  return api.post<CompleteShipmentResponse>(
    `/shipments/${shipmentId}/complete`,
    body,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export async function cancelShipmentFulfillment(
  shipmentId: number,
  fulfillmentId: number,
  body: CancelShipmentFulfillmentRequest,
  idempotencyKey: string,
): Promise<CancelShipmentFulfillmentResponse> {
  return api.post<CancelShipmentFulfillmentResponse>(
    `/shipments/${shipmentId}/fulfillments/${fulfillmentId}/cancellation-disposition`,
    body,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export async function downloadShipmentPodFile(
  shipmentId: number,
  fileId: number,
): Promise<Blob> {
  return api.getBlob(`/shipments/${shipmentId}/pod-files/${fileId}`);
}

export async function listShipments(params?: {
  page?: number;
  limit?: number;
  customerId?: number;
  /** Single status or a comma-serialized status set (dispatch master plan). */
  status?: ShipmentStatus | ShipmentStatus[];
  q?: string;
  tradeDirection?: 'IMPORT' | 'EXPORT';
  blNumber?: string;
  /** Filters on customsCutoffAt. */
  dateFrom?: string;
  dateTo?: string;
  /** Dispatch master-plan: filters on expectedDeliveryDate. */
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  allocationStatus?: ShipmentAllocationStatus;
  /** Dispatch master-plan Lạch Huyện: OR within ports, AND with other facets. */
  portIds?: number[];
  /** Dispatch master-plan: OWN / EXTERNAL:<id> / UNASSIGNED keys. */
  carrierKeys?: string[];
  /** Include the full-filtered-set cargo summary in the response. */
  includeDispatchSummary?: boolean;
}): Promise<ShipmentListResponse> {
  const query = new URLSearchParams();
  if (params?.page != null) query.set('page', String(params.page));
  if (params?.limit != null) query.set('limit', String(params.limit));
  if (params?.customerId != null) query.set('customerId', String(params.customerId));
  if (params?.status != null) {
    query.set('status', Array.isArray(params.status) ? params.status.join(',') : params.status);
  }
  if (params?.q) query.set('q', params.q);
  if (params?.tradeDirection) query.set('tradeDirection', params.tradeDirection);
  if (params?.blNumber) query.set('blNumber', params.blNumber);
  if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
  if (params?.dateTo) query.set('dateTo', params.dateTo);
  if (params?.deliveryDateFrom) query.set('deliveryDateFrom', params.deliveryDateFrom);
  if (params?.deliveryDateTo) query.set('deliveryDateTo', params.deliveryDateTo);
  if (params?.allocationStatus) query.set('allocationStatus', params.allocationStatus);
  params?.portIds?.forEach((id) => query.append('portIds', String(id)));
  params?.carrierKeys?.forEach((key) => query.append('carrierKeys', key));
  if (params?.includeDispatchSummary) query.set('includeDispatchSummary', 'true');
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.get<ShipmentListResponse>(`/shipments${suffix}`);
}

export interface ShipmentCusWorkspaceFilters {
  page?: number;
  limit?: number;
  searchSuffix?: string;
  transportDateFrom?: string;
  transportDateTo?: string;
  customerId?: number;
  direction?: 'IMPORT' | 'EXPORT';
  bucket?: 'NEW' | 'RUNNING' | 'PENDING_LOCK' | 'LOCKED';
  sortBy?: ShipmentCusWorkspaceSortKey;
  sortDir?: 'asc' | 'desc';
}

// Container-workboard-only filters. Both are detail-only parameters the
// overview endpoint rejects; never add them to overview calls. The sort keys
// are this workboard's own enum, so they replace (not extend) the overview's.
export interface ShipmentCusContainerFilters extends Omit<ShipmentCusWorkspaceFilters, 'sortBy' | 'sortDir'> {
  informationStatus?: 'MISSING';
  dispatchStatus?: 'ASSIGNED' | 'UNASSIGNED' | 'AWAITING_VEHICLE' | 'PLANNED' | 'CREATED' | 'IN_TRANSIT' | 'COMPLETED';
  sortBy?: ShipmentCusContainerSortKey;
  sortDir?: 'asc' | 'desc';
}

export async function listCusShipmentWorkspace(
  filters: ShipmentCusWorkspaceFilters = {},
): Promise<ShipmentCusWorkspaceListResponse> {
  const query = new URLSearchParams();
  if (filters.page != null) query.set('page', String(filters.page));
  if (filters.limit != null) query.set('limit', String(filters.limit));
  if (filters.searchSuffix) query.set('searchSuffix', filters.searchSuffix);
  if (filters.transportDateFrom) query.set('transportDateFrom', filters.transportDateFrom);
  if (filters.transportDateTo) query.set('transportDateTo', filters.transportDateTo);
  if (filters.customerId != null) query.set('customerId', String(filters.customerId));
  if (filters.direction) query.set('direction', filters.direction);
  if (filters.bucket) query.set('bucket', filters.bucket);
  if (filters.sortBy) query.set('sortBy', filters.sortBy);
  if (filters.sortDir) query.set('sortDir', filters.sortDir);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.get<ShipmentCusWorkspaceListResponse>(`${SHIPMENTS.CUS_WORKSPACE_LIST}${suffix}`);
}

export async function listCusShipmentContainers(
  filters: ShipmentCusContainerFilters = {},
): Promise<ShipmentCusContainerFlatResponse> {
  const query = new URLSearchParams();
  if (filters.page != null) query.set('page', String(filters.page));
  if (filters.limit != null) query.set('limit', String(filters.limit));
  if (filters.searchSuffix) query.set('searchSuffix', filters.searchSuffix);
  if (filters.transportDateFrom) query.set('transportDateFrom', filters.transportDateFrom);
  if (filters.transportDateTo) query.set('transportDateTo', filters.transportDateTo);
  if (filters.customerId != null) query.set('customerId', String(filters.customerId));
  if (filters.direction) query.set('direction', filters.direction);
  if (filters.bucket) query.set('bucket', filters.bucket);
  if (filters.informationStatus) query.set('informationStatus', filters.informationStatus);
  if (filters.dispatchStatus) query.set('dispatchStatus', filters.dispatchStatus);
  if (filters.sortBy) query.set('sortBy', filters.sortBy);
  if (filters.sortDir) query.set('sortDir', filters.sortDir);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.get<ShipmentCusContainerFlatResponse>(`${SHIPMENTS.CUS_WORKSPACE_CONTAINERS}${suffix}`);
}

export async function getCusShipmentWorkspaceDetail(
  shipmentId: number,
): Promise<ShipmentCusWorkspaceDetail> {
  return api.get<ShipmentCusWorkspaceDetail>(SHIPMENTS.CUS_WORKSPACE_DETAIL(shipmentId));
}

export async function updateCusShipmentDocumentCustody(
  shipmentId: number,
  body: ShipmentCusDocumentCustodyUpdateInput,
  idempotencyKey?: string,
) {
  return api.post<{ version: number }>(
    SHIPMENTS.CUS_WORKSPACE_DOCUMENT_CUSTODY(shipmentId),
    body,
    { headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() } },
  );
}

export async function updateCusShipmentContainerLine(
  shipmentId: number,
  containerId: number,
  body: ShipmentCusContainerLineUpdateInput,
  idempotencyKey?: string,
): Promise<ShipmentCusContainerLineUpdateResult> {
  return api.post<ShipmentCusContainerLineUpdateResult>(
    SHIPMENTS.CUS_WORKSPACE_CONTAINER_LINE(shipmentId, containerId),
    body,
    { headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() } },
  );
}

export async function confirmCusShipmentFinance(
  shipmentId: number,
  body: ShipmentCusFinanceConfirmationCreateInput,
  idempotencyKey?: string,
) {
  return api.post<{ confirmationId: number; checksum: string; replayed: boolean }>(
    SHIPMENTS.CUS_WORKSPACE_FINANCE_CONFIRM(shipmentId),
    body,
    { headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() } },
  );
}

export async function lockCusShipment(
  shipmentId: number,
  body: ShipmentCusLockInput,
  idempotencyKey?: string,
) {
  return api.post<{ replayed: boolean }>(
    SHIPMENTS.CUS_WORKSPACE_LOCK(shipmentId),
    body,
    { headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() } },
  );
}

export async function requestCusShipmentReopen(
  shipmentId: number,
  body: ShipmentCusReopenRequestInput,
  idempotencyKey?: string,
) {
  return api.post<{ replayed: boolean }>(
    SHIPMENTS.CUS_WORKSPACE_REOPEN_REQUEST(shipmentId),
    body,
    { headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() } },
  );
}

/** Issue the dispatch order ("phát lệnh") for a planned fulfillment — creates
 *  the live trip and notifies the driver. Idempotent per request key. */
export async function dispatchShipment(
  id: number,
  body: DispatchShipmentRequest,
): Promise<DispatchShipmentResponse> {
  return api.post<DispatchShipmentResponse>(`/shipments/${id}/dispatch`, body, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}
