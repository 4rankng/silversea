import { useQuery } from '@tanstack/react-query';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { ExpenseProofs } from '../expense-accounting/ExpenseProofs';
import { useState } from 'react';
import { Image as ImageIcon, Pencil, Trash2 } from 'lucide-react';
import {
  useOpsWalletExpenses,
  useDeleteOpsExpense,
} from '../../hooks/useOpsQueries';
import type { OpsExpenseRow, OpsExpenseStatus } from '../../api/opsClient';
import { Drawer, useConfirm } from '../../components/UI';
import { OpsExpensePhotosModal } from './OpsExpensePhotosModal';
import { OpsExpenseEditModal } from './OpsExpenseEditModal';
import { formatVnd } from './opsStatus';

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

const isEditableExpense = (row: OpsExpenseRow) =>
  row.sourceKind !== 'TRIP' && !row.confirmedAt && row.approvalStatus !== 'VOIDED' && row.approvalStatus !== 'REJECTED' && row.opsSettlementId == null;

/**
 * Lịch sử chi phí của Ops (OpsVanHanh §5.3): nhãn đỏ "Nợ chứng từ" khi chưa
 * có ảnh, lọc theo trạng thái, gửi lại khoản bị từ chối, xem/xóa ảnh.
 */
export function OpsExpenseHistory() {
  const [status, setStatus] = useState<OpsExpenseStatus | undefined>(undefined);
  const { data, isLoading, isError, refetch } = useOpsWalletExpenses(status);
  const deleteExpense = useDeleteOpsExpense();
  const { confirm, dialog } = useConfirm();
  const [legacyFor, setLegacyFor] = useState<OpsExpenseRow | null>(null);
  const [photosFor, setPhotosFor] = useState<number | null>(null);
  const [editing, setEditing] = useState<OpsExpenseRow | null>(null);

  const items = data?.items ?? [];

  return (
    <section className="ops-wallet__section" aria-label="Lịch sử chi phí">
      <header className="ops-wallet__section-head">
        <h2>Lịch sử chi phí</h2>
        <div className="ops-wallet__filters" role="group" aria-label="Lọc theo trạng thái">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.label}
              type="button"
              className={status === filter.value ? 'is-active' : ''}
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </header>

      <div className="ops-wallet__scroll">
        <table className="tt-table ops-wallet__table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Mã lô</th>
              <th>Cont</th>
              <th>Loại phí</th>
              <th>Số tiền</th>
              <th>Chứng từ</th>
              <th>Trạng thái</th>
              <th aria-label="Thao tác" />
            </tr>
          </thead>
          <tbody>
            {items.map((row: OpsExpenseRow) => (
              <tr key={row.id} className="ops-wallet__row">
                <td data-label="Ngày">{row.paidAt.split('-').reverse().join('/')}</td>
                <td data-label="Mã lô">{row.shipmentCode ?? '—'}</td>
                <td data-label="Cont">{row.containerNumber ?? 'Chung lô'}</td>
                <td data-label="Loại phí">{row.feeName ?? row.expenseTypeName ?? row.expenseTypeCode}</td>
                <td className="ops-money" data-label="Số tiền">{formatVnd(row.amount)}</td>
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
                <td className="ops-row-actions" aria-label="Thao tác">
                  {isEditableExpense(row) && (
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Sửa khoản chi ${row.shipmentCode ?? row.id}`}
                      onClick={() => setEditing(row)}
                    >
                      <Pencil size={13} />
                    </button>
                  )}

                  {isEditableExpense(row) && (
                    <button
                      type="button"
                      className="btn-secondary ops-danger"
                      aria-label={`Xóa khoản chi ${row.shipmentCode ?? row.id}`}
                      onClick={() => void confirm(
                        `Xóa khoản chi ${row.expenseTypeName ?? row.expenseTypeCode} ${formatVnd(row.amount)} ₫?`,
                        { variant: 'danger', confirmLabel: 'Xóa' },
                      ).then((ok) => (ok ? deleteExpense.mutateAsync(row.id) : undefined)).catch(() => undefined)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && !isError && items.length === 0 && (
              <tr><td colSpan={8} className="ops-wallet__empty">Chưa có khoản chi nào.</td></tr>
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
      {legacyFor && <OpsLegacyExpenseDetail row={legacyFor} onClose={() => setLegacyFor(null)} />}
      {dialog}
    </section>
  );
}

function OpsLegacyExpenseDetail({ row, onClose }: { row: OpsExpenseRow; onClose: () => void }) {
  const query = useQuery({ queryKey: ['ops-legacy-expense', row.sourceId], queryFn: () => expenseAccountingClient.get({ sourceKind: 'TRIP', sourceId: row.sourceId! }) });
  return <Drawer isOpen onClose={onClose} title="Khoản chi được nhập từ kế toán" footer={<button className="btn btn--secondary" onClick={onClose}>Đóng</button>}>
    <p>{row.shipmentCode} · {row.feeName ?? row.expenseTypeName}</p>
    <p>Thực chi: <strong>{formatVnd(row.amount)} ₫</strong></p>
    {row.note && <p style={{ whiteSpace: 'pre-wrap' }}>{row.note}</p>}
    {query.isLoading && <p role="status">Đang tải chứng từ…</p>}
    {query.isError && <p role="alert">Chưa tải được khoản chi. <button onClick={() => void query.refetch()}>Thử lại</button></p>}
    {query.data && <ExpenseProofs entry={query.data} canUpload={false} />}
  </Drawer>;
}
