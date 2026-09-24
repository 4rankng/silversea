// Card 20260924_3 — the L2 "chuyến chưa gán fulfillment" section. Display
// only by Director ruling: the trips' fees are visible but never chốt-able
// (L1 excludes their money since 855aef81; chotIncluded is false by
// construction). Renders nothing when the lot has no unattached trips.
import { formatMoney } from '../../../lib/format';
import type { ShipmentDebitDetail } from '../../../api/shipmentDebit';

const money = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? 'Chưa xác định' : formatMoney(value);

const label = (item: ShipmentDebitDetail['unattachedTrips'][number]['items'][number]) =>
  item.feeName ?? item.expenseType;

export function UnattachedTripsTable({ trips }: { trips: ShipmentDebitDetail['unattachedTrips'] }) {
  if (trips.length === 0) return null;
  return (
    <table className="csc-debit-table csc-debit-table--unattached">
      <caption>Chuyến chưa gán fulfillment — chỉ hiển thị, không vào tổng chốt</caption>
      <thead><tr>
        <th scope="col">Mã chuyến</th>
        <th scope="col">Ngày chạy</th>
        <th scope="col">Trạng thái</th>
        <th scope="col">Phí phát sinh</th>
        <th scope="col">Tổng phí chuyến</th>
        <th scope="col">Chốt</th>
      </tr></thead>
      <tbody>
        {trips.map((trip) => (
          <tr key={trip.tripId}>
            <td>{trip.tripCode ?? '—'}</td>
            <td>{trip.departureDate ?? '—'}</td>
            <td>{trip.status ?? '—'}</td>
            <td>
              {trip.items.length === 0 ? <span>—</span> : trip.items.map((item) => (
                <div className="csc-debit-item csc-debit-item--ro" key={item.id}>
                  <span className="csc-debit-item__name">{label(item)}</span>
                  <span className="csc-debit-item__amount">{money(item.amount)}</span>
                  {item.thuKhach != null && <span className="csc-debit-otherfee__sell">Thu khách: {formatMoney(item.thuKhach)}</span>}
                  {item.invoiceNumber && <small className="csc-debit-item__hd">HD: {item.invoiceNumber}</small>}
                </div>
              ))}
            </td>
            <td>{money(trip.feeTotal)}</td>
            <td>Ngoài chốt</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
