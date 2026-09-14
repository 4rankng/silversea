import { useState } from 'react';
import { Plus, Wallet } from 'lucide-react';
import { useOpsWalletSummary } from '../hooks/useOpsQueries';
import { OpsAdvanceRequestModal } from '../features/ops/OpsAdvanceRequestModal';
import { OpsExpenseHistory } from '../features/ops/OpsExpenseHistory';
import { OpsSettlementsPanel } from '../features/ops/OpsSettlementsPanel';
import { formatVnd } from '../features/ops/opsStatus';
import './OpsWalletPage.css';

/**
 * Quỹ tạm ứng cá nhân (OpsVanHanh §5): 4 thẻ real-time, xin tạm ứng, lịch sử
 * chi phí với nhắc nợ chứng từ, và đề nghị thanh toán theo lô.
 */
export default function OpsWalletPage() {
  const { data: summary } = useOpsWalletSummary();
  const [advanceOpen, setAdvanceOpen] = useState(false);

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

      <OpsExpenseHistory />
      <OpsSettlementsPanel />

      {advanceOpen && <OpsAdvanceRequestModal onClose={() => setAdvanceOpen(false)} />}
    </div>
  );
}
