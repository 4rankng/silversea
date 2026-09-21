// Card 20260921_12 — Bảng kiểm soát phơi phiếu / tiền đường client.
import { api } from '../lib/api';

export interface PhoiPhieuRow {
  tripId: number;
  tripCode: string | null;
  shipmentId: number;
  shipmentCode: string | null;
  billOrBooking: string | null;
  customerName: string | null;
  routeName: string | null;
  containerNumber: string | null;
  containerTypeLabel: string | null;
  liftSite: string | null;
  dropSite: string | null;
  plateNumber: string | null;
  driverName: string | null;
  departureDate: string | null;
  tripStatus: string | null;
  chiHoThu: number | null;
  chiHoTra: number | null;
  tienDuong: number | null;
  cusDispatchNotes: string[];
  driverNote: string | null;
  confirmable: boolean;
  openSources: Array<{ sourceId: number; expectedVersion: number; remaining: number }>;
}

export async function listPhoiPhieuRows(params: {
  dateFrom?: string; dateTo?: string; status?: string; search?: string;
}): Promise<{ items: PhoiPhieuRow[] }> {
  const query = new URLSearchParams();
  if (params.dateFrom) query.set('dateFrom', params.dateFrom);
  if (params.dateTo) query.set('dateTo', params.dateTo);
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  return api.get(`/expense-accounting/phoi-phieu/rows?${query.toString()}`);
}

export async function createPhoiPhieuVoucher(body: {
  tripIds: number[];
  direction: 'IN' | 'OUT';
  treasuryAccountId: number;
  physicalReference?: string;
}, idempotencyKey?: string): Promise<{ voucherId: number; code: string; total: number; entries: number }> {
  return api.post('/expense-accounting/phoi-phieu/vouchers', body, {
    headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() },
  });
}

export async function listPhoiPhieuStk(): Promise<{ items: Array<{ id: number; code: string; name: string }> }> {
  return api.get('/expense-accounting/phoi-phieu/stk');
}

export interface PhoiPhieuFeeRow {
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

export async function getPhoiPhieuChiHo(tripId: number): Promise<PhoiPhieuChiHoDetail> {
  return api.get(`/expense-accounting/phoi-phieu/${tripId}/chi-ho`);
}

export async function updatePhoiPhieuMeta(tripId: number, body: {
  ngayLayPhoi?: string | null; trangThaiLay?: string | null;
}, idempotencyKey?: string): Promise<{ ok: true }> {
  return api.put(`/expense-accounting/phoi-phieu/${tripId}/phoi-meta`, body, {
    headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() },
  });
}

export async function updatePhoiPhieuRowAmounts(tripId: number, sourceId: number, body: {
  expectedVersion: number; reason: string; amount?: number; customerChargeAmount?: number;
  payerUserId?: number | null;
}, idempotencyKey?: string): Promise<unknown> {
  return api.post(`/expense-accounting/entries/OPS/${sourceId}/update`, body, {
    headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() },
  });
}

export async function createPhoiPhieuRow(tripId: number, body: Record<string, unknown>, idempotencyKey?: string): Promise<unknown> {
  return api.post('/expense-accounting/entries', { tripId, ...body } as Record<string, unknown>, {
    headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() },
  });
}

export async function voidPhoiPhieuRow(tripId: number, sourceId: number, reason: string, idempotencyKey?: string): Promise<{ ok: true }> {
  return api.delete(`/expense-accounting/phoi-phieu/${tripId}/rows/${sourceId}`, { reason }, {
    headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() },
  });
}

export interface PhoiPhieuTienDuongRow {
  sourceId: number;
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
  }, { headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() } });
}
