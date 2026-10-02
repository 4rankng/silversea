import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { canManageShipmentDebit } from '../lib/role-access';
import { useQuery } from '@tanstack/react-query';
import { useQueuedSearchParams } from '../hooks/useQueuedSearchParams';
import { tripClient } from '../api/tripClient';
import { listShipmentDebitSummary, type ShipmentDebitLotRow } from '../api/shipmentClient';
import { createDebitNoteBatch, exportDebitNoteFile } from '../api/shipmentDebit';
import { useToast } from '../components/shared/Toast';
import { ApiError } from '../lib/api';
import { qk } from '../api/keys';
import { formatMoney } from '../lib/format';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { Skeleton } from '../components/shared/Skeleton';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { EmptyState, SearchableSelect } from '../design-system';
import { ShipmentDebitRibbon } from '../features/shipments/ShipmentDebitRibbon';
import { ShipmentDebitWorkspace } from '../features/shipments/debit/ShipmentDebitWorkspace';
import './ShipmentDebitPage.css';

/** sessionStorage key for the L2 open-state restore (reload persistence). */
const EXPANDED_LOT_KEY = 'shipment-debit.expanded-lot';

/** A 409 from the batched issue call can carry the selection's lot codes that
 *  are already inside an issued debit note — surface exactly those, falling
 *  back to the generic failure message when the body shape is unexpected. */
function overlappingLotCodesFrom(cause: unknown): string[] | null {
  if (!(cause instanceof ApiError) || cause.status !== 409) return null;
  const raw = cause.raw as { overlappingLotCodes?: unknown } | null;
  const codes = raw?.overlappingLotCodes;
  if (!Array.isArray(codes)) return null;
  const known = codes
    .filter((code): code is string | number => typeof code === 'string' || typeof code === 'number')
    .map(String);
  return known.length > 0 ? known : null;
}

/** Lot-level settlement row (L1) — identity, money rollup, lock state.
 *  Nine columns per the customer drawing: the pick tick lives INSIDE the
 *  first cell beside [+] (no tenth column), TỔNG PHẢI TRẢ rides its own
 *  wire field — null stays "Chưa xác định", never derived, never 0. */
function DebitLotRow({
  row, expanded, onToggle, onSaved, selected, onSelect, canManage,
}: {
  row: ShipmentDebitLotRow;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
  selected: boolean;
  onSelect: (id: number, next: boolean) => void;
}) {
  // Identity renders from business keys only — DB ids and id-derived codes
  // never surface as user-visible text; absent keys collapse to '—'.
  const lotLabel = row.billOrBookNumber || row.customsNumber || '—';
  return (
    <>
    <tr
      className="shipment-debit-row"
      data-locked={row.lockStatus === 'LOCKED' ? '' : undefined}
      data-selected={selected || undefined}
      onClick={() => { if (canManage && row.lockStatus === 'LOCKED') onSelect(row.shipmentId, !selected); }}
    >
      <td className="shipment-debit-row__lead">
        {canManage ? <button
          type="button"
          className="shipment-debit-row__expand-button"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Đóng' : 'Mở'} chi tiết lô ${lotLabel}`}
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
        >
          {expanded ? '−' : '+'}
        </button> : <span aria-label="Chỉ xem tổng hợp">—</span>}
      </td>
      <td className="shipment-debit-row__identity">
        <span className="shipment-debit-row__code">{lotLabel}</span>
        <strong className="shipment-debit-row__customer">{row.customerName?.toUpperCase()}</strong>
        {row.factoryName && <span className="shipment-debit-row__factory">({row.factoryName})</span>}
        {row.factoryAddress && <span className="shipment-debit-row__address"><em>{row.factoryAddress}</em></span>}
      </td>
      <td className="shipment-debit-row__docs">
        <span><small>Số Bill:</small> {row.billOrBookNumber ?? 'Chưa có'}</span>
        <span><small>Số tờ khai:</small> {row.customsNumber ?? 'Chưa có'}</span>
        {row.shipmentId && (
          <Link
            to={`/shipments/${row.shipmentId}`}
            className="shipment-debit-row__detail-link"
            title="Xem chi tiết lô hàng"
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '4px', fontSize: '12px', color: 'var(--color-primary, #059669)', textDecoration: 'underline' }}
          >
            Chi tiết lô hàng →
          </Link>
        )}
      </td>
      <td className="shipment-debit-row__money">{row.freightAuto == null ? 'Chưa xác định' : formatMoney(row.freightAuto)}</td>
      <td className="shipment-debit-row__money">{row.chiHoTotal == null ? 'Chưa xác định' : formatMoney(row.chiHoTotal)}</td>
      <td className="shipment-debit-row__money shipment-debit-row__money--strong">{row.receivableTotal == null ? 'Chưa xác định' : formatMoney(row.receivableTotal)}</td>
      <td className="shipment-debit-row__money">{row.payableTotal == null ? 'Chưa xác định' : formatMoney(row.payableTotal)}</td>
      <td className="shipment-debit-row__money">{row.profit == null ? 'Chưa xác định' : formatMoney(row.profit)}</td>
      <td>
        {row.lockStatus === 'LOCKED'
          ? <span className="shipment-debit-row__lock shipment-debit-row__lock--locked">Đã khóa</span>
          : <span className="shipment-debit-row__lock shipment-debit-row__lock--open">Đang mở</span>}
      </td>
    </tr>
      {canManage && expanded && (
        <tr className="shipment-debit-expand">
          <td colSpan={9}>
            {/* Card _202: the fee catalog keys off the ROW's customer — the
                list can span customers, so the page's filter is not the truth. */}
            <ShipmentDebitWorkspace shipmentId={row.shipmentId} customerId={row.customerId} locked={row.lockStatus === 'LOCKED'} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  );
}

