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
