import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pin, PinOff, Plus } from 'lucide-react';
import { useOpsOrders, useToggleShipmentPin, opsKeys } from '../hooks/useOpsQueries';
import type { OpsOrderItem } from '../api/opsClient';
import { OpsExpenseFormModal } from '../features/ops/OpsExpenseFormModal';
import { localDateInputValue, shipmentStatusText, opsBillReference } from '../features/ops/opsStatus';
import './OpsOrdersPage.css';
import { OpsQueryFeedback } from '../features/ops/OpsQueryFeedback';
import { BufferedUuiDateInput, FilterBar } from '../design-system';
import { formatDate } from '../lib/format';
import { useToast } from '../components/shared/Toast';
import { toastActionError } from '../lib/api/action-error';
import { restoreFocusTo } from '../lib/focusRestore';

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
  const { toast } = useToast();
  const pinSavingRef = useRef(false);
  const [pendingPinId, setPendingPinId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  // SIL-575: ref-map keyed by order id so focus can follow the toggled button
  // across the optimistic re-sort.
  const pinButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const pinFocusOrderIdRef = useRef<number | null>(null);

  const items = useMemo(() => data?.items ?? [], [data]);

  // SIL-575: the optimistic re-sort moves the toggled button's DOM node and
  // drops keyboard focus to <body> (the old `disabled` pass blurred it
  // mid-flight too). Restore focus to the same order's button once the toggle
  // settles — but never steal focus the user moved elsewhere.
  useEffect(() => {
    const orderId = pinFocusOrderIdRef.current;
    if (orderId == null || pendingPinId != null) return;
    const button = pinButtonRefs.current.get(orderId);
    const active = document.activeElement;
    const focusLost = !active || active === document.body;
    if (button?.isConnected && focusLost) {
      restoreFocusTo(button);
      pinFocusOrderIdRef.current = null;
    } else if (button?.isConnected || !focusLost) {
      // focus survived the re-sort, or the user moved on — leave it alone
      pinFocusOrderIdRef.current = null;
    }
  }, [items, pendingPinId]);

  /** Optimistic pin: flip + float the row to the top immediately; the server
   * refetch on settle reconciles (PRD §3.2). */
  async function handleTogglePin(order: OpsOrderItem) {
    if (pinSavingRef.current) return;
    pinSavingRef.current = true;
    pinFocusOrderIdRef.current = order.id;
    setPendingPinId(order.id);
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
    try {
      await togglePin.mutateAsync({ shipmentId: order.id, pinned: !order.pinned });
    } catch (error) {
      if (current) queryClient.setQueryData(cacheKey, current);
      toastActionError(toast, 'ghim lệnh', error, 'Không lưu được ghim. Vui lòng thử lại.');
    } finally {
      pinSavingRef.current = false;
      setPendingPinId(null);
    }
  }

  return (
    <div className="ops-orders page-shell">
      <header className="ops-orders__bar">
        <h1>Kế hoạch làm hàng</h1>
      </header>

      {/* Card 20260927_152: the filters are the ONE shared strip — the search
          takes the bar's own cell, the expected-delivery day is the shared
          labelled date field beside it, and no page rule sizes either one. */}
      <FilterBar
        search={{
          value: searchInput,
          onChange: setSearchInput,
          placeholder: 'Bill/Booking · Khách hàng · Số cont',
          ariaLabel: 'Tìm kiếm',
        }}
      >
        <BufferedUuiDateInput
          label="Ngày giao dự kiến"
          size="sm"
          value={date}
          onChange={setDate}
        />
      </FilterBar>

      <p className="ops-orders__meta">
        {isLoading ? 'Đang tải…' : `${items.length} lô · ngày ${formatDate(date)}`}

      </p>

      <div className="ops-orders__scroll">
        <table className="tt-table ops-orders__table">
          <thead>
            <tr>
              <th className="col-pin" aria-label="Ghim" />
              <th scope="col" className="col-code">Bill / Booking</th>
              <th scope="col">Khách hàng</th>
              <th scope="col">Tuyến</th>
              <th scope="col">Cont</th>
              <th scope="col">Trạng thái</th>
              <th className="col-actions" aria-label="Thao tác" />
            </tr>
          </thead>
          <tbody>
            {items.map((order) => {
              const status = shipmentStatusText(order.status);
              const pinKey = opsBillReference(order.billRef);
              return (
                <tr key={order.id} className={`ops-orders__row${order.pinned ? ' is-pinned' : ''}`}>
                  <td className="col-pin">
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) pinButtonRefs.current.set(order.id, element);
                        else pinButtonRefs.current.delete(order.id);
                      }}
                      className={`ops-pin${order.pinned ? ' is-on' : ''}`}
                      onClick={() => void handleTogglePin(order)}
                      aria-disabled={pendingPinId !== null}
                      aria-busy={pendingPinId === order.id}
                      aria-pressed={order.pinned}
                      aria-label={order.pinned ? `Bỏ ghim ${pinKey}` : `Ghim ${pinKey}`}
                    >
                      {order.pinned ? <Pin size={15} /> : <PinOff size={15} />}
                    </button>
                  </td>
                  <td className="col-code" data-label="Bill / Booking">{opsBillReference(order.billRef)}</td>
                  <td className="col-customer" data-label="Khách hàng">{order.customerName ?? <span className="ops-orders__route-missing">Chưa có khách hàng</span>}</td>
                  <td className="col-route" data-label="Tuyến">{order.routeName ?? <span className="ops-orders__route-missing">Chưa có tuyến đường</span>}</td>
                  <td data-label="Container">
                    {order.containerCount === 0
                      ? <span className="ops-orders__route-missing">Chưa có cont</span>
                      : order.containerNumbers.length > 0
                        ? `${order.containerCount} · ${order.containerNumbers.join(', ')}`
                        // SIL-601 (id 702): an LCL lot is 1 lô cont 1 cont —
                        // print the count (old wire without cargoMode falls
                        // back to the same count-without-numbers shape).
                        : `${order.containerCount} cont`}
                  </td>
                  <td data-label="Trạng thái"><span style={{ color: status.color }}>{status.label}</span></td>
                  <td className="col-actions">
                    <button type="button" className="btn btn--primary btn--sm ops-orders__expense" onClick={() => setExpenseFor(order)}>
                      <Plus size={14} /> Khai chi phí
                    </button>
                  </td>
                </tr>
              );
            })}
            {!isLoading && !isError && items.length === 0 && (
              <tr><td colSpan={7} className="ops-orders__empty">
                {search ? <><p>Không có lô hàng phù hợp với từ khóa trong ngày đã chọn.</p><button type="button" className="btn btn--secondary btn--sm" onClick={() => { setSearchInput(''); setSearch(''); }}>Xóa tìm kiếm</button></> : 'Không có lô hàng trong ngày này.'}
              </td></tr>
            )}
          </tbody>
        </table>
        <OpsQueryFeedback loading={isLoading} error={isError} label="kế hoạch làm hàng" onRetry={refetch} />
      </div>

      {expenseFor && <OpsExpenseFormModal order={expenseFor} onClose={() => setExpenseFor(null)} />}
    </div>
  );
}
