import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAccountingDebitBoard,
  sendRateAdjustmentRequests,
  confirmRateAdjustments,
  withdrawRateAdjustments,
  listSettlementRounds,
  createSettlementRound,
  DEBIT_SETTLEMENT_ROUNDS_KEY,
} from '../../api/accountingDebitClient';
import { createDebitNoteBatch, exportDebitNoteFile } from '../../api/shipmentDebit';
import { formatCurrency } from '../../lib/format';
import { qk } from '../../api/keys';
import { PageHeader } from '../../components/UI';
import { FilterDropdown } from '../../components/FilterDropdown';
import { DateRangeFields, EmptyState, FilterBar, SearchableMultiSelect, SummaryRail } from '../../design-system';
import { useHiddenColumns } from '../../hooks/useHiddenColumns';
import { resolveHiddenColumns } from '../../lib/column-visibility';
import { useTableRowSelection } from '../../hooks/useTableRowSelection';
import { SkeletonTable } from '../../components/shared/Skeleton';
import { DebitSettlementRoundDialog } from './DebitSettlementRoundDialog';
import { BOARD_CAPTION, BOARD_COLUMNS, type CellContext } from './AccountingDebitClosePage.columns';
import { DebitBoardTable } from './AccountingDebitClosePage.board';
import { DebitRoundBoard } from './AccountingDebitClosePage.rounds';
import { AccountingDebitRecords } from './AccountingDebitRecords';
import './AccountingDebitClosePage.css';

/**
 * Kế toán chốt debit — the screen, over the board card 20260921_21 defines.
 * Redesigned 2026-09-29 (rationale + measurements: `docs/design-guidelines.md`,
 * "One page heading…" → "Filter plane and primitives"). The column model is
 * `AccountingDebitClosePage.columns.tsx`; the settlement rounds are
 * `AccountingDebitClosePage.rounds.tsx` — the two real seams, split for the
 * structure guard's 400-line ceiling.
 */

interface BoardFilters { dateFrom: string; dateTo: string }

