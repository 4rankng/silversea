import { opsBillReference } from './opsStatus';
import { useQuery } from '@tanstack/react-query';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { ExpenseProofs } from '../expense-accounting/ExpenseProofs';
import { useRef, useState } from 'react';
import { Image as ImageIcon, Pencil, Trash2 } from 'lucide-react';
import {
  useOpsWalletExpenses,
  useDeleteOpsExpense,
  useInvalidateOps,
} from '../../hooks/useOpsQueries';
import { tripClient } from '../../api/tripClient';
import type { OpsExpenseRow, OpsExpenseStatus } from '../../api/opsClient';
import { Drawer, useConfirm } from '../../components/UI';
import { Tabs } from '../../design-system';
import { useReasonPrompt } from '../../components/reason-prompt';
import { OpsExpensePhotosModal } from './OpsExpensePhotosModal';
import { OpsExpenseEditModal } from './OpsExpenseEditModal';
import { OpsLegacyExpenseEditModal } from './OpsLegacyExpenseEditModal';
import { useToast } from '../../components/shared/Toast';
import { formatMoney } from '../../lib/format';

import './ops-modal.css';
import { OpsQueryFeedback } from './OpsQueryFeedback';
const STATUS_FILTERS: Array<{ value: OpsExpenseStatus | undefined; label: string }> = [
  { value: undefined, label: 'Tất cả' },
  { value: 'DRAFT', label: 'Cần bổ sung' },
  { value: 'RECORDED', label: 'Đã ghi nhận' },
  { value: 'VOIDED', label: 'Đã hủy' },
];

const STATUS_COLORS: Record<OpsExpenseStatus, string> = {
  DRAFT: 'var(--warn, #d97706)',
  RECORDED: 'var(--ok, #16a34a)',
  VOIDED: 'var(--err, #dc2626)',
  PENDING: 'var(--warn, #d97706)',
  APPROVED: 'var(--ok, #16a34a)',
  REJECTED: 'var(--err, #dc2626)',
};

const STATUS_LABELS: Record<OpsExpenseStatus, string> = {
  DRAFT: 'Cần bổ sung',
  RECORDED: 'Đã ghi nhận',
  VOIDED: 'Đã hủy',
  PENDING: 'Dữ liệu cũ — cần bổ sung',
  APPROVED: 'Đã ghi nhận (lịch sử)',
  REJECTED: 'Đã từ chối (lịch sử)',
};

// Card 071026141580: trip-sourced (khai chi hộ) rows are editable from the
// wallet too — same rule as the chi-hô dialog ("Khoản đã đối chiếu sẽ không
// xóa được"): unconfirmed, unvoided, un-settled rows get Sửa/Xóa regardless of
// source kind; their APIs differ, which the row actions route on.
const isEditableExpense = (row: OpsExpenseRow) =>
  !row.confirmedAt && row.approvalStatus !== 'VOIDED' && row.approvalStatus !== 'REJECTED' && row.opsSettlementId == null;

/**
 * Lịch sử chi phí của Ops (OpsVanHanh §5.3): nhãn đỏ "Nợ chứng từ" khi chưa
 * có ảnh, lọc theo trạng thái, gửi lại khoản bị từ chối, xem/xóa ảnh.
 */
