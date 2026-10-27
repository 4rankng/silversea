import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { canManageShipmentDebit } from '../lib/role-access';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueuedSearchParams } from '../hooks/useQueuedSearchParams';
import { tripClient } from '../api/tripClient';
import { listShipmentDebitSummary, type ShipmentDebitLotRow } from '../api/shipmentClient';
import { createDebitNoteBatch, exportDebitNoteFile } from '../api/shipmentDebit';
import { useToast } from '../components/shared/Toast';
import { ApiError } from '../lib/api';
import { qk } from '../api/keys';
import { formatMoney, formatWeight, formatVolumeCbm } from '../lib/format';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { Skeleton } from '../components/shared/Skeleton';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { DisabledActionTip } from '../components/shared/DisabledActionTip';
import { LclMergeModeToggle } from '../components/shared/LclMergeModeToggle';
import { EmptyState } from '../design-system';
import { ShipmentDebitRibbon } from '../features/shipments/ShipmentDebitRibbon';
import { DebitLotTable } from '../features/shipments/debit/DebitLotTable';
import { ShipmentDebitRecords } from '../features/shipments/debit/ShipmentDebitRecords';
import { MergeRevGroupDialog } from '../features/shipments/debit/MergeRevGroupDialog';
import { sumMoneyStates, moneyState } from '../features/shipments/debit/debitMoney';
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

/** The filtered list's column totals — the tfoot's numbers, reused by the
 *  phone summary strip (owner redesign 23/10: a settlement board MUST show
 *  its totals; gate asserts they equal the sum of the rendered cells). */
function listTotals(items: ShipmentDebitLotRow[]) {
  return {
    count: items.length,
    receivable: sumMoneyStates(items.map((row) => moneyState(row.receivableTotal))),
    payable: sumMoneyStates(items.map((row) => moneyState(row.payableTotal))),
    profit: sumMoneyStates(items.map((row) => moneyState(row.profit))),
  };
}

