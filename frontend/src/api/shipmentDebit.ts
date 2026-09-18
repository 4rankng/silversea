// Settlement screen (Chi phí - Quyết toán) client contracts. Extracted from
// shipmentClient.ts (structure-guard debt wave 2026-09-18): pure types and
// thin endpoint wrappers, re-exported so existing import paths hold.
import { api } from '../lib/api';
import type { ShipmentDebitEditPayload } from '@tingting/shared';

/** One collapsed lot row on the CUS settlement screen (Chi phí - Quyết toán). */
export interface ShipmentDebitLotRow {
  shipmentId: number;
  code: string;
  customerName: string;
  factoryName: string | null;
  factoryAddress: string | null;
  billOrBookNumber: string;
  customsNumber: string | null;
  /** Lot-level proof summary, e.g. "5/6" — null when nothing is recorded yet. */
  documentsSummary: string | null;
  /** Auto freight for the whole lot. null = not computable yet, never 0-by-default. */
  freightAuto: number | null;
  /** chi hộ total: CVC + Ops-paid items. null = chưa xác định. */
  chiHoTotal: number | null;
  /** phải thu khách − phải trả. null = chưa xác định. */
  receivableTotal: number | null;
  profit: number | null;
  lockStatus: 'OPEN' | 'LOCKED';
  lockedAt: string | null;
}

export interface ShipmentDebitSummary {
  items: ShipmentDebitLotRow[];
  total: number;
}

/** Settlement rollup per lot. Delivery date = shipments.expectedDeliveryDate. */
export async function listShipmentDebitSummary(params: {
  customerId: number;
  deliveryDateFrom?: string | null;
  deliveryDateTo?: string | null;
  lockStatus?: 'ALL' | 'OPEN' | 'LOCKED';
}): Promise<ShipmentDebitSummary> {
  const query = new URLSearchParams({ customerId: String(params.customerId) });
  if (params.deliveryDateFrom) query.set('deliveryDateFrom', params.deliveryDateFrom);
  if (params.deliveryDateTo) query.set('deliveryDateTo', params.deliveryDateTo);
  if (params.lockStatus && params.lockStatus !== 'ALL') query.set('lockStatus', params.lockStatus);
  return api.get<ShipmentDebitSummary>(`/shipments/debit-summary?${query.toString()}`);
}

// ── Chi phí - Quyết toán L2: per-lot detail workspace ──────────────────────
// Mirrors backend shipment-debit-detail.service.ts. Rows are trip-keyed;
// money is numeric with null = chưa xác định. The editable delta rides
// `shipmentDebitEditPayloadSchema` from @tingting/shared — one contract.

export interface DebitDetailFreightRow {
  containerNumber: string;
  containerTypeLabel: string | null;
  freightCharge: number | null;
  fuelSurcharge: number | null;
  lachHuyenFee: number | null;
  customsFee: number | null;
  psActual: number | null;
  psNotes: string | null;
}

export interface DebitDetailExpenseItem {
  id: number;
  expenseType: string;
  feeName: string | null;
  amount: number | null;
  thuKhach: number | null;
  note: string | null;
}

export interface DebitDetailChiHoRow {
  tripId: number;
  containerNumber: string | null;
  items: DebitDetailExpenseItem[];
  otherFees: Array<{ id: number; name: string; amount: number | null }>;
  carrierDetention: number | null;
  repairAdvance: number | null;
  opsDocsStatus: 'READY' | 'PENDING';
}

export interface ShipmentDebitDetail {
  freightRows: DebitDetailFreightRow[];
  chiHoRows: DebitDetailChiHoRow[];
  payables: { chiHoTotal: number | null };
  thuKhachTotal: number | null;
}

export async function getShipmentDebitDetail(shipmentId: number): Promise<ShipmentDebitDetail> {
  return api.get<ShipmentDebitDetail>(`/shipments/${encodeURIComponent(shipmentId)}/debit-detail`);
}

/** The strict delta: edits on existing expense lines, Phí khác adds/removals. */
export type ShipmentDebitEditsBody = ShipmentDebitEditPayload;

/** Idempotent per PRD O2C §8 — repeated saves must never duplicate entries. */
export async function saveShipmentDebitEdits(shipmentId: number, body: ShipmentDebitEditsBody, idempotencyKey: string): Promise<void> {
  await api.put(`/shipments/${encodeURIComponent(shipmentId)}/debit-edits`, body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// ── Card _19: lot lock + adjust-cước (snapshot contract) ───────────────────

/** POST /shipments/:id/lock — active-lock conflicts return 409 with the
 * dedicated message; retries with the same key return the original lock. */
export async function lockShipmentCost(shipmentId: number, idempotencyKey: string, expectedShipmentVersion?: number): Promise<void> {
  await api.post(`/shipments/${encodeURIComponent(shipmentId)}/lock`, expectedShipmentVersion != null ? { expectedShipmentVersion } : {}, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export interface ShipmentCostAdjustment {
  id: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string;
  adjustedAt: string;
}

/** Adjustments apply beside the locked snapshot — the snapshot never mutates. */
export async function adjustShipmentCost(shipmentId: number, body: { reason: string; changes: ShipmentDebitEditsBody }, idempotencyKey: string): Promise<void> {
  await api.post(`/shipments/${encodeURIComponent(shipmentId)}/cost-adjustments`, body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function listShipmentCostAdjustments(shipmentId: number): Promise<ShipmentCostAdjustment[]> {
  const response = await api.get<{ items: ShipmentCostAdjustment[] }>(`/shipments/${encodeURIComponent(shipmentId)}/cost-adjustments`);
  return response.items;
}
