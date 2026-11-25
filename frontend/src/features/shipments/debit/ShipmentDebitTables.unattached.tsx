// Card 20260924_3 — the L2 "chuyến chưa gán fulfillment" section. Display
// only by Director ruling: the trips' fees are visible but never chốt-able
// (L1 excludes their money since 855aef81; chotIncluded is false by
// construction). Renders nothing when the lot has no unattached trips.
import { LedgerMatrix } from '../../../components/shared/LedgerMatrix';
import { formatDate, formatMoney } from '../../../lib/format';
import type { ShipmentDebitDetail } from '../../../api/shipmentDebit';

const money = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? 'Chưa xác định' : formatMoney(value);

const label = (item: ShipmentDebitDetail['unattachedTrips'][number]['items'][number]) =>
  item.feeName ?? item.expenseType;

const UNATTACHED_STATUS_LABELS: Record<string, string> = {
  CREATED: 'Mới tạo',
  ASSIGNED: 'Đã điều xe',
  DISPATCHED: 'Đã phát lệnh',
  IN_TRANSIT: 'Đang chạy',
  IN_PROGRESS: 'Đang chạy',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
  CANCELED: 'Đã hủy',
};

function isInternalCode(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^(TRP|SHP)-/i.test(value.trim());
}

function unattachedDisplayKey(trip: ShipmentDebitDetail['unattachedTrips'][number]): string {
  const bill = trip.billOrBooking?.trim();
  if (bill && !isInternalCode(bill)) return bill;
  const customer = trip.customerName?.trim();
  const dateStr = trip.departureDate ? formatDate(trip.departureDate, { empty: '' }) : '';
  if (customer) return dateStr ? `${customer} · ${dateStr}` : customer;
  return '—';
}

export function UnattachedTripsTable({ trips }: { trips: ShipmentDebitDetail['unattachedTrips'] }) {
  if (trips.length === 0) return null;
  return (
    <div className="table-scroll">
      <LedgerMatrix className="csc-debit-table csc-debit-table--unattached"
    caption="Chuyến chưa gán đầu việc vận chuyển — chỉ hiển thị, không vào tổng chốt"
    columns={[
      { key: 'trip', label: 'Số Bill / Booking' }, { key: 'date', label: 'Ngày chạy', primary: true },
      { key: 'status', label: 'Trạng thái', primary: true }, { key: 'fees', label: 'Phí phát sinh', layout: 'full-width' },
      { key: 'total', label: 'Tổng phí chuyến', primary: true }, { key: 'close', label: 'Chốt', primary: true },
    ]}
    rows={trips.map((trip) => {
      const displayKey = unattachedDisplayKey(trip);
      const statusLabel = trip.status ? (UNATTACHED_STATUS_LABELS[trip.status] ?? trip.status) : '—';
      return {
        key: trip.tripId,
        title: displayKey,
        cells: [
          displayKey,
          trip.departureDate ? formatDate(trip.departureDate, { empty: '—' }) : '—',
          statusLabel,
          trip.items.length === 0 ? <span>—</span> : trip.items.map((item) => (
            <div className="csc-debit-item csc-debit-item--ro" key={item.id}>
              <span className="csc-debit-item__name">{label(item)}</span>
              <span className="csc-debit-item__amount">{money(item.amount)}</span>
              {item.thuKhach != null && <span className="csc-debit-otherfee__sell">Thu khách: {formatMoney(item.thuKhach)}</span>}
              {item.invoiceNumber && <small className="csc-debit-item__hd">HD: {item.invoiceNumber}</small>}
            </div>
          )),
          money(trip.feeTotal),
          'Ngoài chốt',
        ],
      };
    })}
      />
    </div>
  );
}
