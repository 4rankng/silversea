// Shipment API client — frontend transport layer for `/api/shipments/*`.
//
// Mirrors the `tripClient.ts` / `configClient.ts` pattern: thin helpers over
// the shared `api` fetch wrapper, with response shapes typed for the
// consuming hooks/pages. Today this covers the M10.1 clerk quick-create
// surface; later clerk/shipment operations (M10.2 doc entry, M10.3 handoff)
// grow this file.

import { api } from '../lib/api';

/** Row shape returned by `/api/shipments/quick` and `/api/shipments/:id`. */
export interface Shipment {
  id: number;
  shipmentCode: string | null;
  version: number;
  customerId: number;
  status: 'DRAFT' | 'IN_PROGRESS' | 'DELIVERED' | 'CLOSED' | 'CANCELED';
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
  return api.post<Shipment>('/api/shipments/quick', body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
