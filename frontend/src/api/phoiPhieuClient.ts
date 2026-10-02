// Card 20260921_12 — Bảng kiểm soát phơi phiếu / tiền đường client.
import { api } from '../lib/api';

export type ChiHoConfirmation = 'CONFIRMED' | 'UNCONFIRMED';

export interface PhoiPhieuRow {
  tripId: number;
  tripCode: string | null;
  shipmentId: number;
  shipmentCode: string | null;
  billOrBooking: string | null;
  customerName: string | null;
  factoryName?: string | null;
  routeName: string | null;
  containerNumber: string | null;
  containerTypeLabel: string | null;
  /** Card 20260921_15 — trọng lượng HÀNG. */
  cargoWeightKg: number | null;
  /** Card 20260928_172 — TRỌNG TẢI CONTAINER (rated capacity of the type).
   *  Distinct from the cargo weight; null = this type has no rating. */
  containerPayloadKg: number | null;
  liftSite: string | null;
  dropSite: string | null;
  plateNumber: string | null;
  driverName: string | null;
  carrierName?: string | null;
  departureDate: string | null;
  /** Appointment day in Vietnam, or the established shipment schedule fallback. */
  transportDate?: string | null;
  tripStatus: string | null;
  chiHoThu: number | null;
  chiHoTra: number | null;
  tienDuong: number | null;
  /** Per-direction eligible-entry counts (approved ∧ remaining>0) — the
   *  toolbar counter previews exactly what the voucher will consume. */
  eligibleIn: number;
  eligibleOut: number;
  cusDispatchNotes: string[];
  /** Card 20260928_162 — the OPS expense-note family (the not-charged REASON
   *  foremost) from the same projection the dispatch plan grids read. Reason
   *  text only: no amount, no fund detail (OpsVanHanh §9.1). Optional so an
   *  older in-flight backend payload still renders. */
  opsRecoveryNotes?: string[];
  driverNote: string | null;
  confirmable: boolean;
  openSources: Array<{ sourceId: number; expectedVersion: number; remaining: number }>;
}

export async function listPhoiPhieuRows(params: {
  dateFrom?: string; dateTo?: string; status?: string; search?: string;
  sortBy?: 'grouped' | 'date'; confirmation?: ChiHoConfirmation | '';
}): Promise<{ items: PhoiPhieuRow[] }> {
  const query = new URLSearchParams();
  if (params.dateFrom) query.set('dateFrom', params.dateFrom);
  if (params.dateTo) query.set('dateTo', params.dateTo);
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.confirmation) query.set('confirmation', params.confirmation);
  return api.get(`/expense-accounting/phoi-phieu/rows?${query.toString()}`);
}

export async function createPhoiPhieuVoucher(body: {
  tripIds: number[];
  direction: 'IN' | 'OUT';
  treasuryAccountId: number;
  physicalReference?: string;
}, idempotencyKey?: string): Promise<{ voucherId: number; code: string; total: number; entries: number }> {
  return api.post('/expense-accounting/phoi-phieu/vouchers', body, {
    idempotencyKey,
  });
}

export async function listPhoiPhieuStk(): Promise<{ items: Array<{ id: number; code: string; name: string }> }> {
  return api.get('/expense-accounting/phoi-phieu/stk');
}

export interface PhoiPhieuFeeRow {
  /** The OPS EXPENSE entry id — the id space every mutation route keys on. */
  entryId: number;
  sourceId: number;
  version: number;
  feeName: string | null;
  invoiceNumber: string | null;
  amountTra: number;
  amountThu: number | null;
  payerName: string | null;
  payerUserId: number | null;
  confirmed: boolean;
}

export interface PhoiPhieuChiHoDetail {
  tripId: number;
  tripCode: string | null;
  shipmentId: number;
  ngayLayPhoi: string | null;
  trangThaiLay: string | null;
  rows: PhoiPhieuFeeRow[];
  totals: { thu: number; tra: number };
}

export async function getPhoiPhieuChiHo(tripId: number, confirmation?: ChiHoConfirmation): Promise<PhoiPhieuChiHoDetail> {
  const query = confirmation ? `?confirmation=${confirmation}` : '';
  return api.get(`/expense-accounting/phoi-phieu/${tripId}/chi-ho${query}`);
}

export async function updatePhoiPhieuMeta(tripId: number, body: {
  ngayLayPhoi?: string | null; trangThaiLay?: string | null;
}, idempotencyKey?: string): Promise<{ ok: true }> {
  return api.put(`/expense-accounting/phoi-phieu/${tripId}/phoi-meta`, body, {
    idempotencyKey,
  });
}

export async function updatePhoiPhieuRowAmounts(tripId: number, sourceId: number, body: {
  expectedVersion: number; reason: string; amount?: number; customerChargeAmount?: number;
  payerUserId?: number | null;
}, idempotencyKey?: string): Promise<unknown> {
  return api.post(`/expense-accounting/entries/OPS/${sourceId}/update`, body, {
    idempotencyKey,
  });
}

