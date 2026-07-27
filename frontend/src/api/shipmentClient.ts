// Shipment API client — frontend transport layer for `/api/shipments/*`.
//
// Mirrors the `tripClient.ts` / `configClient.ts` pattern: thin helpers over
// the shared `api` fetch wrapper, with response shapes typed for the
// consuming hooks/pages. Today this covers the M10.1 clerk quick-create
// surface; later clerk/shipment operations (M10.2 doc entry, M10.3 handoff)
// grow this file.

import { ShipmentStatus } from '@tingting/shared';
import { api } from '../lib/api';

/** Row shape returned by `/api/shipments/quick` and `/api/shipments/:id`. */
export interface Shipment {
  id: number;
  shipmentCode: string | null;
  version: number;
  customerId: number;
  responsibleUnitId: number | null;
  status: ShipmentStatus;
  bookingRef: string | null;
  blNumber: string | null;
  expectedDeliveryDate: string | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  contactName: string | null;
  contactPhone: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Body for `POST /api/shipments/quick` — matches `quickCreateShipmentSchema`. */
export interface QuickCreateShipmentRequest {
  customerId: number;
  responsibleUnitId?: number | null;
  bookingRef?: string | null;
  blNumber?: string | null;
  expectedDeliveryDate?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
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
  containerNumber: string | null;
  sealNumber: string | null;
  cargoWeightKg: string | null;
  notes: string | null;
}

/** Full detail payload returned by `GET /api/shipments/:id`. */
export interface ShipmentDetail {
  shipment: Shipment & { customerName: string | null };
  containers: ShipmentContainer[];
  documents: ShipmentDocument[];
  declarations: ShipmentDeclaration[];
  statusHistory: ShipmentStatusHistoryEntry[];
  pendingChangeRequests: ShipmentChangeRequest[];
}

/** Body for `PUT /api/shipments/:id` — version is required (optimistic lock). */
export interface UpdateShipmentRequest {
  expectedVersion: number;
  customerId?: number;
  responsibleUnitId?: number | null;
  blNumber?: string | null;
  bookingRef?: string | null;
  expectedDeliveryDate?: string | null;
  pickupLocation?: string | null;
  deliveryLocation?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
}

/** Body for `PUT /api/shipments/:id/containers` (full reconcile). */
export interface ShipmentContainerBatch {
  expectedVersion: number;
  containers: Array<{
    id?: number;
    containerTypeId?: number | null;
    containerNumber?: string | null;
    sealNumber?: string | null;
    cargoWeightKg?: string | number | null;
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

export interface ShipmentChangeRequestReviewResponse {
  shipment: Shipment;
  resolution: 'APPLIED' | 'REJECTED';
  changeRequestId: number;
  shipmentVersion: number;
  notificationDelivered: boolean;
  message: string;
}

export interface ShipmentListItem extends Shipment {
  customerName: string | null;
}

export interface ShipmentListResponse {
  items: ShipmentListItem[];
  total: number;
  page: number;
  limit: number;
}

/** Body for `POST /api/shipments/:id/dispatch`. */
export interface DispatchShipmentRequest {
  routeId: number;
  cargoTypeId: number;
  containerTypeId: number;
  truckId?: number | null;
  driverId?: number | null;
  departureDate: string;
  customerReference?: string;
  containerCount?: number;
  creditApprovalRequestId?: number | null;
}

/** Response from `POST /api/shipments/:id/dispatch` — carries slice-2 warnings. */
export interface DispatchShipmentResponse {
  trip: { id: number; tripCode: string | null; shipmentId: number | null };
  created: boolean;
  preDispatchWarnings: string[];
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

export async function listShipments(params?: {
  page?: number;
  limit?: number;
  customerId?: number;
  status?: ShipmentStatus;
}): Promise<ShipmentListResponse> {
  const query = new URLSearchParams();
  if (params?.page != null) query.set('page', String(params.page));
  if (params?.limit != null) query.set('limit', String(params.limit));
  if (params?.customerId != null) query.set('customerId', String(params.customerId));
  if (params?.status != null) query.set('status', params.status);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.get<ShipmentListResponse>(`/shipments${suffix}`);
}

/** Dispatch the shipment → linked trip. Carries slice-2 preDispatchWarnings. */
export async function dispatchShipment(
  id: number,
  body: DispatchShipmentRequest,
): Promise<DispatchShipmentResponse> {
  return api.post<DispatchShipmentResponse>(`/shipments/${id}/dispatch`, body);
}
