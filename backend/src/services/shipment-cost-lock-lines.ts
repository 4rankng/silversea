import type { BillingDocumentLine, BillingLineRenderData } from '@tingting/shared';
import { ApiError } from '../errors';
import { calculateVatSnapshot } from './billing-document-shared.service';

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

/** Both issue paths use the frozen customer debt, never the company's cost.
 * Missing-key legacy snapshots retain their original frozen components;
 * existing issued documents are outside this builder and remain immutable. */
export function buildFrozenShipmentDebitLines(
  snapshot: Record<string, unknown>,
  lotCode: string,
  lot: FrozenDebitLotRenderInfo = {},
): BillingDocumentLine[] {
  const freight = frozenMoney(snapshot, 'freightAuto') ?? 0;
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
