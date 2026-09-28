// Card _37 drawer histories (BE endpoints by the BE lane, 4607fa20) — extracted
// from CustomersPage to hold its line ceiling (card 20260928_177).
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Money } from '../../components/shared/Money';


interface CustomerLogisticsItem {
  id: number; shipmentCode: string; blNumber: string | null; bookingRef: string | null;
  status: string; tradeDirection: string | null; expectedDeliveryDate: string | null; createdAt: string;
}
interface CustomerPaymentItem {
  id: number; timestamp: string; txnType: string; receiptId: number | null;
  credit: string | null; debit: string | null; balance: string | null; note: string | null;
}

/** Slide-over history sections for the row drawer. Wired against the BE
 * history endpoints (ADMIN/MANAGER/ACCOUNTANT only); numerics arrive as
 * drizzle strings and coerce on render. */
export function CustomerDrawerHistories({ customerId }: { customerId: number }) {
  const [logistics, setLogistics] = useState<CustomerLogisticsItem[] | null>(null);
  const [payments, setPayments] = useState<CustomerPaymentItem[] | null>(null);
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLogistics(null); setPayments(null); setOutstanding(null); setFailed(false);
    // lib/api resolves the parsed JSON body directly (no .data wrapper).
    api.get(`/customers/${customerId}/logistics-history?limit=5`).then(
      (r: unknown) => { if (alive) setLogistics((r as { items?: CustomerLogisticsItem[] })?.items ?? []); },
      () => { if (alive) setFailed(true); },
    );
    api.get(`/customers/${customerId}/payment-history?limit=5`).then(
      (r: unknown) => {
        if (!alive) return;
        const body = r as { items?: CustomerPaymentItem[]; outstanding?: string | number };
        setPayments(body?.items ?? []);
        setOutstanding(body?.outstanding != null ? Number(body.outstanding) : null);
      },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [customerId]);

  if (failed) return <p style={{ color: 'var(--ink-3)', margin: 0 }}>Không tải được lịch sử.</p>;
  return (
    <>
      <dl className="customers-drawer__section">
        <dt>Công nợ phải thu (AR)</dt>
        <dd style={outstanding != null && outstanding > 0 ? { color: 'var(--warning-text)' } : undefined}>
          {outstanding != null ? <Money value={outstanding} /> : '…'}
        </dd>
      </dl>
      <dl className="customers-drawer__section">
        <dt>Đơn logistics gần đây</dt>
        {logistics == null ? <dd>…</dd> : logistics.length === 0 ? <dd>—</dd> : logistics.map((item) => (
          <dd key={item.id} style={{ fontWeight: 400 }}>
            {item.shipmentCode}{item.blNumber ? ` · ${item.blNumber}` : ''} — {item.status}
            {item.expectedDeliveryDate ? ` · giao ${item.expectedDeliveryDate.slice(0, 10)}` : ''}
          </dd>
        ))}
      </dl>
      <dl className="customers-drawer__section">
        <dt>Thanh toán gần đây</dt>
        {payments == null ? <dd>…</dd> : payments.length === 0 ? <dd>—</dd> : payments.map((item) => (
          <dd key={item.id} style={{ fontWeight: 400 }}>
            {item.timestamp.slice(0, 10)} · {item.note || item.txnType} ·{' '}
            {Number(item.credit ?? 0) > 0 ? `+${Number(item.credit).toLocaleString('vi-VN')}` : `-${Number(item.debit ?? 0).toLocaleString('vi-VN')}`}
            {item.balance != null ? ` · còn lại ${Number(item.balance).toLocaleString('vi-VN')}` : ''}
          </dd>
        ))}
      </dl>
    </>
  );
}
