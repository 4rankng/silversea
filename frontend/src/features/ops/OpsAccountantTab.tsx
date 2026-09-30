import { useState } from 'react';
import { Image as ImageIcon, Loader2, X } from 'lucide-react';
import {
  useAdminOpsExpenses,
  useAdminOpsSettlements,
} from '../../hooks/useOpsQueries';
import { opsClient } from '../../api/opsClient';
import { useToast } from '../../components/shared/Toast';
import { OpsExpensePhotosModal } from './OpsExpensePhotosModal';
import { OpsSettlementSheet } from './OpsSettlementsPanel';
import { useAdminOpsSettlement } from '../../hooks/useOpsQueries';
import { formatMoney } from '../../lib/format';
import { OpsQueryFeedback } from './OpsQueryFeedback';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
import { formatDate } from '../../lib/format';
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
  // The settlement detail is what the "Xem phiếu" modal renders; held as a
  // local so the pending/error branches below can share one narrowing.
  const detail = sheet.data;

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
                  <td>{formatDate(row.paidAt)}</td>
                  <td>{row.shipmentCode ?? 'Chưa gắn lô'}</td>
                  <td>{row.containerNumber ?? 'Chung lô'}</td>
                  <td>{row.expenseTypeName ?? row.expenseTypeCode}</td>
                  <td className="ops-money">{formatMoney(row.amount)} ₫</td>
                  <td>{row.paidByName ?? 'Chưa rõ người chi'}</td>
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
                  <td>{formatDate(item.createdAt)}</td>
                  <td className="ops-money">{formatMoney(item.totalAmount)} ₫</td>
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

      {sheetFor != null && (
        <OpsModalBackdrop onClose={() => setSheetFor(null)} ariaLabel="Phiếu quyết toán Ops">
          <div className="ops-modal">
            <header className="ops-modal__head">
              <h2>{detail?.settlement.code ?? 'Phiếu quyết toán Ops'}</h2>
              <div className="ops-modal__head-actions">
                {detail && <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void opsClient
                    .downloadSettlementExport(detail.settlement.id, detail.settlement.code, true)
                    .catch((error: unknown) => toast({
                      kind: 'error',
                      message: error instanceof Error ? error.message : 'Tải Excel thất bại.',
                    }))}
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
    </div>
  );
}
