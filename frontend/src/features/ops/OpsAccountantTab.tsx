import { opsBillReference } from './opsStatus';
import { useState } from 'react';
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
import { OpsQueryFeedback } from './OpsQueryFeedback';
import { DateRangeFields, FilterBar, UuiSelectField } from '../../design-system';
import { FilterDropdown } from '../../components/FilterDropdown';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
import { formatDate } from '../../lib/format';
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

        <div className="ops-wallet__scroll">
          <table className="tt-table ops-wallet__table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Bill / Booking</th>
                <th>Cont</th>
                {/* SIL-858 — 3 cột nhận diện lô mới. */}
                <th>Khách hàng / Nhà máy</th>
                <th>Số tờ khai</th>
                <th>Số HĐ</th>
                <th>Loại phí</th>
                <th>Số tiền</th>
                <th>Người chi</th>
                <th>Chứng từ</th>
                <th>Trạng thái</th>
                {/* §3c — kế toán's duyệt axis: an Ops chi only reaches hoàn
                    tạm ứng (ĐNTT) after this tick, so the state and the act
                    live on the same screen kế toán already reads. */}
                <th>Duyệt KT</th>
                {/* SIL-858 — cột cuối là Ghi chú; nút [Xem phiếu] dư đã bỏ
                    (số phiếu quyết toán hiện ngay ở Trạng thái, phiếu đọc
                    được ở bảng Phiếu quyết toán Ops bên dưới). */}
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.paidAt)}</td>
                  <td>{opsBillReference(row.billRef)}</td>
                  <td>{row.containerNumber ?? 'Chung lô'}</td>
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
                  <td>{row.declarationNumber?.trim() || '—'}</td>
                  <td>{row.invoiceNumber?.trim() || 'X'}</td>
                  <td>{row.expenseTypeName ?? row.expenseTypeCode}</td>
                  <td className="ops-money">{`${formatMoney(row.amount)} ₫`}</td>
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
                  {/* SIL-858 — Trạng thái hiển thị SỐ PHIẾU quyết toán khi
                      đã tất toán (thay vì chỉ 'Đã lập phiếu'). */}
                  <td>{row.approvalStatus === 'DRAFT' ? 'Cần bổ sung' : row.opsSettlementCode ?? 'Chưa quyết toán'}</td>
                  <td>
                    {row.version == null ? '—'
                      : row.confirmedAt != null ? `Đã duyệt ${formatDate(row.confirmedAt)}`
                        : canConfirm ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            // One confirm in flight ⇒ every Duyệt waits (the
                            // busy check is global; leaving siblings enabled
                            // made their clicks die silently — review F5).
                            disabled={confirmBusyId !== null}
                            onClick={() => void confirmExpense(row)}
                          >
                            {confirmBusyId === row.id ? 'Đang duyệt…' : 'Duyệt'}
                          </button>
                        ) : 'Chưa duyệt'}
                  </td>
                  <td>{row.note?.trim() || '—'}</td>
                </tr>
              ))}
              {!isLoading && visibleItems.length === 0 && (
                <tr><td colSpan={13} className="ops-wallet__empty">Không có khoản chi nào.</td></tr>
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
    </div>
  );
}