export function ShipmentDebitPage() {
  const { user } = useAuth();
  const canManage = canManageShipmentDebit(user?.role);
  const [params, setSearchParams] = useQueuedSearchParams();
  const updateParam = (key: string, value: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value) next.delete(key);
      else next.set(key, value);
      return next;
    });
  };
  const customerId = params.get('customer') ?? '';
  const deliveryFrom = params.get('from') ?? '';
  const deliveryTo = params.get('to') ?? '';
  const lockStatus = (params.get('lock') ?? 'ALL') as 'ALL' | 'OPEN' | 'LOCKED';

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [issuing, setIssuing] = useState(false);
  const { toast } = useToast();

  // Xuất Debit Note: ONE issue call carries every selected locked lot id and
  // the backend builds the union document (per-lot line grouping preserved
  // inside). The idempotency key derives from the sorted selection, so
  // re-clicking the same selection replays the same document instead of
  // issuing a duplicate.
  async function exportSelectedLockedLots() {
    const ids = items
      .filter((row) => selectedIds.has(row.shipmentId) && row.lockStatus === 'LOCKED')
      .map((row) => row.shipmentId);
    if (!canManage || ids.length === 0 || issuing) return;
    setIssuing(true);
    try {
      const selectionKey = `debit-note-${[...ids].sort((x, y) => x - y).join('-')}`;
      const { id: documentId } = await createDebitNoteBatch(ids, selectionKey);
      const blob = await exportDebitNoteFile(ids[0], documentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `giay-bao-no-${items.find((row) => row.shipmentId === ids[0])?.billOrBookNumber || 'chua-xac-dinh'}.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (cause) {
      // The 409 body carries internal lot codes; the conflict names resolve
      // through the loaded rows so the toast can name the lots by their
      // business key (max 3, then a +n count) without echoing system codes.
      const overlapping = overlappingLotCodesFrom(cause);
      const labelByCode = new Map<string, string>();
      for (const row of items) {
        const label = row.billOrBookNumber || row.customsNumber;
        if (!label) continue;
        labelByCode.set(String(row.code), label);
        labelByCode.set(String(row.shipmentId), label);
      }
      const labels = (overlapping ?? [])
        .map((code) => labelByCode.get(String(code)))
        .filter((label): label is string => Boolean(label));
      const total = overlapping?.length ?? 0;
      const shown = labels.slice(0, 3);
      const named = shown.join(', ');
      const rest = total - shown.length;
      toast(overlapping
        ? { kind: 'error', message: named
          ? `Các lô đã nằm trong Debit Note đã xuất: ${named}${rest > 0 ? ` +${rest}` : ''}`
          : 'Một số lô đã chọn đã nằm trong Debit Note đã xuất. Vui lòng bỏ chọn các lô đó rồi xuất lại.' }
        : { kind: 'error', message: 'Không xuất được Debit Note. Vui lòng thử lại.' });
    } finally {
      setIssuing(false);
    }
  }
  // L2 open state survives a reload within the session (card _11): the open
  // lot id rides sessionStorage and is restored on mount. A stored id that no
  // longer matches the visible list simply expands nothing.
  const [expandedId, setExpandedId] = useState<number | null>(() => {
    const stored = sessionStorage.getItem(EXPANDED_LOT_KEY);
    if (stored == null || !Number.isFinite(Number(stored))) return null;
    return Number(stored);
  });
  const toggleExpandedLot = (id: number) => {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next == null) sessionStorage.removeItem(EXPANDED_LOT_KEY);
    else sessionStorage.setItem(EXPANDED_LOT_KEY, String(next));
  };

  const bootstrap = useQuery({ queryKey: qk.shipmentDebit.bootstrap, queryFn: () => tripClient.getBootstrap() });
  const summary = useQuery({
    queryKey: qk.shipmentDebit.summary(customerId, deliveryFrom, deliveryTo, lockStatus),
    // Card _202: an empty customer means EVERY customer, so the list always
    // loads — the screen never opens on an empty face.
    queryFn: () => listShipmentDebitSummary({
      customerId: customerId === '' ? null : Number(customerId),
      deliveryDateFrom: deliveryFrom || null,
      deliveryDateTo: deliveryTo || null,
      lockStatus,
    }),
  });

  const customers = bootstrap.data?.customers ?? [];
  const items = summary.data?.items ?? [];
  const anyLockedSelected = items.some((row) => selectedIds.has(row.shipmentId) && row.lockStatus === 'LOCKED');
  // The ribbon is presentational, so the API shape is mapped to the shared
  // combobox options here and the URL semantics stay on this side too
  // (card 20260927_153).
  const customerOptions = customers.map((customer) => ({
    value: String(customer.id),
    label: customer.fullName ? `${customer.name} - ${customer.fullName}` : customer.name,
    searchText: `${customer.name} ${customer.fullName ?? ''}`,
  }));
  // The picker's own wording, so the hint never echoes an id back at the user.
  const selectedCustomerLabel = customerOptions.find((option) => option.value === customerId)?.label ?? '';

  return (
    <div className="shipment-debit-page data-workspace">
      <Breadcrumbs items={[{ label: 'Tổng quan lô hàng', to: '/shipments' }, { label: 'Chi phí - Quyết toán' }]} />
      {!canManage && <Alert variant="info">Chế độ chỉ xem tổng hợp. Tài khoản này không có quyền mở chi tiết hoặc xuất Debit Note.</Alert>}
      {summary.isError && <Alert variant="error">Không thể tải danh sách quyết toán. Vui lòng thử lại.</Alert>}

      <section className="shipment-debit-workspace" aria-label="Danh sách lô quyết toán" aria-busy={summary.isFetching}>
        {/* Card _202: Row 1 is title + Xuất Debit Note (a per-customer action, so
            it stays disabled until one customer is in scope); Row 2 is the
            PROMOTED Khách hàng picker — the screen's primary axis, always
            visible, never folded into `Bộ lọc`; Row 3 is the shared filter
            strip (card 20260927_153) with the range and the lock criterion. */}
        <header className="shipment-debit-header" data-component="shipment-debit-header">
          <h1 className="shipment-debit-header__title">Chi phí - Quyết toán</h1>
          {canManage && (
            <span className="shipment-debit-header__export" title={!customerId ? 'Vui lòng chọn khách hàng để xuất Debit Note' : undefined}>
              <UUIButton
                className="shipment-debit-export"
                size="sm"
                color="tertiary"
                isDisabled={!customerId || !anyLockedSelected || issuing}
                onPress={() => { void exportSelectedLockedLots(); }}
              >
                Xuất Debit Note
              </UUIButton>
            </span>
          )}
        </header>
        <div className="shipment-debit-customer-bar">
          <SearchableSelect
            id="shipment-debit-customer"
            className="shipment-debit-customer-bar__picker"
            value={customerId}
            onChange={(value) => { setSelectedIds(new Set()); updateParam('customer', value || null); }}
            options={customerOptions}
            placeholder="Tất cả khách hàng"
            searchPlaceholder="Tìm khách hàng…"
            emptyMessage="Không tìm thấy khách hàng phù hợp."
            clearable clearLabel="Xem tất cả khách hàng" size="sm"
          />
          <p className="shipment-debit-customer-bar__hint">
            {customerId === ''
              ? 'Đang xem tất cả khách hàng. Chọn một khách để thu hẹp danh sách.'
              : `Đang xem lô của ${selectedCustomerLabel}.`}
          </p>
        </div>
        {/* Card 20260927_153: the filter strip owns its own layout and every
            control width (FilterBar.css L1-L3), so the page hands it criteria
            values and URL writers only — no filter rule, no applied-count and
            no reset markup lives here. The customer left the strip in _202. */}
        <ShipmentDebitRibbon
          deliveryFrom={deliveryFrom}
          deliveryTo={deliveryTo}
          lockStatus={lockStatus}
          onLockChange={(key) => { setSelectedIds(new Set()); updateParam('lock', key === 'ALL' ? null : key); }}
          onDeliveryRangeChange={({ from, to }) => { updateParam('from', from || null); updateParam('to', to || null); }}
          onResetSecondary={() => { setSelectedIds(new Set()); updateParam('lock', null); }}
          onClear={() => {
            setSelectedIds(new Set());
            updateParam('from', null);
            updateParam('to', null);
            updateParam('lock', null);
          }}
        />
        {summary.isPending ? (
          <Skeleton height={320} />
        ) : items.length === 0 && !summary.isError ? (
          <EmptyState illustration="finance" title="Không có lô nào" description="Không có lô nào khớp bộ lọc hiện tại." />
        ) : (
          <>
            {/* Card 20260924_2 F1 shadow line (BE 855aef81; FE half per BE spec):
                fees on fulfillment-NULL trips stay out of chốt — say so plainly
                instead of a silent gap. Hidden at zero; red needs-attention ink
                now lives in the class rule. It sits BESIDE the scroll box
                (card 20260924_9): inside the overflow-x wrap the line rode the
                table's sideways scroll and its tail clipped at the right edge. */}
            {(summary.data?.excludedCount ?? 0) > 0 && (
              <p className="shipment-debit-shadow-line" role="status">
                {summary.data?.excludedCount} chuyến chưa gán đầu việc vận chuyển — {formatMoney(Number(summary.data?.excludedSum ?? '0'))} ₫ chưa vào chốt
              </p>
            )}
            <div className="shipment-debit-table-wrap">
            <table className="shipment-debit-table">
              <thead>
                <tr>
                  <th scope="col" className="shipment-debit-col--lead"><span className="sr-only">{canManage ? 'Chọn và mở rộng' : 'Chỉ xem'}</span></th>
                  <th scope="col" className="shipment-debit-col--text">THÔNG TIN LÔ HÀNG</th>
                  <th scope="col" className="shipment-debit-col--docs">Chứng từ</th>
                  <th scope="col" className="shipment-debit-col--money shipment-debit-col--freight">CƯỚC VẬN TẢI (Auto)</th>
                  <th scope="col" className="shipment-debit-col--money shipment-debit-col--chiho">TỔNG CHI HỘ</th>
                  <th scope="col" className="shipment-debit-col--money shipment-debit-col--receivable">TỔNG PHẢI THU KHÁCH</th>
                  <th scope="col" className="shipment-debit-col--money shipment-debit-col--payable">TỔNG PHẢI TRẢ</th>
                  <th scope="col" className="shipment-debit-col--money shipment-debit-col--profit">LỢI NHUẬN</th>
                  <th scope="col" className="shipment-debit-col--status">TRẠNG THÁI</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <DebitLotRow
                    key={row.shipmentId}
                    row={row}
                    canManage={canManage}
                    expanded={canManage && expandedId === row.shipmentId}
                    onToggle={() => toggleExpandedLot(row.shipmentId)}
                    onSaved={() => summary.refetch()}
                    selected={selectedIds.has(row.shipmentId)}
                    onSelect={(id, next) => setSelectedIds((current) => {
                      const set = new Set(current);
                      if (next) set.add(id); else set.delete(id);
                      return set;
                    })}
                  />
                ))}
              </tbody>
            </table>
            </div>
            {/* Scroll cue (card 20260924_9): the table's word-wrap min-width
                floor makes the wrap scroll sideways on phones — say so plainly;
                the hint stays hidden at desktop widths (page CSS). */}
            <p className="shipment-debit-scroll-hint">Bảng cuộn ngang — dùng ← → hoặc vuốt để xem đủ cột.</p>
          </>
        )}
      </section>
    </div>
  );
}

export default ShipmentDebitPage;
