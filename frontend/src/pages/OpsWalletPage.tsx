import { useState } from 'react';
import { Loader2, Plus, Wallet } from 'lucide-react';
import { useOpsWalletSummary, useOpsAdvanceRequests } from '../hooks/useOpsQueries';
import { OpsAdvanceRequestModal } from '../features/ops/OpsAdvanceRequestModal';
import { OpsExpenseHistory } from '../features/ops/OpsExpenseHistory';
import { OpsSettlementsPanel } from '../features/ops/OpsSettlementsPanel';
import { formatVnd } from '../features/ops/opsStatus';
import './OpsWalletPage.css';

const ADVANCE_STATUS_COLORS: Record<string, string> = {
  PENDING: 'var(--warn, #d97706)',
  APPROVED: 'var(--ok, #16a34a)',
  REJECTED: 'var(--err, #dc2626)',
};

const ADVANCE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
};

/**
 * Quỹ tạm ứng cá nhân (OpsVanHanh §5): 4 thẻ real-time, xin tạm ứng, lịch sử
 * chi phí với nhắc nợ chứng từ, và đề nghị thanh toán theo lô.
 */
export default function OpsWalletPage() {
  const { data: summary } = useOpsWalletSummary();
  const { data: advanceData, isLoading: advanceLoading } = useOpsAdvanceRequests();
  const [advanceOpen, setAdvanceOpen] = useState(false);

  const advanceItems = advanceData?.items ?? [];

  return (
    <div className="ops-wallet page-shell">
      <header className="ops-wallet__bar">
        <h1><Wallet size={20} aria-hidden /> Quỹ tạm ứng</h1>
        <button type="button" className="btn-primary" onClick={() => setAdvanceOpen(true)}>
          <Plus size={14} /> Xin Tạm Ứng
        </button>
      </header>

      <section className="ops-wallet__cards" aria-label="Số dư">
        <div className="ops-wallet-card ops-wallet-card--balance">
          <span className="ops-wallet-card__label">SỐ DƯ HIỆN TẠI</span>
          <strong>{summary ? `${formatVnd(summary.balance)} ₫` : '…'}</strong>
          {/* Honest debt: a negative balance is a fact, not an error state. */}
          {summary && Number(summary.balance) < 0 && (
            <small>Ứng quá mức — cần trả lại phần âm</small>
          )}
          <small>Đã ứng {summary ? formatVnd(summary.totalAdvance) : '…'} ₫</small>
        </div>
        <div className="ops-wallet-card">
          <span className="ops-wallet-card__label">Đã trả lại</span>
          <strong>{summary ? `${formatVnd(summary.returned ?? '0')} ₫` : '…'}</strong>
          <small>Tiền đã hoàn về công ty theo quyết toán</small>
        </div>
        <div className="ops-wallet-card">
          <span className="ops-wallet-card__label">Đã duyệt</span>
          <strong style={{ color: 'var(--ok, #16a34a)' }}>{summary ? formatVnd(summary.approved) : '…'}</strong>
        </div>
        <div className="ops-wallet-card">
          <span className="ops-wallet-card__label">Chờ duyệt (đang giữ chỗ)</span>
          <strong style={{ color: 'var(--warn, #d97706)' }}>{summary ? formatVnd(summary.pending) : '…'}</strong>
        </div>
        <div className="ops-wallet-card">
          <span className="ops-wallet-card__label">Bị từ chối</span>
          <strong style={{ color: 'var(--err, #dc2626)' }}>{summary ? formatVnd(summary.rejected) : '…'}</strong>
        </div>
      </section>

      {/* KP-125: compact status on every advance request row */}
      {advanceItems.length > 0 && (
        <section className="ops-wallet__section" aria-label="Yêu cầu tạm ứng">
          <header className="ops-wallet__section-head">
            <h2>Yêu cầu tạm ứng</h2>
          </header>
          <div className="ops-wallet__scroll">
            <table className="tt-table ops-wallet__table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Số tiền</th>
                  <th>Lý do</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {advanceItems.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleDateString('vi-VN')}</td>
                    <td className="ops-money">{formatVnd(row.amount)} ₫</td>
                    <td>{row.reason}</td>
                    <td>
                      <span style={{ color: ADVANCE_STATUS_COLORS[row.status] ?? 'inherit', fontWeight: 600, fontSize: 12 }}>
                        {ADVANCE_STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {advanceLoading && <div className="ops-wallet__loading"><Loader2 className="spin" size={18} /></div>}
          </div>
        </section>
      )}

      <OpsExpenseHistory />
      <OpsSettlementsPanel />

      {advanceOpen && <OpsAdvanceRequestModal onClose={() => setAdvanceOpen(false)} />}
    </div>
  );
}
