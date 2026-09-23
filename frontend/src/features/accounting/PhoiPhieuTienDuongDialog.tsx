import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmPhoiPhieuTienDuong, getPhoiPhieuTienDuong } from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { formatCurrency } from '../../lib/format';
import { DRIVER_INCIDENTAL_COST_LABELS } from '@tingting/shared';
import '../ops/ops-modal.css';
import { OpsModalBackdrop } from '../ops/OpsModalBackdrop';

interface Props {
  tripId: number;
  onClose: () => void;
  onSaved: () => void;
}

export function PhoiPhieuTienDuongDialog({ tripId, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: qk.phoiPhieu.tienDuong(tripId),
    queryFn: () => getPhoiPhieuTienDuong(tripId),
  });
  const [confirming, setConfirming] = useState<number | null>(null);
  const [error, setError] = useState('');
  const confirmLock = useRef(false);

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
    if (confirmLock.current || detail.isFetching) return;
    confirmLock.current = true;
    setConfirming(row.sourceId);
    setError('');
    try {
      await confirmPhoiPhieuTienDuong(tripId, row.sourceId, row.version);
      await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.tienDuong(tripId) });
      onSaved();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Không xác nhận được khoản.');
    } finally {
      confirmLock.current = false;
      setConfirming(null);
    }
  }

  return (
    <OpsModalBackdrop onClose={onClose} ariaLabel="Chi tiết tiền đường">
      {/* Card 20260922_67: house modal shell — portal + backdrop + Escape +
          focus return. The backdrop carries the dialog role. */}
      <div className="ops-modal" style={{ maxWidth: 640 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 'var(--text-body-size)' }}>Chi tiết tiền đường {detail.data?.tripCode ?? ''}</h2>
        <button type="button" aria-label="Đóng" onClick={onClose}>✕</button>
      </header>
      <div className="ops-modal__body">
        {detail.isLoading && <p>Đang tải…</p>}
        {(error || detail.isError) && <p role="alert" style={{ color: 'var(--err, #dc2626)' }}>{error || detail.error?.message} <button type="button" className="btn btn--secondary btn--sm" disabled={confirming !== null || detail.isFetching} onClick={() => void detail.refetch().then(result => { if (!result.isError) setError(''); })}>Tải lại khoản chi</button></p>}
        {detail.data && (
          <>
            <table className="tt-table" style={{ fontSize: 'var(--text-caption-size)' }}>
              <thead><tr>
                <th>STT</th><th>Khoản lái xe nhập</th><th>Ngày</th><th>Lái xe</th><th>Lái xe nhập ban đầu (đ)</th><th>Thực chi hiện tại (đ)</th><th>Kế toán duyệt</th>
              </tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.sourceId}>
                    <td>{index + 1}</td>
                    <td>{row.feeName || DRIVER_INCIDENTAL_COST_LABELS[row.costType as keyof typeof DRIVER_INCIDENTAL_COST_LABELS] || row.costType}</td>
                    <td>{row.occurredAt ?? '—'}</td>
                    <td>{row.driverName ?? '—'}</td>
                    <td>{formatCurrency(row.driverEnteredAmount ?? row.amount)}</td>
                    <td>{formatCurrency(row.amount)}</td>
                    <td>
                      {row.confirmed
                        ? <span style={{ color: 'var(--ok, #16a34a)', fontWeight: 600 }}>Đã duyệt</span>
                        : <button type="button" className="btn btn--primary btn--sm" disabled={confirming !== null || detail.isFetching} onClick={() => void tickConfirm(row)}>Tích duyệt</button>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4}><strong>TỔNG CỘNG</strong></td>
                  <td />
                  <td><strong>{totalMoney}</strong></td>
                  <td><strong>{confirmedMoney}</strong></td>
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
    </OpsModalBackdrop>
  );
}
