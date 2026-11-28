// SIL-1238 (KB Ch.2 §2.2.9, K2.74) — the settlement SUMMARY layer ("lớp tổng")
// of /shipments-debit: per lot — Tổng phải thu khách, Tổng phải trả and
// Chênh lệch (= thu − trả), derived FE-side from the L1 wire's
// receivableTotal / payableTotal (no schema churn). Money law (debitMoney):
// known → the formatted number, computed 0 → '0', unknown → '—' — an unknown
// side never fabricates a 0, and Chênh lệch renders only when BOTH sides are
// determined (else blank). The trả/lệch columns hide for the CUS viewer
// exactly per the hideCost law (SIL-776 REV2): the wire strips giá vốn 100%,
// so CUS sees only the thu side.
import { formatKnownMoney, moneyState, PENDING_TOOLTIP, ZERO_TOOLTIP, type MoneyState } from './debitMoney';
import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';

export interface DebitLotSettlementEntry {
  shipmentId: number;
  /** The grid's lot label law: Số Bill/Booking → '#<shipmentId>'. */
  label: string;
  /** The lot's L1 summary row; null → every side reads unknown ('—'). */
  item: ShipmentDebitLotRow | null;
}

interface DebitLotSettlementSummaryProps {
  entries: DebitLotSettlementEntry[];
  /** SIL-776 REV2 hideCost — true for the CUS viewer (no giá vốn on the surface). */
  hideCost: boolean;
}

const stateValue = (state: MoneyState): number => (state.kind === 'known' ? state.value : 0);
const isDetermined = (state: MoneyState): boolean => state.kind !== 'pending';

function cellTitle(state: MoneyState): string | undefined {
  if (state.kind === 'pending') return PENDING_TOOLTIP;
  if (state.kind === 'zero') return ZERO_TOOLTIP;
  return undefined;
}

function moneyCell(state: MoneyState): string {
  if (state.kind === 'known') return formatKnownMoney(state.value);
  if (state.kind === 'zero') return '0';
  return '—';
}

export function DebitLotSettlementSummary({ entries, hideCost }: DebitLotSettlementSummaryProps) {
  return (
    <section className="debit-settlement-band" aria-label="Quyết toán — lớp tổng" data-component="debit-settlement-band">
      <table>
        <thead>
          <tr>
            <th scope="col" className="debit-settlement-band__lot">Lô hàng</th>
            <th scope="col" className="debit-settlement-band__money">Tổng phải thu khách</th>
            {!hideCost && <th scope="col" className="debit-settlement-band__money">Tổng phải trả</th>}
            {!hideCost && <th scope="col" className="debit-settlement-band__money">Chênh lệch</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const receivable = moneyState(entry.item?.receivableTotal ?? null);
            const payable = moneyState(entry.item?.payableTotal ?? null);
            const bothDetermined = isDetermined(receivable) && isDetermined(payable);
            const differenceValue = bothDetermined ? stateValue(receivable) - stateValue(payable) : null;
            const difference = differenceValue == null ? null : moneyState(differenceValue);
            return (
              <tr key={entry.shipmentId}>
                <th scope="row" className="debit-settlement-band__lot">{entry.label}</th>
                <td className="debit-settlement-band__money" title={cellTitle(receivable)}>
                  {moneyCell(receivable)}
                </td>
                {!hideCost && (
                  <>
                    <td className="debit-settlement-band__money" title={cellTitle(payable)}>
                      {moneyCell(payable)}
                    </td>
                    <td
                      className={differenceValue != null && differenceValue < 0
                        ? 'debit-settlement-band__money debit-settlement-band__money--negative'
                        : 'debit-settlement-band__money'}
                      title={difference == null ? PENDING_TOOLTIP : cellTitle(difference)}
                    >
                      {difference == null ? '—' : moneyCell(difference)}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
