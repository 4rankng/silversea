import { opsBillReference } from './opsStatus';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Loader2, X } from 'lucide-react';
import {
  useAdminOpsExpenses,
  useAdminOpsSettlements,
  useAdminOpsSettlement,
  useInvalidateOps,
} from '../../hooks/useOpsQueries';
import { opsClient } from '../../api/opsClient';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/shared/Toast';
import { toastActionError } from '../../lib/api/action-error';
import { OpsExpensePhotosModal } from './OpsExpensePhotosModal';
import { OpsSettlementSheet } from './OpsSettlementsPanel';
import { formatMoney } from '../../lib/format';
import { opsContainerScopeLabel } from '../../lib/opsContainerScope';
import { OpsQueryFeedback } from './OpsQueryFeedback';
import { DateRangeFields, FilterBar, UuiSelectField } from '../../design-system';
import { FilterDropdown } from '../../components/FilterDropdown';
import type { OpsExpenseRow } from '../../api/opsClient';
import { useReasonPrompt } from '../../components/reason-prompt';

import './ops-modal.css';
import './ops-accountant-tab.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
import { formatDate } from '../../lib/format';

/** CR-010 E2 (SIL-882) — the reason every in-place Số tiền/Số HĐ edit carries
 *  into the audit trail (EXPENSE_ACCOUNTING_UPDATED payload.reason); the full
 *  before → after rides the payload, so /audit-logs can replay the change. */
const EDIT_REASON = 'Kế toán sửa trực tiếp trên bảng Chi phí Ops (CR-010 E2)';

/**
 * "Chi phí Ops" tab in the advance workspace (OpsVanHanh §5.4): accounting
 * reviews field cash expenses (photos first) and closes settlement batches.
 *
 * Card 191026160000 (§3c): every Ops chi phí now states its KẾ TOÁN DUYỆT
 * state and the accountant can Duyệt it right here. An Ops expense only
 * counts toward hoàn tạm ứng (the ĐNTT column of Báo cáo hoàn ứng) once kế
 * toán confirms it — that confirm used to live only in Kiểm soát phơi phiếu,
 * so "Ops lên chi phí" looked like it never reached accounting. The button
 * posts the SAME batch confirm the phơi phiếu tick-all uses — no forked
 * confirmation path.
 *
 * CR-010 E2 (SIL-882): the board gains (2.1) checkbox bulk-select with
 * [Duyệt đã chọn (N)] / [Từ chối đã chọn (N)] — the reject prompt REQUIRES a
 * reason and the backend persists it onto the row, so /ops/wallet history
 * shows it and the refused row stops blocking duplicates and leaves the
 * settlement grouping; and (2.2) in-place Số tiền/Số HĐ edits on rows that
 * are not yet đối chiếu/quyết toán — each save rides the audited
 * `/entries/OPS/:id/update` endpoint (actor, timestamp, old → new in the
 * audit payload), and every surface (Ví Ops, Ghép bộ Debit, Chi phí - Quyết
 * toán) reads the same source rows, so the new numbers sync by construction.
 */
