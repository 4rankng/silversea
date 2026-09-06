import { useState } from 'react';
import { Image as ImageIcon, Loader2, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import {
  useOpsWalletExpenses,
  useDeleteOpsExpense,
  useResendOpsExpense,
} from '../../hooks/useOpsQueries';
import type { OpsExpenseRow, OpsExpenseStatus } from '../../api/opsClient';
import { useConfirm } from '../../components/UI';
import { OpsExpensePhotosModal } from './OpsExpensePhotosModal';
import { OpsExpenseEditModal } from './OpsExpenseEditModal';
import { formatVnd } from './opsStatus';

const STATUS_FILTERS: Array<{ value: OpsExpenseStatus | undefined; label: string }> = [
  { value: undefined, label: 'Tất cả' },
  { value: 'PENDING', label: 'Chờ duyệt' },
  { value: 'APPROVED', label: 'Đã duyệt' },
  { value: 'REJECTED', label: 'Bị từ chối' },
];

const STATUS_COLORS: Record<OpsExpenseStatus, string> = {
  PENDING: 'var(--warn, #d97706)',
  APPROVED: 'var(--ok, #16a34a)',
  REJECTED: 'var(--err, #dc2626)',
};

const STATUS_LABELS: Record<OpsExpenseStatus, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Bị từ chối',
};

/**
 * Lịch sử chi phí của Ops (OpsVanHanh §5.3): nhãn đỏ "Nợ chứng từ" khi chưa
 * có ảnh, lọc theo trạng thái, gửi lại khoản bị từ chối, xem/xóa ảnh.
 */
export function OpsExpenseHistory() {
  const [status, setStatus] = useState<OpsExpenseStatus | undefined>(undefined);
  const { data, isLoading } = useOpsWalletExpenses(status);
  const deleteExpense = useDeleteOpsExpense();
  const resendExpense = useResendOpsExpense();
  const { confirm, dialog } = useConfirm();
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
              <tr key={row.id}>
                <td>{row.paidAt}</td>
                <td>{row.shipmentCode ?? '—'}</td>
                <td>{row.containerNumber ?? 'Chung lô'}</td>
                <td>{row.expenseTypeName ?? row.expenseTypeCode}</td>
                <td className="ops-money">{formatVnd(row.amount)}</td>
                <td>
                  <button
                    type="button"
                    className={`ops-doc-state${row.hasPhoto ? '' : ' is-debt'}`}
                    onClick={() => setPhotosFor(row.id)}
                    title={row.hasPhoto ? 'Xem ảnh biên lai' : 'Chưa có ảnh biên lai'}
                  >
                    <ImageIcon size={13} />
                    {row.hasPhoto ? 'Ảnh' : 'Nợ chứng từ'}
                  </button>
                </td>
                <td>
                  <span style={{ color: STATUS_COLORS[row.approvalStatus] }}>
                    {STATUS_LABELS[row.approvalStatus]}
                  </span>
                  {row.approvalStatus === 'REJECTED' && row.rejectionReason && (
                    <span className="ops-reject-reason" title={row.rejectionReason}> — {row.rejectionReason}</span>
                  )}
                </td>
                <td className="ops-row-actions">
                  {row.approvalStatus !== 'APPROVED' && row.opsSettlementId == null && (
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Sửa khoản chi ${row.shipmentCode ?? row.id}`}
                      onClick={() => setEditing(row)}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {row.approvalStatus === 'REJECTED' && row.opsSettlementId == null && (
                    <button type="button" className="btn-secondary" onClick={() => void resendExpense.mutateAsync(row.id).catch(() => undefined)}>
                      <RotateCcw size={13} /> Gửi lại
                    </button>
                  )}
                  {row.approvalStatus !== 'APPROVED' && row.opsSettlementId == null && (
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
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={8} className="ops-wallet__empty">Chưa có khoản chi nào.</td></tr>
            )}
          </tbody>
        </table>
        {isLoading && <div className="ops-wallet__loading"><Loader2 className="spin" size={18} /></div>}
      </div>

      {photosFor != null && (
        <OpsExpensePhotosModal expenseId={photosFor} canDelete onClose={() => setPhotosFor(null)} />
      )}
      {editing && (
        <OpsExpenseEditModal entry={editing} onClose={() => setEditing(null)} />
      )}
      {dialog}
    </section>
  );
}
