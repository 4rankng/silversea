import { useState } from 'react';
import { Check, Image as ImageIcon, Loader2, X } from 'lucide-react';
import {
  useAdminOpsExpenses,
  useAdminOpsSettlements,
  useDecideOpsExpense,
  useDecideOpsSettlement,
} from '../../hooks/useOpsQueries';
import { opsClient, type OpsExpenseRow, type OpsExpenseStatus } from '../../api/opsClient';
import { useToast } from '../../components/shared/Toast';
import { OpsExpensePhotosModal } from './OpsExpensePhotosModal';
import { OpsSettlementSheet } from './OpsSettlementsPanel';
import { useAdminOpsSettlement } from '../../hooks/useOpsQueries';
import { formatVnd } from './opsStatus';

import './ops-modal.css';
const STATUS_FILTERS: Array<{ value: OpsExpenseStatus | undefined; label: string }> = [
  { value: 'PENDING', label: 'Chờ duyệt' },
  { value: 'APPROVED', label: 'Đã duyệt' },
  { value: 'REJECTED', label: 'Bị từ chối' },
  { value: undefined, label: 'Tất cả' },
];

/**
 * "Chi phí Ops" tab in the advance workspace (OpsVanHanh §5.4): accounting
 * reviews field cash expenses (photos first) and closes settlement batches.
 */
