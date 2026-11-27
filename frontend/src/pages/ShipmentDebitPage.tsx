// Task 2.3 (18/11) — /shipments-debit REBUILT: the CUS settlement surface now
// renders the ONE 6-column-group Ghép bộ Debit grid (shared with the staff
// page) instead of the retired flat board. Task 1.2's team toggle lives here:
// [Hiện thông tin lô hàng team] — EXACT label, default OFF (own-only scope),
// ON widens the data call to `team=1` and shows the NV phụ trách column.
//
// Laws preserved on this surface:
//   - read-only Alert for roles without manage clearance (the old law);
//   - Khóa lô rides ShipmentDebitWorkspace's canLock law (ADMIN|ACCOUNTANT|CUS)
//     through the existing cost-lock channel;
//   - Chọn Debit enabled only when every picked lot's costs are complete
//     (the ACTIVE cost-lock law — the debit-note export eligibility signal),
//     and only the office trio can actually run it (server-gated);
//   - SIL-776 REV2: the wire carries no giá vốn — the merge contract carries
//     only the thu-khách side;
//   - a lot click opens the Chốt giá bán side drawer (the L2 workspace,
//     manage-only), the same drawer the flat board hosted.
import { useMemo, useRef, useState, type RefObject } from 'react';
import { Role } from '@tingting/shared';
import { useAuth } from '../hooks/useAuth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueuedSearchParams } from '../hooks/useQueuedSearchParams';
import { tripClient } from '../api/tripClient';
import {
  listShipmentDebitSummary,
  listDebitMergeBoard,
  debitMergeKeys,
  lockShipmentCost,
  unlockShipmentCost,
  type DebitMergeItem,
} from '../api/shipmentDebit';
import {
  createSettlementRound,
  type AccountingDebitBoardRow,
  type CreateSettlementRoundBody,
} from '../api/accountingDebitClient';
import { useToast } from '../components/shared/Toast';
import { ApiError } from '../lib/api';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Drawer } from '../components/UI';
import { UuiSelectField } from '../design-system/forms/UuiSelectField';
import { qk } from '../api/keys';
import { Alert } from '../components/shared/Alert';
import { Skeleton } from '../components/shared/Skeleton';
import { useReasonPrompt } from '../components/reason-prompt';
import { DebitMergeGrid } from '../features/accounting/DebitMergeGrid';
import { filterDebitMergeRows, sortDebitMergeRowsDesc } from '../features/accounting/debit-merge-view';
import { DateRangeFields } from '../design-system';
import { DebitLotLclFacts } from '../features/shipments/debit/DebitLotLclFacts';
import { ShipmentDebitWorkspace } from '../features/shipments/debit/ShipmentDebitWorkspace';
import { DebitSettlementRoundDialog } from './accounting/DebitSettlementRoundDialog';
import { lotLabelOf } from '../features/shipments/debit/debitMoney';
import './ShipmentDebitPage.css';

/** sessionStorage key for the L2 open-state restore (reload persistence). */
const EXPANDED_LOT_KEY = 'shipment-debit.expanded-lot';

/** The team toggle's EXACT label (ticket 18/11 Task 1.2). */
export const TEAM_TOGGLE_LABEL = 'Hiện thông tin lô hàng team';

/** The settlement dialog rides the chot-debit board's row contract; the
 *  merge rows carry every field it reads — the trả side stays empty (no giá
 *  vốn on this surface). Same adapter the staff page runs. */
function toSettlementDialogRow(row: DebitMergeItem): AccountingDebitBoardRow {
  return {
    shipmentId: row.shipmentId,
    code: row.code,
    customerName: row.customerName,
    customerId: row.customerId,
    carrierKeys: [],
    ngay: row.deliveryDate,
    billOrBooking: row.billOrBookNumber,
    containers: row.containers.map((container) => container.containerNumber ?? ''),
    phanXe: [],
    factoryName: row.factoryName,
    routeName: row.routeName,
    truckPlates: [],
    lcl: null,
    thu: {
      cuocThu: row.revenue.cuoc,
      lachHuyen: row.revenue.lachHuyen,
      phuPs: row.revenue.phuPhi,
      phatSinhCus: row.revenue.phatSinh,
      tongThu: row.revenue.tong,
    },
    tra: { cuocTraDv: null, lachHuyenDv: null, phatSinhDv: null, tong1: null, phiRu: null },
    chiPhiNgoai: null,
    loiNhuan: null,
    ghiChu: null,
    adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
    debitHiddenAt: null,
    costLockedAt: row.control.lockStatus === 'LOCKED' ? row.control.lockedAt ?? '' : null,
  };
}

