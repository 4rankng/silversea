import { api } from '../lib/api';

/** Decompose a fulfillment-less branch row (READY_FOR_DISPATCH containers the
 *  grid surfaces without fulfillments) and hand back the fresh fulfillment
 *  identity so the plan editor can target it. Extracted from
 *  dispatchPlanningClient.ts to restore its LOC ceiling — see guard ticket
 *  2026.9 (1)._4 item 7 for the ceiling-debt ledger. */
export function decomposeDispatchDetailBranch(body: {
  shipmentId: number;
  containerId: number;
  expectedShipmentVersion: number;
}) {
  return api.post<{
    fulfillmentId: number;
    fulfillmentVersion: number;
    shipmentId: number;
    shipmentVersion: number;
  }>('/shipments/dispatch-detail-plan-rows/decompose', body, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}
