import { formatCurrency, formatDate } from '../../lib/format';
import { EmptyState } from '../../design-system';
import type { DebitSettlementRoundRow } from '../../api/accountingDebitClient';

/**
 * The chốt-debit settlement board — the rounds the accountant has closed, per
 * period and customer (card 20260923_12).
 *
 * Split out of `AccountingDebitClosePage.tsx` on 2026-09-29 (the page hit the
 * structure guard's 400-line ceiling). It reads no page state: the query result
 * comes in as a prop, so the rounds board can be reasoned about on its own.
 */
export function DebitRoundBoard({ rounds }: { rounds: readonly DebitSettlementRoundRow[] }) {
  return (
    <section className="debit-rounds" aria-label="Tổng hợp công nợ khách hàng">
      <h2 className="debit-board__title">Tổng hợp công nợ khách hàng</h2>
      {rounds.length === 0 ? (
        <EmptyState
          variant="compact"
          context="debts"
          title="Chưa có đợt chốt nào"
          description="Mỗi đợt chốt debit sẽ hiện ở đây theo kỳ theo dõi."
        />
      ) : (
        <div className="debit-board__wrap" role="region" aria-label="Bảng tổng hợp công nợ khách hàng" tabIndex={0}>
          <table className="debit-board">
            <caption className="sr-only">Tổng hợp công nợ khách hàng theo đợt chốt</caption>
            <thead>
              <tr>
                <th scope="col">Kỳ theo dõi</th>
                <th scope="col">Khách hàng</th>
                <th scope="col">Đối tượng</th>
                <th scope="col">Chiều</th>
                <th scope="col">Từ ngày</th>
                <th scope="col">Đến ngày</th>
                <th scope="col" className="debit-col--money">Số tiền (chưa VAT)</th>
                <th scope="col">VAT</th>
                <th scope="col" className="debit-col--money">Tiền VAT</th>
                <th scope="col" className="debit-col--money">Tổng tiền (gồm VAT)</th>
                <th scope="col" className="debit-col--note">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((round) => (
                <tr key={round.id}>
                  <td>{`Lần ${round.roundNo} · ${round.periodKey.replaceAll('-', '/')}`}</td>
                  <td>{round.customerName ?? '—'}</td>
                  <td>{round.carrierLabel ?? '—'}</td>
                  <td>{round.direction === 'THU' ? 'Phải thu' : 'Phải trả'}</td>
                  <td>{formatDate(round.dateFrom)}</td>
                  <td>{formatDate(round.dateTo)}</td>
                  <td className="num debit-col--money">{formatCurrency(Number(round.amount))}</td>
                  <td>{`${round.vatRate}%`}</td>
                  <td className="num debit-col--money">{formatCurrency(round.vatAmount)}</td>
                  <td className="num debit-col--money">{formatCurrency(round.totalAmount)}</td>
                  <td className="debit-col--note">{round.ghiChu ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
