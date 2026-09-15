import { useState } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import {
  useAdminOpsExpenses,
  useAdminOpsSettlements,
} from '../../hooks/useOpsQueries';
import { opsClient } from '../../api/opsClient';
import { useToast } from '../../components/shared/Toast';
import { OpsExpensePhotosModal } from './OpsExpensePhotosModal';
import { OpsSettlementSheet } from './OpsSettlementsPanel';
import { useAdminOpsSettlement } from '../../hooks/useOpsQueries';
import { formatVnd } from './opsStatus';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
/**
 * "Chi phí Ops" tab in the advance workspace (OpsVanHanh §5.4): accounting
 * reviews field cash expenses (photos first) and closes settlement batches.
 */
export function OpsAccountantTab() {
  const { data, isLoading } = useAdminOpsExpenses();
  const { data: settlements } = useAdminOpsSettlements();
  const { toast } = useToast();
  const [photosFor, setPhotosFor] = useState<number | null>(null);
  const [sheetFor, setSheetFor] = useState<number | null>(null);
  const sheet = useAdminOpsSettlement(sheetFor);

  const items = data?.items ?? [];

  return (
    <div className="ops-acc">
      <section className="ops-wallet__section">
        <header className="ops-wallet__section-head">
          <h2>Khoản chi Ops</h2>

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
                <th>Người chi</th>
                <th>Chứng từ</th>
                <th>Trạng thái</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>{row.paidAt}</td>
                  <td>{row.shipmentCode ?? '—'}</td>
                  <td>{row.containerNumber ?? 'Chung lô'}</td>
                  <td>{row.expenseTypeName ?? row.expenseTypeCode}</td>
                  <td className="ops-money">{formatVnd(row.amount)}</td>
                  <td>{row.paidByName ?? '—'}</td>
                  <td>
                    <button
                      type="button"
                      className={`ops-doc-state${row.hasPhoto ? '' : ' is-debt'}`}
                      onClick={() => setPhotosFor(row.id)}
                    >
                      <ImageIcon size={13} />
                      {row.hasPhoto ? 'Ảnh' : 'Nợ chứng từ'}
                    </button>
                  </td>
                  <td>{row.approvalStatus === 'DRAFT' ? 'Cần bổ sung' : row.approvalStatus === 'VOIDED' || row.approvalStatus === 'REJECTED' ? 'Đã hủy / lịch sử' : row.opsSettlementId == null ? 'Chưa quyết toán' : 'Đã lập phiếu'}</td>
                  <td>{row.opsSettlementId != null && <button type="button" className="btn-secondary" onClick={() => setSheetFor(row.opsSettlementId)}>Xem phiếu</button>}</td>
                </tr>
              ))}
              {!isLoading && items.length === 0 && (
                <tr><td colSpan={9} className="ops-wallet__empty">Không có khoản chi nào.</td></tr>
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
                  <td>{item.opsUserName ?? item.opsUserId}</td>
                  <td>{new Date(item.createdAt).toLocaleDateString('vi-VN')}</td>
                  <td className="ops-money">{formatVnd(item.totalAmount)}</td>
                  <td className="ops-row-actions">
                    <button type="button" className="btn-secondary" onClick={() => setSheetFor(item.id)}>Xem</button>

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

      {sheetFor != null && sheet.data && (
        <OpsModalBackdrop onClose={() => setSheetFor(null)} ariaLabel="Phiếu quyết toán Ops">
          <div className="ops-modal">
            <header className="ops-modal__head">
              <h2>{sheet.data.settlement.code}</h2>
              <div className="ops-modal__head-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void opsClient
                    .downloadSettlementExport(sheetFor, sheet.data.settlement.code, true)
                    .catch((error: unknown) => toast({
                      kind: 'error',
                      message: error instanceof Error ? error.message : 'Tải Excel thất bại.',
                    }))}
                >
                  Excel
                </button>
                <button type="button" aria-label="Đóng" onClick={() => setSheetFor(null)}>✕</button>
              </div>
            </header>
            <div className="ops-modal__body">
              <OpsSettlementSheet grouping={sheet.data.grouping} meta={{
                code: sheet.data.settlement.code,
                createdAt: sheet.data.settlement.createdAt,
                opsName: sheet.data.settlement.opsUserName,
                note: sheet.data.settlement.note,
              }} />
            </div>
          </div>
        </OpsModalBackdrop>
      )}
    </div>
  );
}