export function ShipmentDebitPage() {
  const { user } = useAuth();
  const canManage = canManageShipmentDebit(user?.role);
  const phone = useMediaQuery('(max-width: 640px)');
  const print = useMediaQuery('print');
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
  // SIL-538 (PRD 261023110000 §2) — the CHỌN column is on-demand: default OFF
  // hides the ticks (and the row's select-alias); [📦 Gộp hàng] on the filter
  // strip reveals them with the floating bar, and completing a merge — or
  // [✕ Thoát gộp hàng] — hides them again. Leaving the mode always drops the
  // picks so a reopened mode never shows a stale floating bar.
  const [mergeMode, setMergeMode] = useState(false);
  const exitMergeMode = () => {
    setMergeMode(false);
    setSelectedIds(new Set());
  };
  const [issuing, setIssuing] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  // Case 2026-10-17 — the shadow line's trip list (open state is the user's;
  // a filter change keeps it where it was, the rows just re-render).
  const [shadowOpen, setShadowOpen] = useState(false);
  const { toast } = useToast();

  // Xuất Debit Note: ONE issue call carries every selected locked lot id and
  // the backend builds the union document (per-lot line grouping preserved
  // inside). The idempotency key is derived inside the client from the sorted
  // selection, so re-clicking the same selection replays the same document
  // instead of issuing a duplicate.
  async function exportSelectedLockedLots() {
    const ids = items
      .filter((row) => selectedIds.has(row.shipmentId) && row.lockStatus === 'LOCKED')
      .map((row) => row.shipmentId);
    // Guard mirrors the button's disable causes (sweep card 20261008_1):
    // aria-disabled does not block clicks the way `disabled` did.
    if (!canManage || !customerId || ids.length === 0 || issuing) return;
    setIssuing(true);
    try {
      const { id: documentId } = await createDebitNoteBatch(ids);
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
  const queryClient = useQueryClient();
  const [ratesRefreshing, setRatesRefreshing] = useState(false);
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
  /** FB-145 (design direction 24/10) — the [Tách nhóm] refresh: invalidate
   *  the money query IMMEDIATELY and pending-pill the money cells until the
   *  fresh board lands, so the pre-tách 0₫ never repaints. */
  const refreshRates = () => {
    setRatesRefreshing(true);
    void (async () => {
      try {
        await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.summary(customerId, deliveryFrom, deliveryTo, lockStatus), refetchType: 'none' });
        await summary.refetch();
      } finally {
        setRatesRefreshing(false);
      }
    })();
  };

  const customers = bootstrap.data?.customers ?? [];
  const items = summary.data?.items ?? [];
  // Case 2026-10-17 — the identities behind the red line; absent on a skewed
  // backend, which renders the plain line with no dead toggle.
  const shadowTrips = summary.data?.excludedTrips ?? [];
  const anyLockedSelected = items.some((row) => selectedIds.has(row.shipmentId) && row.lockStatus === 'LOCKED');
  // FB-093 — the merge works on the SELECTION. Only ungrouped LCL lots may
  // join a new group; the same-customer gate runs in the dialog and server.
  const selectedRows = items.filter((row) => selectedIds.has(row.shipmentId));
  const mergeableRows = selectedRows.filter((row) => row.cargoMode === 'LCL' && row.revGroupId == null);
  // GP-01 — the "Tổng X tấn | Y CBM" clause, computed like the ĐV bar from
  // the wire's cargo measures. A measure no selected lot carries drops from
  // the clause entirely — never a fabricated 0 (testplan GP-01 case 3).
  const selectionMeasureClause = (() => {
    let weight = 0;
    let volume = 0;
    let hasWeight = false;
    let hasVolume = false;
    for (const row of selectedRows) {
      const kg = Number(row.cargoWeightKg);
      if (row.cargoWeightKg != null && Number.isFinite(kg)) { weight += kg; hasWeight = true; }
      const cbm = Number(row.cargoVolumeCbm);
      if (row.cargoVolumeCbm != null && Number.isFinite(cbm)) { volume += cbm; hasVolume = true; }
    }
    return [
      hasWeight ? formatWeight(String(weight)) : null,
      hasVolume ? formatVolumeCbm(String(volume)) : null,
    ].filter(Boolean).join(' | ');
  })();
  // SIL-538 (PRD 261023110000 §2) — [Gộp hàng] opens from the mode's floating
  // bar (the header keeps only Xuất Debit Note); it arms at ≥2 valid picks.
  const mergeDisabledReason = mergeableRows.length < 2
    ? 'Chọn ít nhất 2 lô lẻ chưa ghép cước để ghép.'
    : null;
  const mergeDisabled = mergeDisabledReason != null;
  // FB-093 + card 161026232409: BKS suggestions for the PHÂN XE quick edit and
  // the merge dialog's "BKS báo khách (ảo)" field.
  const plateOptions = (() => {
    const plates = new Set<string>();
    for (const truck of (bootstrap.data?.trucks ?? [])) {
      if (truck.licensePlate?.trim()) plates.add(truck.licensePlate.trim());
    }
    for (const row of items) {
      for (const plate of [row.actualTruckNo, row.billingTruckNo]) {
        if (plate?.trim()) plates.add(plate.trim());
      }
    }
    return [...plates].map((plate) => ({ value: plate, label: plate, searchText: plate }));
  })();
  // The ribbon is presentational, so the API shape is mapped to the shared
  // combobox options here and the URL semantics stay on this side too
  // (card 20260927_153).
  const customerOptions = customers.map((customer) => ({
    value: String(customer.id),
    label: customer.fullName ? `${customer.name} - ${customer.fullName}` : customer.name,
    searchText: `${customer.name} ${customer.fullName ?? ''}`,
  }));

  // 'Xóa bộ lọc (N)': N counts every applied criterion of the strip.
  const appliedFilterCount = (customerId ? 1 : 0) + (deliveryFrom || deliveryTo ? 1 : 0) + (lockStatus !== 'ALL' ? 1 : 0);
  const totals = listTotals(items);

  const selectLot = (id: number, next: boolean) => setSelectedIds((current) => {
    const set = new Set(current);
    if (next) set.add(id);
    else set.delete(id);
    return set;
  });
  // SIL-538 — outside [📦 Gộp hàng] the ticks are hidden, so the export's
  // disable reason names the mode first: the user cannot have picked anything.
  // Sweep (card 20261008_1): every disable cause rides the aria-disabled
  // pattern so the reason stays hover/focus-reachable.
  const exportDisabledReason = issuing
    ? 'Đang xuất Debit Note…'
    : !customerId
      ? 'Chọn khách hàng để xuất Debit Note.'
      : canManage && !mergeMode
        ? 'Bật [📦 Gộp hàng] để chọn lô xuất Debit Note.'
        : !anyLockedSelected
          ? 'Chọn ít nhất một lô đã khóa để xuất Debit Note.'
          : null;
  const exportDisabled = exportDisabledReason != null;

  return (
    <div className="shipment-debit-page data-workspace">
      <Breadcrumbs items={[{ label: 'Tổng quan lô hàng', to: '/shipments' }, { label: 'Chi phí - Quyết toán' }]} />
      {!canManage && <Alert variant="info">Chế độ chỉ xem tổng hợp. Tài khoản này không có quyền mở chi tiết hoặc xuất Debit Note.</Alert>}
      {summary.isError && <Alert variant="error">Không thể tải danh sách quyết toán. Vui lòng thử lại.</Alert>}

      <section className="shipment-debit-workspace" aria-label="Danh sách lô quyết toán" aria-busy={summary.isFetching}>
        {/* Owner redesign 23/10 (spec v2 (d)): ONE date mechanism (the unified
            range picker) + the customer axis + the Khóa lô criterion, all
            auto-applied; 'Xóa bộ lọc (N)' counts what is live. The topbar
            month chip is hidden on this route (Topbar.tsx) — no 4th date
            mechanism. */}
        <ShipmentDebitRibbon
          customerValue={customerId}
          customerOptions={customerOptions}
          onCustomerChange={(value) => { setSelectedIds(new Set()); updateParam('customer', value || null); }}
          deliveryFrom={deliveryFrom}
          deliveryTo={deliveryTo}
          onDeliveryRangeChange={({ from, to }) => {
            // Same clearing law as the customer criterion: a narrowed range
            // can hide picked lots, and stale ids must not resurrect as
            // ticks when the range widens again.
            setSelectedIds(new Set());
            updateParam('from', from || null);
            updateParam('to', to || null);
          }}
          lockStatus={lockStatus}
          onLockChange={(key) => { setSelectedIds(new Set()); updateParam('lock', key === 'ALL' ? null : key); }}
          appliedCount={appliedFilterCount}
          onClear={() => {
            setSelectedIds(new Set());
            updateParam('customer', null);
            updateParam('from', null);
            updateParam('to', null);
            updateParam('lock', null);
          }}
          mergeMode={mergeMode}
          onToggleMergeMode={() => {
            // Spec 261023110000 §2 — the toggle both exits and enters: either
            // way the picks drop so a reopened mode never shows a stale bar.
            if (mergeMode) exitMergeMode();
            else { setSelectedIds(new Set()); setMergeMode(true); }
          }}
        />
        {/* The action row, directly above the rows it acts on (the phone
            band's reading order; desktop re-pins it on top via page CSS).
            SIL-538: only [Xuất Debit Note] lives here — the mode toggle is on
            the filter strip and [Gộp hàng] rides the floating bar. */}
        <header className="shipment-debit-header" data-component="shipment-debit-header">
          <h1 className="shipment-debit-header__title">Chi phí - Quyết toán</h1>
          {/* SIL-538 (PRD 261023110000 §2): the header keeps only [Xuất Debit
              Note]. The selection read-out and the [Gộp hàng] action both move
              onto the mode's floating bottom bar — outside the mode there are
              no ticks to read or act on. */}
          {canManage && (
            <span className="shipment-debit-header__export">
              <DisabledActionTip id="shipment-debit-export" reason={exportDisabledReason}>
                <UUIButton
                  className="shipment-debit-export"
                  size="sm"
                  color="primary"
                  aria-disabled={exportDisabled || undefined}
                  onPress={() => { if (exportDisabled) return; void exportSelectedLockedLots(); }}
                >
                  Xuất Debit Note
                </UUIButton>
              </DisabledActionTip>
            </span>
          )}
        </header>
        {summary.isPending ? (
          <Skeleton height={320} />
        ) : items.length === 0 && !summary.isError ? (
          <EmptyState illustration="finance" title="Không có lô nào" description="Không có lô nào khớp bộ lọc hiện tại." />
        ) : (
          <>
            {/* Card 20260924_2 F1 shadow line (BE 855aef81; FE half per BE spec):
                fees on fulfillment-NULL trips stay out of chốt — say so plainly
                instead of a silent gap. Hidden at zero; sits BESIDE the scroll
                pane (card 20260924_9). */}
            {(summary.data?.excludedCount ?? 0) > 0 && (
              <div className="shipment-debit-shadow">
                <p className="shipment-debit-shadow-line" role="status">
                  <span className="shipment-debit-shadow-line__text">
                    {summary.data?.excludedCount} chuyến chưa gán đầu việc vận chuyển — {`${formatMoney(Number(summary.data?.excludedSum ?? '0'))} ₫`} chưa vào chốt
                  </span>
                  {shadowTrips.length > 0 && (
                    <button
                      type="button"
                      className="shipment-debit-shadow-line__toggle"
                      aria-expanded={shadowOpen}
                      onClick={() => setShadowOpen((open) => !open)}
                    >
                      {shadowOpen ? 'Ẩn danh sách' : `Xem danh sách (${shadowTrips.length})`}
                    </button>
                  )}
                </p>
                {shadowOpen && (
                  <ul id="shipment-debit-shadow-trips" className="shipment-debit-shadow-trips">
                    {shadowTrips.map((trip) => (
                      <li key={trip.tripId} className="shipment-debit-shadow-trips__item">
                        <span className="shipment-debit-shadow-trips__code">{trip.tripCode ?? 'Chưa có mã chuyến'}</span>
                        <span className="shipment-debit-shadow-trips__lot">
                          <small>Lô</small> {trip.lotLabel}{trip.customerName ? ` · ${trip.customerName}` : ''}
                        </span>
                        <span className="shipment-debit-shadow-trips__date">
                          <small>Ngày chạy</small> {trip.departureDate ?? '—'}
                        </span>
                        <span className="shipment-debit-shadow-trips__sum">
                          <small>Phí ngoài chốt</small> {formatMoney(Number(trip.feeSum))} ₫
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {phone && !print ? (
              <>
                <p className="shipment-debit-totals shipment-debit-totals--phone" data-testid="shipment-debit-totals-mobile">
                  <span className="shipment-debit-totals__label">{`Tổng (${totals.count} lô)`}</span>
                  <span>DT {totals.receivable == null ? '—' : formatMoney(totals.receivable)}</span>
                  <span>TChi {totals.payable == null ? '—' : formatMoney(totals.payable)}</span>
                  <span>LN {totals.profit == null ? '—' : formatMoney(totals.profit)}</span>
                </p>
                <ShipmentDebitRecords key={JSON.stringify([customerId, deliveryFrom, deliveryTo, lockStatus])}
                  rows={items} canManage={canManage} mergeMode={mergeMode} selectedIds={selectedIds} expandedId={expandedId}
                  onToggle={toggleExpandedLot} onSaved={() => { void summary.refetch(); }}
                  onSelect={selectLot}
                />
              </>
            ) : (
              <DebitLotTable
                items={items}
                canManage={canManage}
                mergeMode={mergeMode}
                selectedIds={selectedIds}
                expandedId={expandedId}
                onToggle={toggleExpandedLot}
                onSaved={() => { void summary.refetch(); }}
                onUnmerged={refreshRates}
                ratesRefreshing={ratesRefreshing}
                plateOptions={plateOptions}
                onSelect={selectLot}
              />
            )}
            {/* Scroll cue (card 20260924_9): the table's 1348px floor scrolls
                sideways below that width. At ≤640 the phone record cards
                render instead, so no cue is needed there. */}
            <p className="shipment-debit-scroll-hint">Bảng cuộn ngang — dùng ← → hoặc vuốt để xem đủ cột.</p>
          </>
        )}
        {/* Spec 261023110000 §2 — the Bottom Floating Bar: rides the mode with
            the shared lcl-merge.css look («Đang chọn N lô: Tổng X tấn | Y CBM —
            Lô 1 giữ 100% tiền thu khách…») + [Gộp hàng] (opens the merge popup)
            + [Bỏ chọn]. Hidden entirely outside the mode or with no picks. */}
        {canManage && mergeMode && selectedRows.length > 0 && (
          <div className="lcl-selection-bar" role="status">
            <span className="lcl-selection-bar__totals">
              {`Đang chọn ${selectedRows.length} lô${selectionMeasureClause ? `: Tổng ${selectionMeasureClause}` : ''}`}
            </span>
            {mergeableRows.length > 0 && (
              <span className="lcl-selection-bar__first" title="Lô 1 giữ 100% tiền thu khách">
                {`— Lô 1 giữ 100% tiền thu khách: ${mergeableRows[0]?.billOrBookNumber || mergeableRows[0]?.customsNumber || mergeableRows[0]?.code}`}
              </span>
            )}
            <button
              type="button"
              className="lcl-selection-bar__clear"
              onClick={() => setSelectedIds(new Set())}
            >
              Bỏ chọn
            </button>
            <DisabledActionTip id="shipment-debit-bar-merge" reason={mergeDisabledReason}>
              <button
                type="button"
                className="lcl-selection-bar__assign"
                aria-disabled={mergeDisabled || undefined}
                title="Gộp xe thu khách"
                onClick={() => { if (mergeDisabled) return; setMergeOpen(true); }}
              >
                Gộp hàng
              </button>
            </DisabledActionTip>
          </div>
        )}
      </section>

      {mergeOpen && (
        <MergeRevGroupDialog
          rows={mergeableRows}
          plateOptions={plateOptions}
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            // Spec 261023110000 §2 — completing the merge EXITS the mode: the
            // CHỌN column hides itself and the floating bar closes with it
            // (the group changed; the ticks must not survive as a stale set).
            exitMergeMode();
            void summary.refetch();
          }}
        />
      )}
    </div>
  );
}

export default ShipmentDebitPage;
