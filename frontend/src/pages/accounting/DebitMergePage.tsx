// Task 2.3 (18/11) — 'Ghép bộ Debit' (/accounting/ghep-bo-debit): the staff
// surface of the ONE 6-group reconciliation grid. All lots, unscoped; Khóa lô
// runs the existing cost-lock channel; Chọn Debit reuses the settlement-round
// flow the chot-debit board runs (same dialog, same createSettlementRound).
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DebitMergeItem } from '@tingting/shared';
import { listDebitMergeBoard, debitMergeKeys, lockShipmentCost } from '../../api/shipmentDebit';
import {
  createSettlementRound,
  type AccountingDebitBoardRow,
  type CreateSettlementRoundBody,
} from '../../api/accountingDebitClient';
import { tripClient } from '../../api/tripClient';
import { useAuth } from '../../hooks/useAuth';
import { Role } from '@tingting/shared';
import { useToast } from '../../components/shared/Toast';
import { ApiError } from '../../lib/api';
import { Breadcrumbs } from '../../components/shared/Breadcrumbs';
import { Alert } from '../../components/shared/Alert';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { qk } from '../../api/keys';
import { Skeleton } from '../../components/shared/Skeleton';
import { DebitSettlementRoundDialog } from './DebitSettlementRoundDialog';
import { DebitMergeGrid } from '../../features/accounting/DebitMergeGrid';
import './DebitMergePage.css';

/** The dialog rides the chot-debit board's row contract; the merge rows
 *  carry every field it reads (ngày span, customer pair, thu tổng) — the
 *  returned side stays empty because this grid carries no giá vốn. */
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

export function DebitMergePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [customerId, setCustomerId] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [settlementOpen, setSettlementOpen] = useState(false);

  // ShipmentDebitWorkspace's canLock law (ADMIN | ACCOUNTANT | CUS) — the
  // same gating the workspace's KHÓA LÔ HÀNG button preserves.
  const canLock = user?.role === Role.ADMIN || user?.role === Role.ACCOUNTANT || user?.role === Role.CUS;
  // createSettlementRound is gated server-side to the office trio + CUS
  // (ticket 2.3 — CUS runs Chọn Debit on its own fee-complete lots).
  const canChooseDebit = user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.ACCOUNTANT;
  const settlementDialogRows = useRef<AccountingDebitBoardRow[]>([]);

  const board = useQuery({
    queryKey: debitMergeKeys.board(false),
    queryFn: () => listDebitMergeBoard({}),
  });
  const bootstrap = useQuery({ queryKey: qk.shipmentDebit.bootstrap, queryFn: () => tripClient.getBootstrap() });

  const rows = useMemo(() => {
    const all = board.data?.items ?? [];
    const needle = routeFilter.trim().toLowerCase();
    return all.filter((row) => {
      if (customerId !== '' && String(row.customerId ?? '') !== customerId) return false;
      if (needle !== '' && !(row.routeName ?? '').toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [board.data, customerId, routeFilter]);

  const refreshBoard = () => {
    void queryClient.invalidateQueries({ queryKey: debitMergeKeys.all });
  };

  // Khóa lô per selected lot — the existing cost-lock channel, one
  // UUID per lock (replay-safe, same as the workspace's button).
  const lockMutation = useMutation({
    mutationFn: async (shipmentIds: number[]) => {
      for (const shipmentId of shipmentIds) {
        await lockShipmentCost(shipmentId, crypto.randomUUID());
      }
      return shipmentIds;
    },
    onSuccess: (locked) => {
      setSelectedIds(new Set());
      refreshBoard();
      toast({ kind: 'success', message: `Đã khóa chi phí ${locked.length} lô.` });
    },
    onError: (error: Error) => {
      toast({ kind: 'error', message: error instanceof ApiError ? error.message : 'Không khóa được lô. Vui lòng thử lại.' });
    },
  });

  const settlementMutation = useMutation({
    mutationFn: createSettlementRound,
    onSuccess: () => {
      setSettlementOpen(false);
      setSelectedIds(new Set());
      refreshBoard();
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
    <div className="debit-merge-page data-workspace">
      <Breadcrumbs items={[{ label: 'Kế toán', to: '/accounting' }, { label: 'Ghép bộ Debit' }]} />
      {board.isError && <Alert variant="error">Không thể tải bảng Ghép bộ Debit. Vui lòng thử lại.</Alert>}
      <section className="debit-merge-page__workspace" aria-label="Bảng Ghép bộ Debit" aria-busy={board.isFetching}>
        <header className="debit-merge-page__header">
          <h1 className="debit-merge-page__title">Ghép bộ Debit</h1>
        </header>
        {board.isPending ? (
          <Skeleton height={320} />
        ) : (
          <DebitMergeGrid
            rows={rows}
            storageKey="debit-merge-hidden-cols"
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
            onChooseDebit={(picked) => {
              settlementDialogRows.current = picked.map(toSettlementDialogRow);
              setSettlementOpen(true);
            }}
            quickFilters={(
              <>
                <UuiSelectField
                  label="Khách hàng"
                  value={customerId}
                  onChange={(event) => { setSelectedIds(new Set()); setCustomerId(event.target.value); }}
                  options={[{ value: '', label: 'Tất cả' }, ...customerOptions]}
                />
                <label className="debit-merge-filter">
                  <span>Tuyến đường</span>
                  <input
                    type="search"
                    value={routeFilter}
                    placeholder="Lọc tuyến"
                    onChange={(event) => setRouteFilter(event.target.value)}
                  />
                </label>
              </>
            )}
          />
        )}
      </section>
      <DebitSettlementRoundDialog
        isOpen={settlementOpen}
        rows={settlementDialogRows.current}
        defaultDateFrom=""
        defaultDateTo=""
        serverError={settlementMutation.error instanceof Error ? settlementMutation.error.message : null}
        onSubmit={(body: CreateSettlementRoundBody) => settlementMutation.mutate(body)}
        onClose={() => setSettlementOpen(false)}
        isPending={settlementMutation.isPending}
      />
    </div>
  );
}

export default DebitMergePage;