export function OpsExpenseHistory() {
  const [status, setStatus] = useState<OpsExpenseStatus | undefined>(undefined);
  const { data, isLoading, isError, refetch } = useOpsWalletExpenses(status);
  const deleteExpense = useDeleteOpsExpense();
  const { toast } = useToast();
  const deleteLock = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { prompt, dialog: reasonDialog } = useReasonPrompt();
  const [legacyFor, setLegacyFor] = useState<OpsExpenseRow | null>(null);
  const [photosFor, setPhotosFor] = useState<number | null>(null);
  const [editing, setEditing] = useState<OpsExpenseRow | null>(null);
  const [editingLegacy, setEditingLegacy] = useState<OpsExpenseRow | null>(null);
  const invalidate = useInvalidateOps();

  async function handleDelete(row: OpsExpenseRow) {
    if (deleteLock.current) return;
    deleteLock.current = true; setDeleting(true);
    try {
      if (row.sourceKind === 'TRIP') {
        // Card 071026141580: trip rows are deleted through their own API
        // (DELETE /trips/:id/expenses/:eid — the same one the trip cost card
        // uses). That contract takes no reason field, so the wallet shows a
        // plain confirm here instead of the Q10 reason prompt the Ops-expense
        // delete (which stores one) requires.
        const ok = await confirm(`Xóa khoản chi ${row.expenseTypeName ?? row.expenseTypeCode} ${formatMoney(row.amount)} ₫?`, { confirmLabel: 'Xóa', variant: 'danger' });
        if (!ok) return;
        await tripClient.deleteTripExpense(row.tripId ?? 0, row.sourceId ?? 0);
        invalidate();
      } else {
        // Q10 (card 20260922_78): the Ops-expense delete asks for a mandatory
        // free-text reason — cancel/empty aborts without any request.
        const reason = await prompt(`Xóa khoản chi ${row.expenseTypeName ?? row.expenseTypeCode} ${formatMoney(row.amount)} ₫?`, { confirmLabel: 'Xóa' });
        if (reason == null) return;
        await deleteExpense.mutateAsync({ id: row.id, reason });
      }
    } catch (error) { toast({ kind: 'error', message: error instanceof Error ? error.message : 'Không xóa được khoản chi. Vui lòng thử lại.' }); }
    finally { deleteLock.current = false; setDeleting(false); }
  }

  const items = data?.items ?? [];

  const hasEditableRow = items.some((row: OpsExpenseRow) => isEditableExpense(row));

  return (
    <section className="ops-wallet__section" aria-label="Lịch sử chi phí">
      <header className="ops-wallet__section-head">
        <h2>Lịch sử chi phí</h2>
        <Tabs
          variant="boxed"
          ariaLabel="Lọc theo trạng thái"
          value={status ?? 'all'}
          onChange={(id) => setStatus(id === 'all' ? undefined : id as OpsExpenseStatus)}
          tabs={STATUS_FILTERS.map((filter) => ({ id: filter.value ?? 'all', label: filter.label }))}
        />
      </header>

      <div className="ops-wallet__scroll">
        {/* Card 20260921_26: the actions column renders only when some row
                     is editable — an always-present empty column read as a rendering bug. */}
        <table className="tt-table ops-wallet__table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Bill / Booking</th>
              <th>Cont</th>
              <th>Loại phí</th>
              <th>Số tiền</th>
              <th>Chứng từ</th>
              <th>Trạng thái</th>
              {hasEditableRow && <th aria-label="Thao tác" />}
            </tr>
          </thead>
          <tbody>
            {items.map((row: OpsExpenseRow) => (
              <tr key={row.id} className="ops-wallet__row">
                <td data-label="Ngày">{row.paidAt.split('-').reverse().join('/')}</td>
                <td data-label="Bill / Booking">{opsBillReference(row.billRef)}</td>
                <td data-label="Cont">{row.containerNumber ?? 'Chung lô'}</td>
                <td data-label="Loại phí">{row.feeName ?? row.expenseTypeName ?? row.expenseTypeCode}</td>
                <td className="ops-money" data-label="Số tiền">{formatMoney(row.amount)} ₫</td>
                <td data-label="Chứng từ">
                  <button
                    type="button"
                    className={`ops-doc-state${row.hasPhoto ? '' : ' is-debt'}`}
                    onClick={() => row.sourceKind === 'TRIP' ? setLegacyFor(row) : (isEditableExpense(row) || (row.confirmedAt && row.opsSettlementId == null)) ? setEditing(row) : setPhotosFor(row.id)}
                    title={row.hasPhoto ? 'Xem ảnh biên lai' : 'Chưa có ảnh biên lai'}
                  >
                    <ImageIcon size={13} />
                    {row.hasPhoto ? 'Ảnh' : 'Nợ chứng từ'}
                  </button>
                </td>
                <td data-label="Trạng thái">
                  <span style={{ color: STATUS_COLORS[row.approvalStatus] }}>
                    {STATUS_LABELS[row.approvalStatus]}
                  </span>
                  {row.approvalStatus === 'REJECTED' && row.rejectionReason && (
                    <span className="ops-reject-reason" title={row.rejectionReason}> — {row.rejectionReason}</span>
                  )}
                </td>
                {hasEditableRow && (
                <td className="ops-row-actions" aria-label="Thao tác">
                  {isEditableExpense(row) && (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      aria-label={`Sửa khoản chi ${opsBillReference(row.billRef)}`}
                      onClick={() => (row.sourceKind === 'TRIP' ? setEditingLegacy(row) : setEditing(row))}
                    >
                      <Pencil size={13} />
                    </button>
                  )}

                  {isEditableExpense(row) && (
                    <button
                      type="button"
                      className="btn btn--secondary ops-danger"
                      aria-label={`Xóa khoản chi ${opsBillReference(row.billRef)}`}
                      disabled={deleting}
                      onClick={() => void handleDelete(row)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
                )}
              </tr>
            ))}
            {!isLoading && !isError && items.length === 0 && (
              <tr><td colSpan={hasEditableRow ? 8 : 7} className="ops-wallet__empty">Chưa có khoản chi nào.</td></tr>
            )}
          </tbody>
        </table>
        <OpsQueryFeedback loading={isLoading} error={isError} label="lịch sử chi phí" onRetry={refetch} />
      </div>

      {photosFor != null && (
        <OpsExpensePhotosModal expenseId={photosFor} onClose={() => setPhotosFor(null)} />
      )}
      {editing && (
        <OpsExpenseEditModal entry={editing} onClose={() => setEditing(null)} />
      )}
      {editingLegacy && (
        <OpsLegacyExpenseEditModal entry={editingLegacy} onClose={() => setEditingLegacy(null)} />
      )}
      {legacyFor && <OpsLegacyExpenseDetail row={legacyFor} onClose={() => setLegacyFor(null)} />}
      {dialog}
      {reasonDialog}
    </section>
  );
}

function OpsLegacyExpenseDetail({ row, onClose }: { row: OpsExpenseRow; onClose: () => void }) {
  const query = useQuery({ queryKey: qk.opsLegacyExpense(row.sourceId), queryFn: () => expenseAccountingClient.get({ sourceKind: 'TRIP', sourceId: row.sourceId! }) });
  return <Drawer isOpen onClose={onClose} title="Khoản chi được nhập từ kế toán" footer={<button className="btn btn--secondary" onClick={onClose}>Đóng</button>}>
    <p>{opsBillReference(row.billRef)} · {row.feeName ?? row.expenseTypeName}</p>
    <p>Thực chi: <strong>{formatMoney(row.amount)} ₫</strong></p>
    {row.note && <p style={{ whiteSpace: 'pre-wrap' }}>{row.note}</p>}
    {query.isLoading && <p role="status">Đang tải chứng từ…</p>}
    {query.isError && <p role="alert">Chưa tải được khoản chi. <button onClick={() => void query.refetch()}>Thử lại</button></p>}
    {query.data && <ExpenseProofs entry={query.data} canUpload={false} />}
  </Drawer>;
}