export default function AccountingDebitClosePage() {
  const [filters, setFilters] = useState<BoardFilters>({ dateFrom: '', dateTo: '' });
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState<string[]>([]);
  const [truckFilter, setTruckFilter] = useState<string[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [settlementOpen, setSettlementOpen] = useState(false);
  // FB-094 (card 181026145620) — Xuất Debit Note over the selected rows.
  const [exportingNote, setExportingNote] = useState(false);
  const queryClient = useQueryClient();

  const boardQuery = useQuery({
    queryKey: qk.accounting.debitBoard(filters.dateFrom, filters.dateTo),
    queryFn: () => listAccountingDebitBoard({ dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined }),
  });
  const roundsQuery = useQuery({
    queryKey: DEBIT_SETTLEMENT_ROUNDS_KEY,
    queryFn: listSettlementRounds,
  });
  const rows = useMemo(() => boardQuery.data?.items ?? [], [boardQuery.data]);

  // The picker offers every column except the ones a row cannot lose: its
  // identity (Ngày, lô) and the only column carrying its action (Đối soát). A
  // column that is still "Thiếu …" on every rendered row carries NO value, so
  // it hides itself until it does (column-visibility law).
  //
  // Card 191026181942 (KT4): the board now OPENS on its essential set — dot
  // chi phí, Ngày, lô, Tổng thu, Tổng 1, Đối soát (≤6 columns). With every
  // breakdown visible the money matrix was unreadable and QA had to hide
  // columns by hand on every visit; the breakdowns stay one toggle away in the
  // picker, and a stored choice (per workstation, same key as before) still
  // wins wholesale.
  const columns = useHiddenColumns({
    storageKey: 'accounting-debit-hidden-cols',
    columns: BOARD_COLUMNS,
    defaultVisible: 'essential',
    hasData: (column) => {
      const definition = BOARD_COLUMNS.find((candidate) => candidate.key === column.key);
      if (definition?.raw == null) return true;
      return rows.some((row) => definition.raw!(row) != null);
    },
  });
  const shown = BOARD_COLUMNS.filter((column) => !columns.isHidden(column.key));
  // Card 191026181942 (KT4): the ESSENTIAL default is the DESKTOP board's —
  // its money matrix is the surface that could not be read with every
  // breakdown open. The phone records stack vertically, so they keep the
  // auto default (a column with data shows) and never lose the BD-02 lane
  // price on the card face. The operator's explicit picker choice still
  // governs BOTH views (one stored key) — only the never-chose default
  // differs per view.
  const shownForRecords = BOARD_COLUMNS.filter((column) => !resolveHiddenColumns({
    columns: BOARD_COLUMNS,
    choice: columns.choice,
    hasData: (column) => {
      const definition = BOARD_COLUMNS.find((candidate) => candidate.key === column.key);
      if (definition?.raw == null) return true;
      return rows.some((row) => definition.raw!(row) != null);
    },
  }).includes(column.key));

  const customerValues = useMemo(
    () => [...new Set(rows.map((row) => row.customerName).filter((v): v is string => v != null))].sort(),
    [rows],
  );
  const truckValues = useMemo(
    () => [...new Set(rows.flatMap((row) => row.phanXe))].sort(),
    [rows],
  );

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (customerFilter.length > 0 && (row.customerName == null || !customerFilter.includes(row.customerName))) return false;
      if (truckFilter.length > 0 && !row.phanXe.some((truck) => truckFilter.includes(truck))) return false;
      if (needle === '') return true;
      return [row.code, row.billOrBooking, row.customerName, ...row.containers, ...row.phanXe]
        .some((value) => value != null && value.toLowerCase().includes(needle));
    });
  }, [rows, customerFilter, truckFilter, search]);

  // Pickable = no live adjustment (NONE) or a CONFIRMED one (a new adjustment
  // cycle may be requested until the lot's cost lock freezes it). A live PENDING
  // row shows its Xác nhận/Rút controls instead of being pickable.
  const selectableRows = useMemo(
    () => visibleRows.filter((row) => row.adjustment.status === 'NONE' || row.adjustment.status === 'CONFIRMED'),
    [visibleRows],
  );
  const selectableIds = useMemo(() => selectableRows.map((row) => row.shipmentId), [selectableRows]);
  const selection = useTableRowSelection<number>();
  const { isSelected, countAmong, allOfSelected } = selection;
  const pendingRows = useMemo(() => visibleRows.filter((row) => row.adjustment.status === 'PENDING'), [visibleRows]);
  const settledRows = useMemo(() => visibleRows.filter((row) => row.adjustment.status !== 'PENDING'), [visibleRows]);
  const pendingIds = useMemo(
    () => pendingRows.map((row) => row.adjustment.requestId).filter((id): id is number => id != null),
    [pendingRows],
  );
  const selectedCount = countAmong(selectableIds);
  const selectedRows = useMemo(
    () => selectableRows.filter((row) => isSelected(row.shipmentId)),
    [selectableRows, isSelected],
  );
  // Bulk actions in the sticky selection strip act on the SELECTED rows'
  // adjustment requests — the same requestIds the per-row "Xác nhận/Rút"
  // buttons feed into confirmMutation/withdrawMutation, so no new business
  // path is created, only a second entry point over the current selection.
  const selectedRequestIds = useMemo(
    () => selectedRows.map((row) => row.adjustment.requestId).filter((id): id is number => id != null),
    [selectedRows],
  );
  const allSelected = allOfSelected(selectableIds);

  const summary = useMemo(() => [
    { label: 'Lô trong kỳ', value: visibleRows.length },
    { label: 'Chưa đối soát', value: visibleRows.filter((row) => row.adjustment.status === 'NONE').length },
    { label: 'Chờ xác nhận', value: pendingRows.length, tone: 'warning' as const },
    { label: 'Đã đối soát', value: visibleRows.filter((row) => row.adjustment.status === 'CONFIRMED').length },
  ], [visibleRows, pendingRows]);

  const refresh = () => {
    selection.clear();
    void queryClient.invalidateQueries({ queryKey: qk.accounting.debitBoardAll });
    void queryClient.invalidateQueries({ queryKey: DEBIT_SETTLEMENT_ROUNDS_KEY });
  };

  const sendMutation = useMutation({
    mutationFn: sendRateAdjustmentRequests,
    onSuccess: (result) => {
      const parts = [
        result.requested.length > 0 ? `đã gửi ${result.requested.length} lô` : null,
        result.alreadyPending.length > 0 ? `${result.alreadyPending.length} lô đã có yêu cầu chờ` : null,
        result.locked.length > 0 ? `${result.locked.length} lô đã khóa, không gửi được` : null,
      ].filter(Boolean);
      setMessage({ kind: 'ok', text: `Yêu cầu điều chỉnh cước: ${parts.join(', ')}.` });
      refresh();
    },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });
  const confirmMutation = useMutation({
    mutationFn: confirmRateAdjustments,
    onSuccess: () => { setMessage({ kind: 'ok', text: 'Đã xác nhận đối soát.' }); refresh(); },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });
  const withdrawMutation = useMutation({
    mutationFn: withdrawRateAdjustments,
    onSuccess: () => { setMessage({ kind: 'ok', text: 'Đã rút yêu cầu.' }); refresh(); },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });
  const settlementMutation = useMutation({
    mutationFn: createSettlementRound,
    onSuccess: (round) => {
      const total = Number(round.amount) + Math.round(Number(round.amount) * round.vatRate) / 100;
      setMessage({ kind: 'ok', text: `Đã chốt đợt: Lần ${round.roundNo} · ${round.periodKey.replaceAll('-', '/')} — ${formatCurrency(total)} (đã gồm VAT).` });
      setSettlementOpen(false);
      refresh();
    },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });

  const cellContext: CellContext = {
    confirm: (requestIds) => confirmMutation.mutate(requestIds),
    withdraw: (requestIds) => withdrawMutation.mutate(requestIds),
    isBusy: confirmMutation.isPending || withdrawMutation.isPending,
  };

  function toggleAll() {
    if (allSelected) selection.clear();
    else selection.selectAll(selectableIds);
  }

  function sendRequest() {
    if (selectedCount === 0) {
      setMessage({ kind: 'err', text: 'Chọn ít nhất một dòng lô hàng.' });
      return;
    }
    sendMutation.mutate({ shipmentIds: selectedRows.map((row) => row.shipmentId) });
  }

  // FB-094 — Xuất Debit Note (theo dòng đang chọn): ONE issue call carries the
  // whole selection (`POST /api/shipments/debit-notes`, stable Idempotency-Key
  // so a re-click replays the same document) and the issued union document
  // downloads through the per-lot export mount — the exact
  // `ShipmentDebitPage.exportSelectedLockedLots` house flow. Server refusals
  // surface verbatim in the message banner; no file is downloaded on error.
  async function exportDebitNote() {
    const ids = selectedRows.map((row) => row.shipmentId);
    if (ids.length === 0 || exportingNote) return;
    setExportingNote(true);
    try {
      const selectionKey = `debit-note-${[...ids].sort((x, y) => x - y).join('-')}`;
      const { id: documentId } = await createDebitNoteBatch(ids, selectionKey);
      const blob = await exportDebitNoteFile(ids[0], documentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `giay-bao-no-${selectedRows[0]?.billOrBooking || 'chua-xac-dinh'}.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage({ kind: 'ok', text: `Đã xuất Debit Note (${ids.length} lô).` });
    } catch (error) {
      setMessage({
        kind: 'err',
        text: error instanceof Error && error.message ? error.message : 'Không xuất được Debit Note. Vui lòng thử lại.',
      });
    } finally {
      setExportingNote(false);
    }
  }

  function resetFacets() {
    setCustomerFilter([]);
    setTruckFilter([]);
    selection.clear();
  }

  // Card 20261002_285 AC3: the badge counts CRITERIA, not selected values — it
  // summed the arrays' lengths, so 3 customers + 1 truck read "4 đang áp dụng"
  // while one `Đặt lại` cleared both, a count no operator could reach by clearing.
  const facetCount = (customerFilter.length ? 1 : 0) + (truckFilter.length ? 1 : 0);
  const period = [filters.dateFrom, filters.dateTo].filter(Boolean).join(' – ');
  const roundItems = roundsQuery.data?.items ?? [];

  return (
    <div className="page-shell">
      <PageHeader title="Kế toán chốt debit" />

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Mã lô, bill/booking, khách hàng, container',
          ariaLabel: 'Tìm lô hàng',
        }}
        columns={{
          items: BOARD_COLUMNS,
          hidden: columns.hidden,
          customized: columns.customized,
          onToggle: columns.toggle,
          onReset: columns.reset,
        }}
        actions={(
          <>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={pendingIds.length === 0 || confirmMutation.isPending}
              title={pendingIds.length === 0 ? 'Không có dòng nào đang chờ xác nhận đối soát trong bộ lọc hiện tại' : undefined}
              onClick={() => confirmMutation.mutate(pendingIds)}
            >
              {confirmMutation.isPending ? 'Đang xác nhận…' : `Xác nhận đối soát (${pendingIds.length})`}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={selectedCount === 0 || settlementMutation.isPending}
              title={selectedCount === 0 ? 'Chọn ít nhất một dòng lô để mở popup chốt đợt' : undefined}
              onClick={() => setSettlementOpen(true)}
            >
              {`Chọn Debit (${selectedCount} dòng)`}
            </button>
            {/* FB-094 — the missing last step of the chốt flow: issue + download
                the Debit Note for the selected rows (theo dòng). */}
            <button
              type="button"
              className="btn btn--secondary"
              disabled={selectedCount === 0 || exportingNote}
              title={selectedCount === 0 ? 'Chọn ít nhất một dòng lô để xuất Debit Note' : undefined}
              onClick={() => void exportDebitNote()}
            >
              {exportingNote ? 'Đang xuất…' : 'Xuất Debit Note'}
            </button>
          </>
        )}
      >
        <DateRangeFields
          id="debit-board-date-range"
          ariaLabel="Khoảng ngày lô hàng"
          from={filters.dateFrom}
          to={filters.dateTo}
          onChange={({ from, to }) => setFilters({ dateFrom: from, dateTo: to })}
        />
        <FilterDropdown
          count={facetCount}
          ariaLabel="Bộ lọc"
          dialogLabel="Bộ lọc chốt debit"
          onReset={resetFacets}
        >
          <SearchableMultiSelect
            id="debit-customer-filter"
            size="sm"
            values={customerFilter}
            onChange={(next) => { setCustomerFilter(next); selection.clear(); }}
            options={customerValues.map((value) => ({ value, label: value }))}
            placeholder="Khách hàng"
            selectionLabel="khách hàng"
            countSuffix="đã chọn"
            clearAllLabel="Bỏ chọn"
          />
          <SearchableMultiSelect
            id="debit-truck-filter"
            size="sm"
            values={truckFilter}
            onChange={(next) => { setTruckFilter(next); selection.clear(); }}
            options={truckValues.map((value) => ({ value, label: value }))}
            placeholder="Nhà xe (phân xe)"
            selectionLabel="nhà xe"
            countSuffix="đã chọn"
            clearAllLabel="Bỏ chọn"
          />
        </FilterDropdown>
      </FilterBar>

      {/* Card 20261005 — the selection strip sits DIRECTLY under the filter bar
          and stays pinned while the money matrix scrolls beneath it: the
          selected count and the two primary actions (Đối soát / Hoàn tác) are
          always in reach. The actions feed the SAME confirm/withdraw mutations
          the per-row buttons use, over the current selection — a second entry
          point, not a new business path. */}
      <div className="debit-selection">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={selectableIds.length === 0}
          title="Chọn tất cả lô đủ điều kiện trong bộ lọc hiện tại"
          onClick={toggleAll}
        >
          {allSelected ? 'Bỏ chọn tất cả' : `Chọn tất cả ${selectableIds.length} lô đủ điều kiện`}
        </button>
        {selectedCount > 0 && <span className="debit-note">Đã chọn {selectedCount} lô</span>}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={selectedRequestIds.length === 0 || confirmMutation.isPending}
          title={selectedRequestIds.length === 0 ? 'Chọn ít nhất một dòng đang chờ xác nhận để đối soát' : undefined}
          onClick={() => confirmMutation.mutate(selectedRequestIds)}
        >
          {confirmMutation.isPending ? 'Đang đối soát…' : 'Đối soát'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={selectedRequestIds.length === 0 || withdrawMutation.isPending}
          title={selectedRequestIds.length === 0 ? 'Chọn ít nhất một dòng để hoàn tác yêu cầu điều chỉnh' : undefined}
          onClick={() => withdrawMutation.mutate(selectedRequestIds)}
        >
          {withdrawMutation.isPending ? 'Đang hoàn tác…' : 'Hoàn tác'}
        </button>
        {selectedCount > 0 && (
          <>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={sendMutation.isPending}
              onClick={sendRequest}
            >
              {sendMutation.isPending ? 'Đang gửi…' : 'Gửi yêu cầu điều chỉnh cước'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => selection.clear()}>Bỏ chọn</button>
          </>
        )}
      </div>

      <span aria-live="polite">
        {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className="debit-note">{message.text}</p>}
      </span>

      <SummaryRail ariaLabel="Tổng hợp chốt debit" items={summary} />

      {boardQuery.isError && <p role="alert">Không tải được bảng tổng hợp. Vui lòng thử lại.</p>}

      {/* While the board loads the operator gets the shared skeleton, never an
          empty table wearing the real headers (which reads as "no lots"). */}
      {boardQuery.isLoading && <SkeletonTable rows={8} cols={7} />}

      {!boardQuery.isLoading && (visibleRows.length === 0 ? (
        <EmptyState
          variant="compact"
          context={rows.length === 0 ? 'finance' : 'search'}
          title={rows.length === 0 ? 'Không có lô hàng trong khoảng thời gian này' : 'Không có lô nào khớp bộ lọc'}
          description={rows.length === 0
            ? 'Chọn khoảng ngày khác, hoặc kiểm tra lô đã được chốt ở đợt trước.'
            : 'Xóa bộ lọc để xem lại toàn bộ lô trong kỳ.'}
        />
      ) : (
        <>
          {/* The board's own identity. The H1 names the SCREEN; this names the
              DOCUMENT the board renders, where the period can sit beside it
              instead of being welded onto the page title. */}
          {/* FB-099 (card 141026230760) — ba vùng rõ: tổng hợp (SummaryRail) /
              chờ xác nhận (dòng PENDING, vùng riêng) / tổng hợp công nợ (các
              đợt chốt). Chỉ tách bố cục — dữ liệu, nút, quyền, câu chữ giữ
              nguyên (TC-COSTUX-05). */}
          {pendingRows.length > 0 && (
            <>
              <h2 className="debit-board__title">Chờ xác nhận</h2>
              <AccountingDebitRecords rows={pendingRows} columns={shownForRecords} context={cellContext} selection={selection} />
              <DebitBoardTable
                rows={pendingRows}
                columns={shown}
                context={cellContext}
                selection={selection}
                ariaLabel="Bảng chờ xác nhận điều chỉnh cước"
                caption="Chờ xác nhận — lô có yêu cầu điều chỉnh cước đang chờ"
              />
            </>
          )}
          {settledRows.length > 0 && (
            <>
              <h2 className="debit-board__title">
                {BOARD_CAPTION}
                {period !== '' && <span className="debit-note"> · kỳ {period}</span>}
              </h2>
              <AccountingDebitRecords rows={settledRows} columns={shownForRecords} context={cellContext} selection={selection} />
              <DebitBoardTable
                rows={settledRows}
                columns={shown}
                context={cellContext}
                selection={selection}
                ariaLabel="Bảng kế hoạch điều động tổng hợp"
                caption={`${BOARD_CAPTION} — thu/trả theo lô`}
              />
              <p className="debit-board__hint ledger-desktop">Bảng cuộn ngang — dùng ← → hoặc vuốt để xem đủ cột.</p>
            </>
          )}
        </>
      ))}

      <DebitSettlementRoundDialog
        isOpen={settlementOpen}
        rows={selectedRows}
        defaultDateFrom={filters.dateFrom}
        defaultDateTo={filters.dateTo}
        serverError={settlementMutation.error instanceof Error ? settlementMutation.error.message : null}
        onSubmit={(body) => settlementMutation.mutate(body)}
        onClose={() => setSettlementOpen(false)}
        isPending={settlementMutation.isPending}
      />

      <DebitRoundBoard rounds={roundItems} />
    </div>
  );
}
