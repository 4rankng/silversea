import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmPhoiPhieuTienDuong, getPhoiPhieuTienDuong } from '../../api/phoiPhieuClient';
import { formatCurrency } from '../../lib/format';
import { DRIVER_INCIDENTAL_COST_LABELS } from '@tingting/shared';

interface Props {
  tripId: number;
  onClose: () => void;
  onSaved: () => void;
}

export function PhoiPhieuTienDuongDialog({ tripId, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['phoi-phieu-tien-duong', tripId],
    queryFn: () => getPhoiPhieuTienDuong(tripId),
  });
  const [confirming, setConfirming] = useState<number | null>(null);
  const [error, setError] = useState('');

  const rows = detail.data?.rows ?? [];
  const totals = detail.data?.totals;
  const totalMoney = useMemo(
    () => (totals ? formatCurrency(totals.total) : ''),
    [totals],
  );
  const confirmedMoney = useMemo(
    () => (totals ? formatCurrency(totals.confirmed) : ''),
    [totals],
  );

  async function tickConfirm(row: (typeof rows)[number]) {
    setConfirming(row.sourceId);
    setError('');
    try {
      await confirmPhoiPhieuTienDuong(tripId, row.sourceId, 1);
      await queryClient.invalidateQueries({ queryKey: ['phoi-phieu-tien-duong', tripId] });
      onSaved();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Không xác nhận được khoản.');
    } finally {
      setConfirming(row.sourceId === null ? null : row.sourceId);
      setConfirming(null);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Chi tiết tiền đường" className="ops-modal" style={{ maxWidth: 640 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 'var(--text-body-size)' }}>Chi tiết tiền đường {detail.data?.tripCode ?? ''}</h2>
        <button type="button" aria-label="Đóng" onClick={onClose}>✕</button>
      </header>
      <div className="ops-modal__body">
        {detail.isLoading && <p>Đang tải…</p>}
        {error && <p role="alert" style={{ color: 'var(--err, #dc2626)' }}>{error}</p>}
        {detail.data && (
          <>
            <table className="tt-table" style={{ fontSize: 'var(--text-caption-size)' }}>
              <thead><tr>
                <th>STT</th><th>Khoản lái xe nhập</th><th>Ngày</th><th>Lái xe</th><th>Láixe nhập (đ)</th><th>Kế toán duyệt</th>
              </tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.sourceId}>
                    <td>{index + 1}</td>
                    <td>{DRIVER_INCIDENTAL_COST_LABELS[row.costType as keyof typeof DRIVER_INCIDENTAL_COST_LABELS] ?? row.feeName ?? row.costType}</td>
                    <td>{row.occurredAt ?? '—'}</td>
                    <td>{row.driverName ?? '—'}</td>
                    <td>{formatCurrency(row.driverEnteredAmount ?? row.amount)}</td>
                    <td>
                      {row.confirmed
                        ? <span style={{ color: 'var(--ok, #16a34a)', fontWeight: 600 }}>Đã duyệt</span>
                        : <button type="button" className="btn-primary btn--sm" disabled={confirming === row.sourceId} onClick={() => void tickConfirm(row)}>Tích duyệt</button>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4}><strong>TỔNG CỘNG</strong></td>
                  <td><strong>{totalMoney}</strong></td>
                  <td><strong>{confirmedMoney}</strong></td>
                  <td />
                </tr>
              </tbody>
            </table>
            <p style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-3)' }}>
              Khoản đã duyệt mới được lập phiếu chi thanh toán cho lái xe; khoản chưa duyệt không vào phiếu.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
