import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Pin, PinOff, Plus, Search } from 'lucide-react';
import { useOpsOrders, useToggleShipmentPin, opsKeys } from '../hooks/useOpsQueries';
import type { OpsOrderItem } from '../api/opsClient';
import { OpsExpenseFormModal } from '../features/ops/OpsExpenseFormModal';
import { localDateInputValue, shipmentStatusText } from '../features/ops/opsStatus';
import './OpsOrdersPage.css';
import { OpsQueryFeedback } from '../features/ops/OpsQueryFeedback';
import { DateInput } from '../design-system/forms/DateInput';

/**
 * Kế hoạch làm hàng (OpsVanHanh §3): toàn bộ lô của công ty theo ngày giao
 * dự kiến, ghim cá nhân nổi trên đầu, khai chi phí ngay trong ngữ cảnh lô.
 */
export default function OpsOrdersPage() {
  const [date, setDate] = useState(localDateInputValue);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [expenseFor, setExpenseFor] = useState<OpsOrderItem | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isError, refetch } = useOpsOrders(date, search || undefined);
  const togglePin = useToggleShipmentPin();
  const queryClient = useQueryClient();

  const items = useMemo(() => data?.items ?? [], [data]);

  /** Optimistic pin: flip + float the row to the top immediately; the server
   * refetch on settle reconciles (PRD §3.2). */
  function handleTogglePin(order: OpsOrderItem) {
    const cacheKey = opsKeys.orders(date, search || undefined);
    const current = queryClient.getQueryData<{ date: string; items: OpsOrderItem[] }>(cacheKey);
    if (current && order.pinned) {
      queryClient.setQueryData(cacheKey, {
        ...current,
        items: current.items.map((item) =>
          item.id === order.id ? { ...item, pinned: false } : item,
        ),
      });
    } else if (current) {
      const updated: OpsOrderItem = { ...order, pinned: true, pinnedAt: new Date().toISOString() };
      queryClient.setQueryData(cacheKey, {
        ...current,
        items: [updated, ...current.items.filter((item) => item.id !== order.id)],
      });
    }
    void togglePin.mutateAsync({ shipmentId: order.id, pinned: !order.pinned }).catch(() => undefined);
  }

  return (
    <div className="ops-orders page-shell">
      <header className="ops-orders__bar">
        <h1>Kế hoạch làm hàng</h1>
        <div className="ops-orders__controls">
          <label className="ops-orders__date">
            <CalendarDays size={15} aria-hidden />
            <DateInput
              value={date}
              onChange={setDate}
              aria-label="Ngày giao dự kiến"
            />
          </label>
          <label className="ops-orders__search">
            <Search size={15} aria-hidden />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Mã lô · Khách hàng · Số cont"
              aria-label="Tìm kiếm"
            />
          </label>
        </div>
      </header>

      <p className="ops-orders__meta">
        {isLoading ? 'Đang tải…' : `${items.length} lô · ngày ${date}`}

      </p>

      <div className="ops-orders__scroll">
        <table className="tt-table ops-orders__table">
          <thead>
            <tr>
              <th className="col-pin" aria-label="Ghim" />
              <th scope="col" className="col-code">Mã lô</th>
              <th scope="col">Khách hàng</th>
              <th scope="col">Tuyến</th>
              <th scope="col">Cont</th>
              <th scope="col">Bill / Booking</th>
              <th scope="col">Trạng thái</th>
              <th className="col-actions" aria-label="Thao tác" />
            </tr>
          </thead>
          <tbody>
            {items.map((order) => {
              const status = shipmentStatusText(order.status);
              return (
                <tr key={order.id} className={`ops-orders__row${order.pinned ? ' is-pinned' : ''}`}>
                  <td className="col-pin">
                    <button
                      type="button"
                      className={`ops-pin${order.pinned ? ' is-on' : ''}`}
                      onClick={() => handleTogglePin(order)}
                      aria-pressed={order.pinned}
                      aria-label={order.pinned ? `Bỏ ghim ${order.shipmentCode ?? ''}` : `Ghim ${order.shipmentCode ?? ''}`}
                    >
                      {order.pinned ? <Pin size={15} /> : <PinOff size={15} />}
                    </button>
                  </td>
                  <td className="col-code" data-label="Mã lô">{order.shipmentCode ?? '—'}</td>
                  <td className="col-customer" data-label="Khách hàng">{order.customerName ?? '—'}</td>
                  <td className="col-route" data-label="Tuyến">{order.routeName ?? <span className="ops-orders__route-missing">Chưa có tuyến đường</span>}</td>
                  <td data-label="Container">
                    {order.containerCount === 0
                      ? '—'
                      : `${order.containerCount} · ${order.containerNumbers.join(', ')}`}
                  </td>
                  <td data-label="Bill / Booking">{order.billRef ?? '—'}</td>
                  <td data-label="Trạng thái"><span style={{ color: status.color }}>{status.label}</span></td>
                  <td className="col-actions">
                    <button type="button" className="btn btn--secondary btn--sm ops-orders__expense" onClick={() => setExpenseFor(order)}>
                      <Plus size={14} /> Khai chi phí
                    </button>
                  </td>
                </tr>
              );
            })}
            {!isLoading && !isError && items.length === 0 && (
              <tr><td colSpan={8} className="ops-orders__empty">Không có lô hàng trong ngày này.</td></tr>
            )}
          </tbody>
        </table>
        <OpsQueryFeedback loading={isLoading} error={isError} label="kế hoạch làm hàng" onRetry={refetch} />
      </div>

      {expenseFor && <OpsExpenseFormModal order={expenseFor} onClose={() => setExpenseFor(null)} />}
    </div>
  );
}