export async function createPhoiPhieuRow(tripId: number, body: Record<string, unknown>, idempotencyKey?: string): Promise<unknown> {
  return api.post('/expense-accounting/entries', { tripId, ...body } as Record<string, unknown>, {
    idempotencyKey,
  });
}

export async function voidPhoiPhieuRow(tripId: number, sourceId: number, reason: string, idempotencyKey?: string): Promise<{ ok: true }> {
  return api.delete(`/expense-accounting/phoi-phieu/${tripId}/rows/${sourceId}`, {
    headers: { 'Content-Type': 'application/json' }, idempotencyKey,
    body: JSON.stringify({ reason }),
  });
}

export interface PhoiPhieuTienDuongRow {
  sourceId: number;
  version: number;
  costType: string;
  feeName: string | null;
  driverEnteredAmount: number | null;
  amount: number;
  confirmed: boolean;
  driverName: string | null;
  occurredAt: string | null;
}

export async function getPhoiPhieuTienDuong(tripId: number): Promise<{
  tripId: number; tripCode: string | null;
  rows: PhoiPhieuTienDuongRow[]; totals: { total: number; confirmed: number };
}> {
  return api.get(`/expense-accounting/phoi-phieu/${tripId}/tien-duong`);
}

export async function confirmPhoiPhieuTienDuong(tripId: number, sourceId: number, expectedVersion: number, idempotencyKey?: string): Promise<unknown> {
  return api.post('/expense-accounting/confirm', {
    entries: [{ sourceKind: 'DRIVER', sourceId, expectedVersion }],
  }, { idempotencyKey });
}

export interface PhoiPhieuReportRow {
  party: string;
  tienNang: number;
  tienHa: number;
  psKhac: number;
  tongPhaiThuTra: number;
  daThuTra: number;
  conLai: number;
  ghiChu: string | null;
  /** Card 20260928_173 AC2/AC3 — movements in the period, and both ledger
   *  legs of the subject: the receivable (cash IN) and the payable (cash OUT).
   *  A subject that moved on both is one row, so it needs both figures. */
  soLuong: number;
  phaiThu: number;
  phaiTra: number;
}

export async function getPhoiPhieuReport(kind: 'THU' | 'TRA', params: {
  dateFrom?: string; dateTo?: string;
  scope?: 'SELF' | 'ALL' | 'UNASSIGNED';
}): Promise<{ rows: PhoiPhieuReportRow[]; grand: PhoiPhieuReportRow }> {
  const query = new URLSearchParams({ kind });
  if (params.dateFrom) query.set('dateFrom', params.dateFrom);
  if (params.dateTo) query.set('dateTo', params.dateTo);
  if (params.scope) query.set('scope', params.scope);
  return api.get(`/expense-accounting/phoi-phieu/report?${query.toString()}`);
}

// Card 20260921_8 — vehicle → kế toán assignment board data + reassignment.
export interface PhoiPhieuTruckAssignment {
  truckId: number;
  plate: string;
  accountantId: number | null;
  accountantName: string | null;
  version: number;
}
export interface PhoiPhieuTruckAssignmentBoard {
  assignments: PhoiPhieuTruckAssignment[];
  unassignedTrucks: Array<{ truckId: number; plate: string }>;
  accountants: Array<{ id: number; fullName: string | null }>;
}

export async function listPhoiPhieuTruckAssignments(): Promise<PhoiPhieuTruckAssignmentBoard> {
  return api.get('/expense-accounting/phoi-phieu/truck-assignments');
}

export async function assignPhoiPhieuTruckAccountant(truckId: number, body: {
  accountantId: number | null; expectedVersion: number;
}, idempotencyKey?: string): Promise<unknown> {
  return api.put(`/expense-accounting/phoi-phieu/trucks/${truckId}/accountant`, body, {
    idempotencyKey,
  });
}

// Card 20260928_166 — the 39-truck split in ONE request. The route is
// all-or-nothing (assignTruckAccountantsBatch runs inside a single
// transaction), so a bad truck aborts the whole batch rather than leaving a
// half-applied split, and re-sending a batch whose trucks are already on that
// accountant is a no-op instead of a second audit row. This client was simply
// missing: the route existed, nothing could reach it.
export async function assignPhoiPhieuTruckAccountantsBatch(body: {
  accountantId: number | null; truckIds: number[];
}, idempotencyKey?: string): Promise<{ items: PhoiPhieuTruckAssignment[] }> {
  return api.post('/expense-accounting/assignments/batch', body, { idempotencyKey });
}

export async function correctPhoiPhieuRow(sourceId: number, body: Record<string, unknown>, idempotencyKey?: string): Promise<unknown> {
  return api.post(`/expense-accounting/entries/OPS/${sourceId}/correct`, body, {
    idempotencyKey,
  });
}