export function OpsAccountantTab() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [creatorId, setCreatorId] = useState('');
  const { data, isLoading } = useAdminOpsExpenses(undefined, creatorId ? Number(creatorId) : undefined, from || undefined, to || undefined);
  const { data: settlements } = useAdminOpsSettlements();
  const { data: catalog } = useQuery({ queryKey: qk.expenseAccounting.catalog, queryFn: expenseAccountingClient.catalog });
  const { toast } = useToast();
  const { user } = useAuth();
  const canConfirm = user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'ACCOUNTANT';
  const invalidateOps = useInvalidateOps();
  const [confirmBusyId, setConfirmBusyId] = useState<number | null>(null);
  const [photosFor, setPhotosFor] = useState<number | null>(null);
  const [sheetFor, setSheetFor] = useState<number | null>(null);
  const sheet = useAdminOpsSettlement(sheetFor);

  // CR-010 E2 (SIL-882) — bulk duyệt/từ chối (one reason for the selection)
  // and the in-place Số tiền/Số HĐ edit. Selection is only meaningful for
  // rows kế toán can act on (unconfirmed, versioned).
  const { prompt, dialog } = useReasonPrompt();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<'confirm' | 'reject' | null>(null);
  const [edit, setEdit] = useState<{ id: number; field: 'amount' | 'invoiceNumber'; value: string } | null>(null);
  const [editBusyId, setEditBusyId] = useState<number | null>(null);
  const editCommitting = useRef(false);

  const items = data?.items ?? [];
  // SIL-858 — 'Đã hủy / lịch sử' rows never render on the accountant board;
  // history stays reachable through its own surfaces.
  const visibleItems = items.filter((row) => row.approvalStatus !== 'VOIDED' && row.approvalStatus !== 'REJECTED');
  // The settlement detail is what the "Xem phiếu" modal renders; held as a
  // local so the pending/error branches below can share one narrowing.
  const detail = sheet.data;

  // §3c — duyệt one Ops chi: the same expenseConfirmSchema payload the phơi
  // phiếu board sends ({sourceKind:'OPS', sourceId, expectedVersion}).
  const confirmExpense = async (row: typeof items[number]) => {
    if (confirmBusyId !== null || row.version == null) return;
    setConfirmBusyId(row.id);
    try {
      await expenseAccountingClient.confirm([{ sourceKind: 'OPS', sourceId: row.id, expectedVersion: row.version }]);
      invalidateOps();
      toast({ kind: 'success', message: `Đã duyệt chi phí ${opsBillReference(row.billRef)} — khoản này giờ tính vào hoàn tạm ứng.` });
    } catch (cause) {
      toastActionError(toast, 'duyệt chi phí Ops', cause, 'Không duyệt được chi phí.');
    } finally {
      setConfirmBusyId(null);
    }
  };

  // CR-010 E2 (SIL-882) — bulk selection + actions. A row is selectable while
  // kế toán can still act on it: versioned and not yet đối chiếu.
  const actionable = (row: OpsExpenseRow) => canConfirm && row.version != null && row.confirmedAt == null;
  const editable = (row: OpsExpenseRow) => actionable(row) && row.opsSettlementId == null;
  const busy = bulkBusy !== null || confirmBusyId !== null;
  const selectable = visibleItems.filter(actionable);
  const selectedRows = selectable.filter((row) => selectedIds.has(row.id));
  const allSelected = selectable.length > 0 && selectedRows.length === selectable.length;

  const toggleRow = (row: OpsExpenseRow) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(row.id)) next.delete(row.id);
    else next.add(row.id);
    return next;
  });

  const confirmSelected = async () => {
    if (bulkBusy !== null || selectedRows.length === 0) return;
    setBulkBusy('confirm');
    try {
      await expenseAccountingClient.confirm(selectedRows.map((row) => ({ sourceKind: 'OPS' as const, sourceId: row.id, expectedVersion: row.version! })));
      setSelectedIds(new Set<number>());
      invalidateOps();
      toast({ kind: 'success', message: `Đã duyệt ${selectedRows.length} khoản chi Ops — các khoản này giờ tính vào hoàn tạm ứng.` });
    } catch (cause) {
      toastActionError(toast, 'duyệt hàng loạt chi phí Ops', cause, 'Không duyệt được các khoản đã chọn.');
    } finally {
      setBulkBusy(null);
    }
  };

  const rejectRows = async (rows: OpsExpenseRow[]) => {
    if (bulkBusy !== null || confirmBusyId !== null || rows.length === 0) return;
    const reason = await prompt(
      rows.length === 1
        // V25 (BUG-07, CR-010.1) — the modal names the lot the way the papers
        // do (Số Bill/Booking); the internal SHP-* shipment code never renders.
        ? `Từ chối khoản chi ${rows[0].expenseTypeName ?? rows[0].expenseTypeCode} (${formatMoney(rows[0].amount)} ₫) — lô ${opsBillReference(rows[0].billRef)}? Khoản sẽ rời khỏi sổ chi phí, lịch sử giữ nguyên.`
        : `Từ chối ${rows.length} khoản chi đã chọn? Mỗi khoản sẽ rời khỏi sổ chi phí (kèm lý do bên dưới), lịch sử giữ nguyên.`,
      { confirmLabel: 'Từ chối', reasonLabel: 'Lý do từ chối (bắt buộc)' },
    );
    if (!reason) return;
    setBulkBusy('reject');
    try {
      if (rows.length === 1) {
        await expenseAccountingClient.reject({ sourceKind: 'OPS', sourceId: rows[0].id, expectedVersion: rows[0].version! }, reason);
      } else {
        await expenseAccountingClient.rejectBatch(rows.map((row) => ({ sourceKind: 'OPS' as const, sourceId: row.id, expectedVersion: row.version! })), reason);
      }
      setSelectedIds(new Set<number>());
      invalidateOps();
      toast({ kind: 'success', message: `Đã từ chối ${rows.length} khoản chi Ops — lý do đã ghi nhận, khoản rời khỏi Ghép bộ/Quyết toán.` });
    } catch (cause) {
      toastActionError(toast, 'từ chối chi phí Ops', cause, 'Không từ chối được khoản đã chọn.');
    } finally {
      setBulkBusy(null);
    }
  };

  // CR-010 E2 (SIL-882) — in-place Số tiền/Số HĐ edit on rows not yet đối
  // chiếu/quyết toán. Enter/blur saves (one POST /entries/OPS/:id/update —
  // the endpoint audits actor + timestamp + old → new and every surface reads
  // the same row), Esc cancels, invalid money keeps the editor open.
  const isEditing = (row: OpsExpenseRow, field: 'amount' | 'invoiceNumber') => edit?.id === row.id && edit?.field === field;

  const startEdit = (row: OpsExpenseRow, field: 'amount' | 'invoiceNumber') => {
    if (!editable(row) || busy || editBusyId !== null) return;
    setEdit({ id: row.id, field, value: field === 'amount' ? String(row.amount) : row.invoiceNumber?.trim() ?? '' });
  };

  const commitEdit = async () => {
    const current = edit;
    if (!current || editCommitting.current) return;
    const row = items.find((item) => item.id === current.id);
    if (!row || row.version == null) { setEdit(null); return; }
    if (current.field === 'amount') {
      const next = Number(current.value.replace(/\D/g, ''));
      if (!Number.isFinite(next) || next <= 0) {
        toast({ kind: 'error', message: 'Số tiền phải là số dương.' });
        return;
      }
      if (next === Number(row.amount)) { setEdit(null); return; }
    }
    editCommitting.current = true;
    setEdit(null);
    setEditBusyId(current.id);
    try {
      await expenseAccountingClient.update(
        { sourceKind: 'OPS', sourceId: current.id, expectedVersion: row.version },
        current.field === 'amount'
          ? { expectedVersion: row.version, amount: Number(current.value.replace(/\D/g, '')), reason: EDIT_REASON }
          : { expectedVersion: row.version, invoiceNumber: current.value.trim() === '' ? null : current.value.trim(), reason: EDIT_REASON },
      );
      invalidateOps();
      toast({ kind: 'success', message: 'Đã lưu thay đổi — Audit Log ghi nhận cũ → mới.' });
    } catch (cause) {
      toastActionError(toast, 'sửa khoản chi Ops', cause, 'Không lưu được thay đổi.');
    } finally {
      editCommitting.current = false;
      setEditBusyId(null);
    }
  };

  return (
    <div className="ops-acc">
      <section className="ops-wallet__section">
        <header className="ops-wallet__section-head">
          <h2>Khoản chi Ops</h2>

        </header>

        {/* SIL-858 — Kỳ chi (Từ ngày/Đến ngày) + Người lập lệnh chi filters.
            Empty = all time / everyone (the board's previous behavior). */}
        <FilterBar>
          <DateRangeFields
            id="ops-acc-date-range"
            ariaLabel="Kỳ chi"
            fromLabel="Từ ngày"
            toLabel="Đến ngày"
            from={from}
            to={to}
            onChange={({ from: nextFrom, to: nextTo }) => { setFrom(nextFrom); setTo(nextTo); }}
          />
          <FilterDropdown
            count={creatorId ? 1 : 0}
            ariaLabel="Bộ lọc"
            dialogLabel="Bộ lọc chi phí Ops"
            onReset={() => setCreatorId('')}
          >
            <UuiSelectField
              label="Người lập lệnh chi"
              ariaLabel="Người lập lệnh chi"
              value={creatorId}
              onChange={(event) => setCreatorId(event.target.value)}
              options={[{ value: '', label: 'Tất cả' }, ...(catalog?.opsUsers ?? []).map((person) => ({ value: String(person.id), label: person.name }))]}
            />
          </FilterDropdown>
        </FilterBar>

        {/* CR-010 E2 (SIL-882) — bulk duyệt/từ chối: ONE action over the
            selection; Từ chối always asks for a mandatory reason first. */}
        {canConfirm && (
          <div className="ops-acc__bulk" role="toolbar" aria-label="Duyệt / từ chối hàng loạt">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={selectedRows.length === 0 || busy || editBusyId !== null}
              onClick={() => void confirmSelected()}
            >
              {bulkBusy === 'confirm' ? 'Đang duyệt…' : `Duyệt đã chọn (${selectedRows.length})`}
            </button>
            <button
              type="button"
              className="btn btn--danger-outline btn--sm"
              disabled={selectedRows.length === 0 || busy || editBusyId !== null}
              onClick={() => void rejectRows(selectedRows)}
            >
              {bulkBusy === 'reject' ? 'Đang từ chối…' : `Từ chối đã chọn (${selectedRows.length})`}
            </button>
          </div>
        )}

        <div className="ops-wallet__scroll">
          <table className="tt-table ops-wallet__table">
            <thead>
              <tr>
                {canConfirm && (
                  <th className="ops-acc__col--select">
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả"
                      checked={allSelected}
                      disabled={selectable.length === 0 || busy}
                      onChange={() => setSelectedIds(allSelected ? new Set<number>() : new Set(selectable.map((row) => row.id)))}
                    />
                  </th>
                )}
                {/* SIL-895 round 4 — every column carries its measured share
                    (ops-accountant-tab.css): the QA bill tokens
                    ('QATEST-CUOC-001', 'R4B-RG-CUS-LCL1', 'NOSTC26HF67971')
                    and a 16-char worst case hold ONE line at the 1440 canvas,
                    dates and money stay whole, and every header fits its own
                    cell under the SIL-858 wrap law. */}
                <th className="ops-acc__col--date">Ngày</th>
                {/* SIL-858 — the bill th takes the wrap law (ops-accountant-tab.css):
                    nowrap clipped it to "BILL / BOOKIN" and bled onto Cont. */}
                <th className="ops-wallet__col--bill">Bill / Booking</th>
                <th className="ops-acc__col--cont">Cont</th>
                {/* SIL-858 — 3 cột nhận diện lô mới. SIL-877 (CR-009.1 3.2):
                    cột KH/Nhà máy + Số tờ khai lấy share rộng hơn mức chia
                    đều — header chữ dài bị nhét dưới 87px và tràn đè header
                    kế cạnh (ops-accountant-tab.css). */}
                <th className="ops-wallet__col--customer">Khách hàng / Nhà máy</th>
                <th className="ops-wallet__col--declaration">Số tờ khai</th>
                <th className="ops-acc__col--invoice">Số HĐ</th>
                <th className="ops-acc__col--fee">Loại phí</th>
                <th className="ops-acc__col--amount">Số tiền</th>
                <th className="ops-acc__col--payer">Người chi</th>
                <th className="ops-acc__col--receipt">Chứng từ</th>
                {/* SIL-877 (CR-009.1 3.2) — TRẠNG THÁI → SỐ PHIẾU: cột này
                    đọc mã phiếu quyết toán, không phải trạng thái duyệt. */}
                <th className="ops-acc__col--settlement-code">Số phiếu</th>
                {/* §3c — kế toán's duyệt axis: an Ops chi only reaches hoàn
                    tạm ứng (ĐNTT) after this tick, so the state and the act
                    live on the same screen kế toán already reads. */}
                <th className="ops-acc__col--confirm">Duyệt KT</th>
                {/* SIL-858 — cột cuối là Ghi chú; nút [Xem phiếu] dư đã bỏ
                    (số phiếu quyết toán hiện ngay ở Trạng thái, phiếu đọc
                    được ở bảng Phiếu quyết toán Ops bên dưới). */}
                <th className="ops-acc__col--note">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((row) => (
                <tr key={row.id}>
                  {canConfirm && (
                    <td className="ops-acc__col--select">
                      <input
                        type="checkbox"
                        aria-label={`Chọn khoản ${row.expenseTypeName ?? row.expenseTypeCode} ngày ${formatDate(row.paidAt)}`}
                        checked={selectedIds.has(row.id)}
                        disabled={!actionable(row) || busy}
                        onChange={() => toggleRow(row)}
                      />
                    </td>
                  )}
                  <td>{formatDate(row.paidAt)}</td>
                  {/* SIL-884 (6.1) — Bill/Cont cells keep tokens whole (css
                      keep-together law): a long bill number may overflow its
                      cell visibly but never chops mid-token. */}
                  <td className="ops-wallet__cell--bill">{opsBillReference(row.billRef)}</td>
                  <td className="ops-wallet__cell--cont">{opsContainerScopeLabel(row.containerNumber, row.containerNumbers)}</td>
                  <td>
                    {row.customerName || row.factoryName
                      ? <span>
                          <span>{row.customerName ?? '—'}</span>
                          {row.factoryName && (
                            <span style={{ display: 'block', color: 'var(--text-muted, #6b7280)', fontSize: 12 }}>{row.factoryName}</span>
                          )}
                        </span>
                      : '—'}
                  </td>
                  {/* CR-010.1 (BUG-09) — identity cells carry their nowrap
                      law, LOẠI PHÍ its word-boundary law (ops-accountant-tab.css). */}
                  <td className="ops-acc__cell--declaration">{row.declarationNumber?.trim() || '—'}</td>
                  {/* CR-010 E2 (SIL-882) — inline Số HĐ edit: rows chưa đối
                      chiếu/chưa lập phiếu open an input in place; saving rides
                      the audited update endpoint (old → new in the payload). */}
                  <td className="ops-acc__cell--invoice">
                    {editable(row) && !isEditing(row, 'invoiceNumber') ? (
                      <button
                        type="button"
                        className="ops-acc__edit-trigger"
                        aria-label={`Sửa số hóa đơn dòng ${row.id}`}
                        onClick={() => startEdit(row, 'invoiceNumber')}
                      >
                        {row.invoiceNumber?.trim() || 'X'}
                      </button>
                    ) : isEditing(row, 'invoiceNumber') && edit ? (
                      <input
                        type="text"
                        className="ops-acc__edit-input"
                        aria-label="Số hóa đơn"
                        value={edit.value}
                        autoFocus
                        disabled={editBusyId === row.id}
                        onChange={(event) => setEdit({ ...edit, value: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void commitEdit();
                          if (event.key === 'Escape') setEdit(null);
                        }}
                        onBlur={() => void commitEdit()}
                      />
                    ) : (
                      row.invoiceNumber?.trim() || 'X'
                    )}
                  </td>
                  <td className="ops-acc__cell--fee">{row.expenseTypeName ?? row.expenseTypeCode}</td>
                  {/* CR-010 E2 (SIL-882) — inline Số tiền edit, same audited
                      save path as Số HĐ (AC: 1.620.000 → 1.650.000 in place). */}
                  <td className="ops-money">
                    {editable(row) && !isEditing(row, 'amount') ? (
                      <button
                        type="button"
                        className="ops-acc__edit-trigger"
                        aria-label={`Sửa số tiền dòng ${row.id}`}
                        onClick={() => startEdit(row, 'amount')}
                      >
                        {`${formatMoney(row.amount)} ₫`}
                      </button>
                    ) : isEditing(row, 'amount') && edit ? (
                      <input
                        type="text"
                        className="ops-acc__edit-input"
                        aria-label="Số tiền"
                        value={edit.value}
                        autoFocus
                        inputMode="numeric"
                        disabled={editBusyId === row.id}
                        onChange={(event) => setEdit({ ...edit, value: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void commitEdit();
                          if (event.key === 'Escape') setEdit(null);
                        }}
                        onBlur={() => void commitEdit()}
                      />
                    ) : (
                      `${formatMoney(row.amount)} ₫`
                    )}
                  </td>
                  <td>{row.paidByName ?? 'Chưa rõ người chi'}</td>
                  <td>
                    <button
                      type="button"
                      className="ops-doc-state"
                      onClick={() => setPhotosFor(row.id)}
                      title={row.hasPhoto ? 'Xem ảnh biên lai' : 'Chưa có ảnh biên lai — không bắt buộc'}
                    >
                      <ImageIcon size={13} />
                      {row.hasPhoto ? 'Ảnh' : 'Không có ảnh'}
                    </button>
                  </td>
                  {/* SIL-858 — cột Số phiếu hiển thị mã phiếu quyết toán khi
                      đã tất toán (thay vì chỉ 'Đã lập phiếu'). */}
                  <td>{row.approvalStatus === 'DRAFT' ? 'Cần bổ sung' : row.opsSettlementCode ?? 'Chưa quyết toán'}</td>
                  <td>
                    {row.version == null ? '—'
                      : row.confirmedAt != null ? `Đã duyệt ${formatDate(row.confirmedAt)}`
                        : canConfirm ? (
                          <span className="ops-acc__row-actions">
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              // One confirm in flight ⇒ every Duyệt waits (the
                              // busy check is global; leaving siblings enabled
                              // made their clicks die silently — review F5).
                              disabled={busy}
                              onClick={() => void confirmExpense(row)}
                            >
                              {confirmBusyId === row.id ? 'Đang duyệt…' : 'Duyệt'}
                            </button>
                            {/* CR-010 E2 (SIL-882) — [Từ chối] sits beside
                                [Duyệt]: the mandatory-reason prompt posts the
                                SAME /reject twin the đối soát table uses. */}
                            <button
                              type="button"
                              className="btn btn--danger-outline btn--sm"
                              disabled={busy}
                              onClick={() => void rejectRows([row])}
                            >
                              Từ chối
                            </button>
                          </span>
                        ) : 'Chưa duyệt'}
                  </td>
                  <td>{row.note?.trim() || '—'}</td>
                </tr>
              ))}
              {!isLoading && visibleItems.length === 0 && (
                <tr><td colSpan={canConfirm ? 14 : 13} className="ops-wallet__empty">Không có khoản chi nào.</td></tr>
              )}
            </tbody>
          </table>
          {isLoading && <div className="ops-wallet__loading"><Loader2 className="spin" size={18} /></div>}
        </div>
      </section>

      <section className="ops-wallet__section">
        <header className="ops-wallet__section-head">
          <h2>Phiếu quyết toán Ops</h2>
        </header>
        <div className="ops-wallet__scroll">
          <table className="tt-table ops-wallet__table">
            <thead>
              <tr>
                <th>Mã phiếu</th>
                <th>Người lập</th>
                <th>Ngày lập</th>
                <th>Tổng</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {(settlements?.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td className="ops-money">{item.code}</td>
                  <td>{item.opsUserName ?? 'Chưa rõ người lập'}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td className="ops-money">{`${formatMoney(item.totalAmount)} ₫`}</td>
                  <td className="ops-row-actions">
                    <button type="button" className="btn btn--secondary" onClick={() => setSheetFor(item.id)}>Xem</button>

                  </td>
                </tr>
              ))}
              {(settlements?.items ?? []).length === 0 && (
                <tr><td colSpan={5} className="ops-wallet__empty">Chưa có phiếu quyết toán.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {photosFor != null && (
        <OpsExpensePhotosModal expenseId={photosFor} onClose={() => setPhotosFor(null)} />
      )}

      {sheetFor != null && (
        <OpsModalBackdrop onClose={() => setSheetFor(null)} ariaLabel="Phiếu quyết toán Ops">
          <div className="ops-modal">
            <header className="ops-modal__head">
              <h2>{detail?.settlement.code ?? 'Phiếu quyết toán Ops'}</h2>
              <div className="ops-modal__head-actions">
                {detail && <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => void opsClient
                    .downloadSettlementExport(detail.settlement.id, detail.settlement.code, true)
                    .catch((error: unknown) => toastActionError(toast, 'tải Excel phiếu quyết toán', error, 'Tải Excel thất bại.'))}
                >
                  Excel
                </button>}
                <button type="button" aria-label="Đóng" onClick={() => setSheetFor(null)}><X size={16} aria-hidden="true" /></button>
              </div>
            </header>
            <div className="ops-modal__body">
              {/* The modal used to mount only once `data` existed, so "Xem phiếu"
                  looked dead while the request was in flight or after it failed. */}
              <OpsQueryFeedback loading={sheet.isPending} error={sheet.isError} label="phiếu quyết toán" onRetry={sheet.refetch} />
              {detail && <OpsSettlementSheet grouping={detail.grouping} meta={{
                code: detail.settlement.code,
                createdAt: detail.settlement.createdAt,
                opsName: detail.settlement.opsUserName,
                note: detail.settlement.note,
              }} />}
            </div>
          </div>
        </OpsModalBackdrop>
      )}

      {/* CR-010 E2 (SIL-882) — the mandatory 'Lý do từ chối' prompt for both
          the per-row and the bulk reject action. */}
      {dialog}
    </div>
  );
}
