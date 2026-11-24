// Task 2.3 (18/11) — 'Ghép bộ Debit' (/accounting/ghep-bo-debit): the staff
// surface of the ONE 6-group reconciliation grid. All lots, unscoped; Khóa lô
// runs the existing cost-lock channel; Chọn Debit reuses the settlement-round
// flow the chot-debit board runs (same dialog, same createSettlementRound).
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DebitMergeItem } from '@tingting/shared';
import { listDebitMergeBoard, debitMergeKeys, lockShipmentCost, unlockShipmentCost, createDebitNoteBatch, exportDebitNoteFile } from '../../api/shipmentDebit';
import {
  listSettlementRounds,
  DEBIT_SETTLEMENT_ROUNDS_KEY,
  createSettlementRound,
  type AccountingDebitBoardRow,
} from '../../api/accountingDebitClient';
import { tripClient } from '../../api/tripClient';
import { useAuth } from '../../hooks/useAuth';
import { Role } from '@tingting/shared';
import { useToast } from '../../components/shared/Toast';
import { ApiError } from '../../lib/api';
import { useReasonPrompt } from '../../components/reason-prompt';
import { Breadcrumbs } from '../../components/shared/Breadcrumbs';
import { Alert } from '../../components/shared/Alert';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { qk } from '../../api/keys';
import { Skeleton } from '../../components/shared/Skeleton';
import { Btn, Modal } from '../../components/UI';
import { formatCurrency, formatMoney } from '../../lib/format';
import { DateRangeFields } from '../../design-system';
import { filterDebitMergeRows, sortDebitMergeRowsDesc } from '../../features/accounting/debit-merge-view';
import { DebitSettlementRoundDialog } from './DebitSettlementRoundDialog';
import { DebitNotePreviewDialog, type DebitNoteSavePayload } from './DebitNotePreviewDialog';
import { DebitMergeGrid } from '../../features/accounting/DebitMergeGrid';
import { UnattachedTripsTable } from '../../features/shipments/debit/ShipmentDebitTables.unattached';
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
  // SIL-876 (hotfix CR-009.1) — tìm kiếm (Bill/Cont/KH) + lọc Tu ngày–Đen
  // ngày; mặc định sort DESC do helper lo (mới nhất lên đầu).
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [settlementOpen, setSettlementOpen] = useState(false);
  // SIL-866 (hotfix CR-009.1) — the [Xuất Debit Note] step lives HERE (the
  // Ghép bộ Debit chain Khóa lô → Chọn Debit → Xuất): the same preview-first
  // contract the chot-debit board ran — the preview reads the đợt's frozen
  // basis, and only [Lưu] / [Lưu và tải file XLSX] push numbers to Công nợ.
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [exportingNote, setExportingNote] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);

  // ShipmentDebitWorkspace's canLock law (ADMIN | ACCOUNTANT | CUS) — the
  // same gating the workspace's KHÓA LÔ HÀNG button preserves.
  const canLock = user?.role === Role.ADMIN || user?.role === Role.ACCOUNTANT || user?.role === Role.CUS;
  // createSettlementRound is gated server-side to the office trio + CUS
  // (ticket 2.3 — CUS runs Chọn Debit on its own fee-complete lots).
  const canChooseDebit = user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.ACCOUNTANT;
  // POST /shipments/debit-notes is gated to CUS | ACCOUNTANT | ADMIN.
  const canExportDebitNote = user?.role === Role.ADMIN || user?.role === Role.ACCOUNTANT || user?.role === Role.CUS;
  // SIL-923 — the unlock trio (the /unlock route clearance, SIL-721): when
  // every picked lot is LOCKED the toolbar slot becomes [Mở khóa].
  const canUnlock = user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.ACCOUNTANT;
  const { prompt, dialog: reasonDialog } = useReasonPrompt();
  const settlementDialogRows = useRef<AccountingDebitBoardRow[]>([]);

  const board = useQuery({
    queryKey: debitMergeKeys.board(false),
    queryFn: () => listDebitMergeBoard({}),
  });
  const bootstrap = useQuery({ queryKey: qk.shipmentDebit.bootstrap, queryFn: () => tripClient.getBootstrap() });
  // SIL-866 — the đợt chốt (Lần · Tháng · Năm) list behind the preview's
  // picker; same source the chot-debit board's preview read.
  const roundsQuery = useQuery({
    queryKey: DEBIT_SETTLEMENT_ROUNDS_KEY,
    queryFn: listSettlementRounds,
  });

  const rows = useMemo(() => {
    const all = sortDebitMergeRowsDesc(board.data?.items ?? []);
    const needle = routeFilter.trim().toLowerCase();
    return filterDebitMergeRows(all, { search, dateFrom, dateTo }).filter((row) => {
      if (customerId !== '' && String(row.customerId ?? '') !== customerId) return false;
      if (needle !== '' && !(row.routeName ?? '').toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [board.data, customerId, routeFilter, search, dateFrom, dateTo]);

  // SIL-974 (K10.54 §10.8.6) — the ngoài-chốt section rides the DISPLAYED
  // rows (post-filter), so the exclusion total always describes the table
  // above it; hidden entirely when no displayed lot carries such a trip.
  const unattachedTrips = useMemo(() => rows.flatMap((row) => row.unattachedTrips ?? []), [rows]);
  const excludedTotal = useMemo(() => {
    const known = unattachedTrips
      .map((trip) => trip.feeTotal)
      .filter((value): value is number => value != null && Number.isFinite(value));
    return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
  }, [unattachedTrips]);

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
      // SIL-923 — the selection STAYS: the toolbar slot swaps [Khóa lô] →
      // [Mở khóa] on the just-locked picks immediately.
      refreshBoard();
      toast({ kind: 'success', message: `Đã khóa chi phí ${locked.length} lô.` });
    },
    onError: (error: Error) => {
      toast({ kind: 'error', message: error instanceof ApiError ? error.message : 'Không khóa được lô. Vui lòng thử lại.' });
    },
  });

  // SIL-923 — the toolbar's post-lock [Mở khóa] for the unlock trio: one
  // reason for the whole batch, the existing /unlock channel per lot.
  const unlockMutation = useMutation({
    mutationFn: async ({ shipmentIds, reason }: { shipmentIds: number[]; reason: string }) => {
      for (const shipmentId of shipmentIds) {
        await unlockShipmentCost(shipmentId, { reason }, crypto.randomUUID());
      }
      return shipmentIds;
    },
    onSuccess: (unlocked) => {
      setSelectedIds(new Set());
      refreshBoard();
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
      refreshBoard();
      toast({ kind: 'success', message: 'Đã chốt đợt Chọn Debit.' });
    },
    onError: (error: Error) => {
      toast({ kind: 'error', message: error.message });
    },
  });

  // SIL-866 — the selected lots drive the export: the selection scopes the
  // preview's đợt picker, and a still-unlocked selection asks for consent
  // first (the SAME law the chot-debit board's export ran — FB-094).
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.shipmentId)),
    [rows, selectedIds],
  );
  const unlockedSelectedRows = useMemo(
    () => selectedRows.filter((row) => row.control.lockStatus !== 'LOCKED'),
    [selectedRows],
  );
  const selectedCustomerIds = useMemo(
    () => [...new Set(selectedRows.map((row) => row.customerId).filter((id): id is number => id != null))],
    [selectedRows],
  );
  function requestExportDebitNote() {
    if (selectedRows.length === 0 || exportingNote) return;
    if (unlockedSelectedRows.length > 0) setLockConfirmOpen(true);
    else setExportPreviewOpen(true);
  }
  /** FB-094 law, moved with the button (SIL-866): the consent act locks the
   *  still-unlocked selected lots (the SAME lockShipmentCost channel the
   *  [Khóa lô] button runs), then the preview opens. */
  const lockSelectedForExport = async () => {
    for (const row of unlockedSelectedRows) {
      await lockShipmentCost(row.shipmentId, crypto.randomUUID());
    }
  };
  /** The SAVE half (SIL-855 contract, verbatim from the board's flow): issues
   *  the consolidated note for the CHOSEN ĐỢT — its full lot set — reconciles
   *  the issued totals against the preview's, and the download is the
   *  caller's choice. Nothing reaches Công nợ until a save button runs. */
  async function saveDebitNote(payload: DebitNoteSavePayload): Promise<{ documentId: number; anchorShipmentId: number; fileNameBase: string }> {
    if (payload.lotIds.length === 0) throw new Error('Không có lô nào được chọn.');
    const { id: documentId, totalNet, totalTax, totalGross } = await createDebitNoteBatch(payload.lotIds, payload.roundId);
    if (totalNet != null && (totalNet !== payload.totals.net || totalTax !== payload.totals.tax || totalGross !== payload.totals.gross)) {
      throw new Error(
        `Tổng Debit Note phát hành (#${documentId}) lệch bảng xem trước đợt ${payload.roundLabel}`
        + ` — phát hành ${formatCurrency(totalNet)}/${formatCurrency(totalTax)}/${formatCurrency(totalGross)}`
        + ` so với xem trước ${formatCurrency(payload.totals.net)}/${formatCurrency(payload.totals.tax)}/${formatCurrency(payload.totals.gross)}.`
        + ' Số liệu đã đẩy sang Công nợ. Không tự động tải file.',
      );
    }
    void queryClient.invalidateQueries({ queryKey: debitMergeKeys.all });
    return {
      documentId,
      anchorShipmentId: payload.lotIds[0]!,
      fileNameBase: selectedRows[0]?.billOrBookNumber || 'chua-xac-dinh',
    };
  }
  async function saveDebitNoteAndExit(download: boolean, payload: DebitNoteSavePayload) {
    if (exportingNote) return;
    setExportingNote(true);
    try {
      const { documentId, anchorShipmentId, fileNameBase } = await saveDebitNote(payload);
      if (download) {
        const blob = await exportDebitNoteFile(anchorShipmentId, documentId);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `giay-bao-no-${fileNameBase}.xlsx`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      setExportPreviewOpen(false);
      toast({ kind: 'success', message: `Đã lưu Debit Note (${payload.lotIds.length} lô, đợt ${payload.roundLabel}) — số liệu đã đẩy sang Công nợ.${download ? ' File XLSX đã tải.' : ''}` });
    } catch (error) {
      toast({
        kind: 'error',
        message: error instanceof Error && error.message ? error.message : 'Không lưu được Debit Note. Vui lòng thử lại.',
      });
    } finally {
      setExportingNote(false);
    }
  }

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
            canExportDebitNote={canExportDebitNote}
            exportDebitPending={exportingNote}
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
              settlementDialogRows.current = picked.map(toSettlementDialogRow);
              setSettlementOpen(true);
            }}
            onExportDebitNote={canExportDebitNote ? () => requestExportDebitNote() : undefined}
            quickFilters={(
              <>
                <UuiSelectField
                  label="Khách hàng"
                  value={customerId}
                  onChange={(event) => { setSelectedIds(new Set()); setCustomerId(event.target.value); }}
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
                    onChange={(event) => { setSelectedIds(new Set()); setSearch(event.target.value); }}
                  />
                </label>
                {/* SIL-876 — lọc Tu ngày–Đen ngày trên cột Ngày. */}
                <DateRangeFields
                  id="debit-merge-date-range"
                  ariaLabel="Khoảng ngày giao"
                  from={dateFrom}
                  to={dateTo}
                  onChange={({ from, to }) => { setSelectedIds(new Set()); setDateFrom(from); setDateTo(to); }}
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
        {/* SIL-974 (K10.54 §10.8.6) — mục "Ngoài chốt" chỉ đọc dưới Bảng 2.3:
            hiển thị các chuyến chưa gắn đầu việc vận chuyển để đối soát,
            KHÔNG vào bất kỳ tổng chốt nào; ẩn khi không có dòng nào. */}
        {unattachedTrips.length > 0 && (
          <section className="debit-merge-unattached" aria-label="Ngoài chốt">
            <h2 className="debit-merge-unattached__title">Ngoài chốt</h2>
            <p className="debit-merge-unattached__excluded">
              Tổng tiền bị loại khỏi chốt: {excludedTotal == null ? 'Chưa xác định' : formatMoney(excludedTotal)}
            </p>
            <UnattachedTripsTable trips={unattachedTrips} />
          </section>
        )}
      </section>
      <DebitSettlementRoundDialog
        isOpen={settlementOpen}
        rows={settlementDialogRows.current}
        defaultDateFrom=""
        defaultDateTo=""
        serverError={settlementMutation.error instanceof Error ? settlementMutation.error.message : null}
        onSubmit={settlementMutation.mutateAsync}
        onClose={() => setSettlementOpen(false)}
        isPending={settlementMutation.isPending}
      />

      {/* SIL-866 — FB-094 consent, moved with the button: explicit consent
          before the export locks the still-unlocked lots in the selection
          (the SAME [Khóa lô] channel the toolbar button runs). Cancel locks
          nothing; a lock refusal surfaces and the preview never opens. */}
      <Modal
        isOpen={lockConfirmOpen}
        title="Khóa chi phí để xuất Debit Note"
        onClose={() => setLockConfirmOpen(false)}
      >
        <p style={{ margin: '0 0 8px' }}>
          {unlockedSelectedRows.length} lô trong lựa chọn chưa khóa chi phí.
          Debit Note chỉ xuất được từ số liệu đã chốt: hệ thống sẽ khóa chi phí
          {' '}{unlockedSelectedRows.length} lô này — đóng băng đúng số liệu bảng đang hiển thị — rồi xuất Debit Note cho toàn bộ {selectedRows.length} lô đã chọn.
        </p>
        <p className="debit-note" style={{ margin: '0 0 12px' }}>
          {unlockedSelectedRows.map((row) => row.billOrBookNumber ?? row.code ?? `#${row.shipmentId}`).join(', ')}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" size="sm" onClick={() => setLockConfirmOpen(false)}>Hủy</Btn>
          <Btn
            variant="primary"
            size="sm"
            disabled={exportingNote}
            onClick={async () => {
              setLockConfirmOpen(false);
              try {
                await lockSelectedForExport();
              } catch (error) {
                toast({
                  kind: 'error',
                  message: error instanceof Error && error.message ? error.message : 'Không khóa được lô. Vui lòng thử lại.',
                });
                return;
              }
              refreshBoard();
              setExportPreviewOpen(true);
            }}
          >
            Khóa & xem trước
          </Btn>
        </div>
      </Modal>

      {/* SIL-866 — the preview between [Xuất Debit Note] and the issue, ON the
          Ghép bộ Debit surface where the chain lives: gom theo đợt Lần/Tháng/
          Năm (server preview trên cùng nền khóa đông lạnh), 100% BKS báo
          khách, 4 dòng tổng đối chiếu được; [Lưu] / [Lưu và tải file XLSX]
          are the ONLY acts that push the đợt to Công nợ phải thu/trả. */}
      <DebitNotePreviewDialog
        open={exportPreviewOpen}
        customerIds={selectedCustomerIds}
        rounds={roundsQuery.data?.items ?? []}
        busy={exportingNote}
        onSaveOnly={(payload) => void saveDebitNoteAndExit(false, payload)}
        onSaveAndDownload={(payload) => void saveDebitNoteAndExit(true, payload)}
        onClose={() => setExportPreviewOpen(false)}
      />
      {reasonDialog}
    </div>
  );
}

export default DebitMergePage;