export function ShipmentDebitPage() {
  const { user } = useAuth();
  const canManage = user?.role === Role.ADMIN
    || user?.role === Role.MANAGER
    || user?.role === Role.ACCOUNTANT
    || user?.role === Role.CUS;
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
  const routeFilter = params.get('route') ?? '';
  // CR-011.2 Q6 — the exact mã-cặp filter over the lot's live KẸP pair.
  const pairFilter = params.get('pair') ?? '';
  // SIL-876 (hotfix CR-009.1) — tìm kiếm (Bill/Cont/KH) + lọc Tu ngày–Đen
  // ngày ride the URL like the other facets; sort DESC mặc định do helper lo.
  const search = params.get('q') ?? '';
  const dateFrom = params.get('from') ?? '';
  const dateTo = params.get('to') ?? '';
  // Task 1.2 — the toggle's URL state: absent/'false' = OFF (own-only).
  const team = params.get('team') === 'true';

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [settlementOpen, setSettlementOpen] = useState(false);
  const settlementDialogRowsRef = useRef<AccountingDebitBoardRow[]>([]);
  const { toast } = useToast();

  // Khóa lô: ShipmentDebitWorkspace's canLock law, preserved verbatim.
  const canLock = user?.role === Role.ADMIN || user?.role === Role.ACCOUNTANT || user?.role === Role.CUS;
  // Ticket 2.3 (18/11) — CUS runs Chọn Debit like accounting once its picks
  // are fee-complete; the completeness + lock law lives in the grid.
  const canChooseDebit = user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.ACCOUNTANT || user?.role === Role.CUS;
  // SIL-923 — the unlock trio (the /unlock route clearance, SIL-721): when
  // every picked lot is LOCKED they get [Mở khóa]; everyone else gets the
  // read-only [Đã khóa] face (24/11, mục 11 — no ticketing flow).
  const canUnlock = user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.ACCOUNTANT;
  const { prompt, dialog: reasonDialog } = useReasonPrompt();

  const queryClient = useQueryClient();
  // Task 1.2 — the team flag rides the summary call AND its cache identity
  // (prefix-invalidated by the workspace's saves via summaryAll).
  const summary = useQuery({
    queryKey: qk.shipmentDebit.summary(customerId, team),
    queryFn: () => listShipmentDebitSummary({
      customerId: customerId === '' ? null : Number(customerId),
      team,
    }),
  });
  // The merge grid's own board (6 groups). Same scoping law server-side.
  const board = useQuery({
    queryKey: debitMergeKeys.board(team),
    queryFn: () => listDebitMergeBoard({
      customerId: customerId === '' ? null : Number(customerId),
      team,
    }),
  });
  const bootstrap = useQuery({ queryKey: qk.shipmentDebit.bootstrap, queryFn: () => tripClient.getBootstrap() });

  const rows = useMemo(() => {
    const all = sortDebitMergeRowsDesc(board.data?.items ?? []);
    const needle = routeFilter.trim().toLowerCase();
    return filterDebitMergeRows(all, { search, dateFrom, dateTo }).filter((row) => {
      if (customerId !== '' && String(row.customerId ?? '') !== customerId) return false;
      if (needle !== '' && !(row.routeName ?? '').toLowerCase().includes(needle)) return false;
      // CR-011.2 Q6 — exact mã-cặp match (empty → no pair filtering).
      if (pairFilter.trim() !== '' && String(row.pairId ?? '') !== pairFilter.trim()) return false;
      return true;
    });
  }, [board.data, customerId, routeFilter, pairFilter, search, dateFrom, dateTo]);
  // The L2 drawer still keys off the summary rows (its workspace needs the
  // summary row shape for lock state + LCL facts).
  const summaryItems = summary.data?.items ?? [];

  // L2 open state survives a reload within the session (card _11).
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

  const refreshBoards = () => {
    void queryClient.invalidateQueries({ queryKey: debitMergeKeys.all });
    void queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.summaryAll });
  };

  const lockMutation = useMutation({
    mutationFn: async (shipmentIds: number[]) => {
      for (const shipmentId of shipmentIds) {
        await lockShipmentCost(shipmentId, crypto.randomUUID());
      }
      return shipmentIds;
    },
    onSuccess: (locked) => {
      // SIL-923 — the selection STAYS: the toolbar slot swaps [Khóa lô] →
      // [Mở khóa]/[Đã khóa] on the just-locked picks immediately.
      refreshBoards();
      toast({ kind: 'success', message: `Đã khóa chi phí ${locked.length} lô.` });
    },
    onError: (error: Error) => {
      toast({ kind: 'error', message: error instanceof ApiError ? error.message : 'Không khóa được lô. Vui lòng thử lại.' });
    },
  });

  // SIL-923 — the toolbar's post-lock [Mở khóa] for the unlock trio: one
  // reason for the whole batch, the existing /unlock channel per lot. Roles
  // without clearance see the read-only [Đã khóa] face (24/11, mục 11).
  const unlockMutation = useMutation({
    mutationFn: async ({ shipmentIds, reason }: { shipmentIds: number[]; reason: string }) => {
      for (const shipmentId of shipmentIds) {
        await unlockShipmentCost(shipmentId, { reason }, crypto.randomUUID());
      }
      return shipmentIds;
    },
    onSuccess: (unlocked) => {
      setSelectedIds(new Set());
      refreshBoards();
      toast({ kind: 'success', message: `Đã mở khóa chi phí ${unlocked.length} lô.` });
    },
    onError: (error: Error) => {
      toast({ kind: 'error', message: error instanceof ApiError ? error.message : 'Không mở khóa được lô. Vui lòng thử lại.' });
    },
  });

  const settlementMutation = useMutation({
    mutationFn: createSettlementRound,
    onSuccess: () => {
      setSettlementOpen(false);
      setSelectedIds(new Set());
      refreshBoards();
      toast({ kind: 'success', message: 'Đã chốt đợt Chọn Debit.' });
    },
    onError: (error: Error) => {
      toast({ kind: 'error', message: error.message });
    },
  });

  const customerOptions = (bootstrap.data?.customers ?? []).map((customer) => ({
    value: String(customer.id),
    label: customer.fullName ? `${customer.name} - ${customer.fullName}` : customer.name,
  }));

  return (
    <div className="shipment-debit-page data-workspace">
      <Breadcrumbs items={[{ label: 'Tổng quan lô hàng', to: '/shipments' }, { label: 'Chi phí - Quyết toán' }]} />
      {!canManage && <Alert variant="info">Chế độ chỉ xem tổng hợp. Tài khoản này không có quyền mở chi tiết.</Alert>}
      {(summary.isError || board.isError) && <Alert variant="error">Không thể tải danh sách quyết toán. Vui lòng thử lại.</Alert>}

      <section className="shipment-debit-workspace" aria-label="Bảng Ghép bộ Debit" aria-busy={board.isFetching}>
        <header className="shipment-debit-header" data-component="shipment-debit-header">
          <h1 className="shipment-debit-header__title">Chi phí - Quyết toán</h1>
          {/* Task 1.2 — the team toggle. EXACT label; default OFF = own-only;
              ON threads team=1 into the data call and shows NV phụ trách. */}
          <label className="shipment-debit-team-toggle">
            <input
              type="checkbox"
              checked={team}
              onChange={(event) => {
                setSelectedIds(new Set());
                updateParam('team', event.target.checked ? 'true' : null);
              }}
            />
            <span>{TEAM_TOGGLE_LABEL}</span>
          </label>
        </header>
        {board.isPending || summary.isPending ? (
          <Skeleton height={320} />
        ) : (
          <DebitMergeGrid
            rows={rows}
            storageKey="shipment-debit-hidden-cols"
            showCreator={team}
            selection={selectedIds}
            onSelectionChange={(id, next) => {
              setSelectedIds((current) => {
                const set = new Set(current);
                if (next) set.add(id);
                else set.delete(id);
                return set;
              });
            }}
            canLock={canLock}
            canChooseDebit={canChooseDebit}
            lockPending={lockMutation.isPending}
            onLockSelected={(ids) => lockMutation.mutate(ids)}
            canUnlock={canUnlock}
            unlockPending={unlockMutation.isPending}
            onUnlockSelected={canUnlock
              ? (ids) => {
                void prompt(`Nhập lý do mở khóa chi phí ${ids.length} lô đã chọn.`, { confirmLabel: 'Mở khóa lô', reasonLabel: 'Lý do mở khóa (bắt buộc)' })
                  .then((reason) => { if (reason != null) unlockMutation.mutate({ shipmentIds: ids, reason }); });
              }
              : undefined}
            onChooseDebit={(picked) => {
              settlementDialogRowsRef.current = picked.map(toSettlementDialogRow);
              setSettlementOpen(true);
            }}
            onOpenLot={canManage
              ? (row: DebitMergeItem) => toggleExpandedLot(row.shipmentId)
              : undefined}
            quickFilters={(
              <>
                <UuiSelectField
                  label="Khách hàng"
                  value={customerId}
                  onChange={(event) => { setSelectedIds(new Set()); updateParam('customer', event.target.value || null); }}
                  options={[{ value: '', label: 'Tất cả' }, ...customerOptions]}
                />
                <label className="debit-merge-filter">
                  <span>Tìm kiếm</span>
                  {/* SIL-876 — Bill / Cont / Khách hàng trên cùng một ô. */}
                  <input
                    type="search"
                    value={search}
                    placeholder="Số Bill, container, khách hàng"
                    aria-label="Tìm lô theo số Bill, container hoặc khách hàng"
                    onChange={(event) => { setSelectedIds(new Set()); updateParam('q', event.target.value || null); }}
                  />
                </label>
                {/* SIL-876 — lọc Tu ngày–Đen ngày trên cột Ngày. */}
                <DateRangeFields
                  id="shipment-debit-date-range"
                  ariaLabel="Khoảng ngày giao"
                  from={dateFrom}
                  to={dateTo}
                  onChange={({ from, to }) => {
                    setSelectedIds(new Set());
                    setSearchParams((current) => {
                      const next = new URLSearchParams(current);
                      if (from) next.set('from', from); else next.delete('from');
                      if (to) next.set('to', to); else next.delete('to');
                      return next;
                    });
                  }}
                />
                <label className="debit-merge-filter">
                  <span>Tuyến đường</span>
                  <input
                    type="search"
                    value={routeFilter}
                    placeholder="Lọc tuyến"
                    onChange={(event) => updateParam('route', event.target.value || null)}
                  />
                </label>
                {/* CR-011.2 Q6 — the exact mã-cặp filter (live KẸP pair). */}
                <label className="debit-merge-filter">
                  <span>Mã cặp</span>
                  <input
                    type="search"
                    value={pairFilter}
                    placeholder="Lọc theo mã cặp"
                    inputMode="numeric"
                    onChange={(event) => { setSelectedIds(new Set()); updateParam('pair', event.target.value.trim() || null); }}
                  />
                </label>
              </>
            )}
          />
        )}
        <p className="shipment-debit-scroll-hint">Bảng cuộn ngang — dùng ← → hoặc vuốt để xem đủ cột.</p>
      </section>

      {/* A lot click opens the Chốt giá bán SIDE DRAWER — the L2 workspace
          (manage-only), the same drawer the flat board hosted. */}
      {(() => {
        const drawerLot = (canManage ? summaryItems.find((row) => row.shipmentId === expandedId) : undefined) ?? null;
        if (drawerLot == null) return null;
        return (
          <Drawer
            isOpen
            onClose={() => toggleExpandedLot(drawerLot.shipmentId)}
            title={`Chốt giá bán — ${lotLabelOf(drawerLot) === '—' ? drawerLot.code : lotLabelOf(drawerLot)}`}
            className="shipment-debit-drawer"
            expandable
          >
            {drawerLot.cargoMode === 'LCL' && (
              <DebitLotLclFacts
                row={drawerLot}
                plateOptions={(bootstrap.data?.trucks ?? [])
                  .filter((truck) => truck.licensePlate?.trim())
                  .map((truck) => ({ value: truck.licensePlate!.trim(), label: truck.licensePlate!.trim(), searchText: truck.licensePlate!.trim() }))}
                onChanged={() => refreshBoards()}
              />
            )}
            <ShipmentDebitWorkspace
              shipmentId={drawerLot.shipmentId}
              locked={drawerLot.lockStatus === 'LOCKED'}
              lotCode={drawerLot.code}
              onSaved={() => refreshBoards()}
            />
          </Drawer>
        );
      })()}

      <DebitSettlementDialogHost
        isOpen={settlementOpen}
        rowsRef={settlementDialogRowsRef}
        serverError={settlementMutation.error instanceof Error ? settlementMutation.error.message : null}
        isPending={settlementMutation.isPending}
        onSubmit={settlementMutation.mutateAsync}
        onClose={() => setSettlementOpen(false)}
      />
      {reasonDialog}
    </div>
  );
}

/** The settlement dialog reads its rows once per open — the ref keeps the
 *  picked rows stable across the dialog's own re-renders. */
function DebitSettlementDialogHost({ isOpen, rowsRef, serverError, isPending, onSubmit, onClose }: {
  isOpen: boolean;
  rowsRef: RefObject<AccountingDebitBoardRow[]>;
  serverError: string | null;
  isPending: boolean;
  onSubmit: (body: CreateSettlementRoundBody) => void | Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <DebitSettlementRoundDialog
      isOpen={isOpen}
      rows={rowsRef.current}
      defaultDateFrom=""
      defaultDateTo=""
      serverError={serverError}
      onSubmit={onSubmit}
      onClose={onClose}
      isPending={isPending}
    />
  );
}

export default ShipmentDebitPage;