export function OpsAccountantTab() {
  const [status, setStatus] = useState<OpsExpenseStatus | undefined>('PENDING');
  const { data, isLoading } = useAdminOpsExpenses(status);
  const decideExpense = useDecideOpsExpense();
  const decideSettlement = useDecideOpsSettlement();
  const { data: settlements } = useAdminOpsSettlements('PENDING');
  const { toast } = useToast();
  const [photosFor, setPhotosFor] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<OpsExpenseRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approvingInPerson, setApprovingInPerson] = useState<OpsExpenseRow | null>(null);
  const [inPersonNote, setInPersonNote] = useState('');
  const [rejectingSettlement, setRejectingSettlement] = useState<{ id: number; code: string } | null>(null);
  const [settlementReason, setSettlementReason] = useState('');
  const [sheetFor, setSheetFor] = useState<number | null>(null);
  const sheet = useAdminOpsSettlement(sheetFor);

  const items = data?.items ?? [];

  async function handleDecide(id: number, decision: 'approve' | 'reject', reason?: string, inPerson?: { inPersonCheck: boolean; note: string }) {
    try {
      await decideExpense.mutateAsync({ id, decision, reason, inPerson });
      toast({
        kind: 'success',
        message: decision === 'approve' ? 'Đã duyệt khoản chi.' : 'Đã từ chối khoản chi.',
      });
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Thao tác thất bại.' });
    }
  }

  return (
    <div className="ops-acc">
      <section className="ops-wallet__section">
        <header className="ops-wallet__section-head">
          <h2>Khoản chi Ops</h2>
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
                  <td>{row.approvalStatus === 'PENDING' ? (
                    <span style={{ color: 'var(--warn, #d97706)' }}>Chờ duyệt</span>
                  ) : row.approvalStatus === 'APPROVED' ? (
                    <span style={{ color: 'var(--ok, #16a34a)' }}>Đã duyệt</span>
                  ) : (
                    <span style={{ color: 'var(--err, #dc2626)' }} title={row.rejectionReason ?? ''}>Bị từ chối</span>
                  )}</td>
                  <td className="ops-row-actions">
                    {row.approvalStatus === 'PENDING' && (
                      <>
                        <button
                          type="button"
                          className="btn-secondary ops-ok"
                          disabled={decideExpense.isPending}
                          onClick={() => {
                            if (row.hasPhoto) void handleDecide(row.id, 'approve');
                            else setApprovingInPerson(row);
                          }}
                        >
                          <Check size={13} /> Duyệt
                        </button>
                        <button
                          type="button"
                          className="btn-secondary ops-danger"
                          aria-label={`Từ chối khoản chi ${row.shipmentCode ?? row.id}`}
                          onClick={() => { setRejecting(row); setRejectReason(''); }}
                        >
                          <X size={13} />
                        </button>
                      </>
                    )}
                  </td>
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
          <h2>Đề nghị thanh toán Ops</h2>
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
                    <button
                      type="button"
                      className="btn-secondary ops-ok"
                      disabled={decideSettlement.isPending}
                      onClick={() => void decideSettlement
                        .mutateAsync({ id: item.id, decision: 'approve' })
                        .then(() => toast({ kind: 'success', message: `Đã chốt ${item.code}.` }))
                        .catch((error: unknown) => toast({
                          kind: 'error',
                          message: error instanceof Error ? error.message : 'Duyệt phiếu thất bại.',
                        }))}
                    >
                      <Check size={13} /> Duyệt phiếu
                    </button>
                    <button
                      type="button"
                      className="btn-secondary ops-danger"
                      aria-label={`Từ chối phiếu ${item.code}`}
                      onClick={() => { setRejectingSettlement(item); setSettlementReason(''); }}
                    >
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {(settlements?.items ?? []).length === 0 && (
                <tr><td colSpan={5} className="ops-wallet__empty">Không có phiếu nào đang chờ.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {rejectingSettlement && (
        <div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Từ chối phiếu ${rejectingSettlement.code}`}>
          <form
            className="ops-modal"
            onSubmit={(event) => {
              event.preventDefault();
              if (!settlementReason.trim()) return;
              void decideSettlement
                .mutateAsync({ id: rejectingSettlement.id, decision: 'reject', reason: settlementReason.trim() })
                .then(() => {
                  toast({ kind: 'success', message: `Đã trả về ${rejectingSettlement.code} — các khoản chi mở lại.` });
                  setRejectingSettlement(null);
                })
                .catch((error: unknown) => toast({
                  kind: 'error',
                  message: error instanceof Error ? error.message : 'Từ chối phiếu thất bại.',
                }));
            }}
          >
            <header className="ops-modal__head">
              <h2>Từ chối phiếu {rejectingSettlement.code}</h2>
              <button type="button" aria-label="Đóng" onClick={() => setRejectingSettlement(null)}>✕</button>
            </header>
            <div className="ops-modal__body">
              <label className="ops-form-note">
                Lý do từ chối * (các khoản chi trong phiếu sẽ mở lại cho phiếu kế tiếp)
                <textarea
                  value={settlementReason}
                  onChange={(event) => setSettlementReason(event.target.value)}
                  rows={3}
                  required
                />
              </label>
            </div>
            <footer className="ops-modal__foot">
              <div />
              <div className="ops-modal__actions">
                <button type="button" className="btn-secondary" onClick={() => setRejectingSettlement(null)}>Đóng</button>
                <button type="submit" className="btn-primary" disabled={!settlementReason.trim()}>Từ chối</button>
              </div>
            </footer>
          </form>
        </div>
      )}

      {approvingInPerson && (
        <div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Duyệt không ảnh biên lai">
          <form
            className="ops-modal"
            onSubmit={(event) => {
              event.preventDefault();
              if (!inPersonNote.trim()) return;
              void handleDecide(approvingInPerson.id, 'approve', undefined, {
                inPersonCheck: true,
                note: inPersonNote.trim(),
              }).then(() => {
                setApprovingInPerson(null);
                setInPersonNote('');
              });
            }}
          >
            <header className="ops-modal__head">
              <h2>Duyệt không ảnh biên lai · {approvingInPerson.shipmentCode ?? approvingInPerson.id}</h2>
              <button type="button" aria-label="Đóng" onClick={() => setApprovingInPerson(null)}>✕</button>
            </header>
            <div className="ops-modal__body">
              <p className="ops-inperson-note">
                Khoản chi này chưa có ảnh biên lai. Chỉ duyệt được sau khi kế toán kiểm chứng
                chứng từ giấy tận tay — ghi chú kiểm chứng là bắt buộc và được lưu vào nhật ký.
              </p>
              <label className="ops-form-note">
                Ghi chú kiểm chứng tận tay *
                <textarea
                  value={inPersonNote}
                  onChange={(event) => setInPersonNote(event.target.value)}
                  rows={3}
                  required
                  placeholder="VD: Đã đối chiếu hóa đơn giấy tại quầy — hợp lệ"
                />
              </label>
            </div>
            <footer className="ops-modal__foot">
              <div />
              <div className="ops-modal__actions">
                <button type="button" className="btn-secondary" onClick={() => setApprovingInPerson(null)}>Đóng</button>
                <button type="submit" className="btn-primary" disabled={!inPersonNote.trim()}>Duyệt</button>
              </div>
            </footer>
          </form>
        </div>
      )}

      {photosFor != null && (
        <OpsExpensePhotosModal expenseId={photosFor} onClose={() => setPhotosFor(null)} />
      )}

      {rejecting && (
        <div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Từ chối khoản chi">
          <form
            className="ops-modal"
            onSubmit={(event) => {
              event.preventDefault();
              if (!rejectReason.trim()) return;
              void handleDecide(rejecting.id, 'reject', rejectReason.trim()).then(() => setRejecting(null));
            }}
          >
            <header className="ops-modal__head">
              <h2>Từ chối khoản chi {rejecting.shipmentCode ? `· ${rejecting.shipmentCode}` : ''}</h2>
              <button type="button" aria-label="Đóng" onClick={() => setRejecting(null)}>✕</button>
            </header>
            <div className="ops-modal__body">
              <label className="ops-form-note">
                Lý do từ chối * (hiển thị cho Ops)
                <textarea
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  rows={3}
                  required
                  placeholder="VD: Ảnh biên lai mờ, không đọc được số tiền"
                />
              </label>
            </div>
            <footer className="ops-modal__foot">
              <div />
              <div className="ops-modal__actions">
                <button type="button" className="btn-secondary" onClick={() => setRejecting(null)}>Đóng</button>
                <button type="submit" className="btn-primary" disabled={!rejectReason.trim()}>Từ chối</button>
              </div>
            </footer>
          </form>
        </div>
      )}

      {sheetFor != null && sheet.data && (
        <div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Phiếu thanh toán Ops">
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
        </div>
      )}
    </div>
  );
}
