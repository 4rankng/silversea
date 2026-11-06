import type { BillingDocumentLine, BillingLineRenderData } from '@tingting/shared';
import { ApiError } from '../errors';
import { calculateVatSnapshot } from './billing-vat-math';

/** FB-094 (card 161026232429): what the customer-facing Debit Note must print
 *  per lot — the BKS báo khách ("xe ảo") and the THU billing class. Resolved by
 *  the caller from the live lot; never from the frozen money snapshot (a plate
 *  or class rename must not need a re-lock, and BKS is not a money value). */
export type FrozenDebitLotRenderInfo = {
  billingTruckNo?: string | null;
  vehicleType?: string | null;
};

/** Read only frozen amounts. A null customer total is unknown, not zero. */
function frozenMoney(snapshot: Record<string, unknown>, key: string): number | null {
  const raw = snapshot[key];
  if (raw == null || raw === '') return null;
  const amount = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ApiError(409, 'Số tiền trong bản khóa lô không hợp lệ. Vui lòng kiểm tra trước khi xuất Debit Note.');
  }
  return calculateVatSnapshot(amount, 0, 'EXEMPT').grossAmount;
}

/** SIL-693 — the freeze's own record of what the pricing engine decided about
 *  the lot at lock time (`classifyLotPricingBasis`, the same đủ/thiếu-căn cứ
 *  classifier the dispatch freeze runs, derived by ONE shared
 *  `deriveLotPricingGrounds`). Snapshots locked before SIL-693 lack the key:
 *  legacy law keeps applying to them (missing key = old freeze, never blocked). */
export interface FrozenFreightPricingBasis {
  action: 'LOCK' | 'SKIP';
  reason?: 'AD_HOC' | 'NO_CUSTOMER' | 'NO_ROUTE' | 'NO_RATE_KEY' | 'NO_TRANSPORT_DATE' | 'MISSING_WEIGHT';
}

/** Null-safe read: a malformed basis is NOT a valid unpriced proof — it reads
 *  absent so the guard below never blocks on corrupted freeze data. */
export function readFrozenFreightPricingBasis(snapshot: Record<string, unknown>): FrozenFreightPricingBasis | null {
  const raw = snapshot.freightPricingBasis;
  if (raw == null || typeof raw !== 'object') return null;
  const basis = raw as Record<string, unknown>;
  if (basis.action === 'LOCK') return { action: 'LOCK' };
  if (basis.action === 'SKIP' && typeof basis.reason === 'string'
    && ['AD_HOC', 'NO_CUSTOMER', 'NO_ROUTE', 'NO_RATE_KEY', 'NO_TRANSPORT_DATE', 'MISSING_WEIGHT'].includes(basis.reason)) {
    return { action: 'SKIP', reason: basis.reason as FrozenFreightPricingBasis['reason'] };
  }
  return null;
}

/** Both issue paths use the frozen customer debt, never the company's cost.
 * Missing-key legacy snapshots retain their original frozen components;
 * existing issued documents are outside this builder and remain immutable. */
export function buildFrozenShipmentDebitLines(
  snapshot: Record<string, unknown>,
  lotCode: string,
  lot: FrozenDebitLotRenderInfo = {},
): BillingDocumentLine[] {
  const freightFrozen = frozenMoney(snapshot, 'freightAuto');
  const freight = freightFrozen ?? 0;
  // SIL-693: a NEW-format freeze whose freightAuto is explicitly unset while
  // the recorded pricing basis says the engine SKIPPED pricing for lack of
  // grounds (NO_RATE_KEY on an LCL lot dispatched without a rate key, missing
  // weight/route/customer/date) means the lot's freight NEVER entered the
  // money system. Issuing here silently bills only the phát-sinh recharge —
  // the exact 150.000₫-instead-of-freight defect on staging lot 832. Same
  // doctrine as the receivable==null 409 below: refuse the note, name the
  // designed remedy (determine the price on Quyết toán, re-lock). AD_HOC lots
  // bill their customer-reported freight through the phát-sinh cells by
  // design, and legacy snapshots (no basis key) keep their frozen law.
  const pricingBasis = readFrozenFreightPricingBasis(snapshot);
  if (freightFrozen == null
    && Object.prototype.hasOwnProperty.call(snapshot, 'freightAuto')
    && pricingBasis?.action === 'SKIP' && pricingBasis.reason !== 'AD_HOC') {
    throw new ApiError(409,
      `Cước vận tải của lô ${lotCode} chưa được định giá trong bản khóa lô (định giá tự động bị bỏ qua: ${pricingBasis.reason}). `
      + 'Không thể xuất Debit Note thiếu cước — hãy xác định giá cước thu khách trên màn hình Chi phí - Quyết toán (chọn loại xe tính cước hoặc nhập giá), khóa lại lô rồi xuất.');
  }
  const receivable = frozenMoney(snapshot, 'receivableTotal');
  const lines: BillingDocumentLine[] = [];
  // FB-094 §II.4: the file's Biển số xe column is the BKS báo khách and the
  // Loại xe column the THU billing class — stamped onto every line of the lot
  // so the export never renders an empty BKS (the enrich loader skips lines
  // with no sourceId, which is exactly what these frozen ADHOC lines are).
  const renderData: BillingLineRenderData = {
    truckPlate: lot.billingTruckNo?.trim() || null,
    vehicleType: lot.vehicleType ?? null,
  };
  const add = (lineType: 'FREIGHT' | 'SERVICE_FEE', typeLabel: string, amount: number) => {
    if (amount === 0) return;
    // The existing lot export has no frozen tax classification. Preserve its
    // EXEMPT/0 policy while using the shared whole-VND billing calculation.
    const vat = calculateVatSnapshot(amount, 0, 'EXEMPT');
    lines.push({
      sourceType: 'ADHOC', sourceId: null, lineType, typeLabel, unit: 'lần',
      description: `${typeLabel} — lô ${lotCode} (chốt từ snapshot khóa lô)`,
      renderData: { ...renderData },
      baseAmount: vat.netAmount, ...vat, sortOrder: lines.length,
    });
  };
  if (snapshot.receivableTotal === undefined) {
    add('FREIGHT', 'Cước vận tải (auto)', freight);
    add('SERVICE_FEE', 'Tổng chi hộ', frozenMoney(snapshot, 'chiHoTotal') ?? 0);
    return lines;
  }
  if (receivable == null) {
    // Preserve the existing empty-snapshot export without guessing debt from
    // costs on partially populated snapshots whose customer total is unknown.
    if (freight !== 0 || (frozenMoney(snapshot, 'chiHoTotal') ?? 0) !== 0) {
      throw new ApiError(409, 'Tổng phải thu khách trong bản khóa lô chưa xác định. Vui lòng kiểm tra trước khi xuất Debit Note.');
    }
    return lines;
  }
  // A negotiated discount may put the customer total below auto freight.
  // Keep a nonnegative billed freight line, not a negative tax-bearing fee.
  const billedFreight = Math.min(freight, receivable);
  add('FREIGHT', billedFreight < freight ? 'Cước vận tải (đã khóa)' : 'Cước vận tải (auto)', billedFreight);
  add('SERVICE_FEE', 'Phí và phát sinh thu khách (đã khóa)', receivable - billedFreight);
  return lines;
}
