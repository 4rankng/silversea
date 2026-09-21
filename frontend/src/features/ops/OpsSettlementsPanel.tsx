import { useState } from 'react';
import { Download, FileText, Loader2, Printer } from 'lucide-react';
import {
  useOpsSettlements,
  useCreateOpsSettlement,
  useOpsSettlement,
  useFinalizeOpsSettlement,
  useReopenOpsSettlementDraft,
} from '../../hooks/useOpsQueries';
import { opsClient } from '../../api/opsClient';
import { useToast } from '../../components/shared/Toast';
import { formatVnd } from './opsStatus';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
import { OpsQueryFeedback } from './OpsQueryFeedback';
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Bản nháp cần hoàn tất', color: 'var(--warn, #d97706)' },
  RECORDED: { label: 'Đã quyết toán', color: 'var(--ok, #16a34a)' },
  VOIDED: { label: 'Đã hủy', color: 'var(--err, #dc2626)' },
  PENDING: { label: 'Bản nháp từ dữ liệu cũ', color: 'var(--warn, #d97706)' },
  APPROVED: { label: 'Đã quyết toán', color: 'var(--ok, #16a34a)' },
  REJECTED: { label: 'Bị trả về', color: 'var(--err, #dc2626)' },
};

/**
 * Phiếu quyết toán (OpsVanHanh §5.4): tạo phiếu gom các khoản đang mở, xem
 * bảng kê theo lô (2 rổ hóa đơn), tải Excel, in A4.
 */
export function OpsSettlementsPanel() {
  const { data, isLoading, isError, refetch } = useOpsSettlements();
  const createSettlement = useCreateOpsSettlement();
  const finalizeSettlement = useFinalizeOpsSettlement();
  const reopenDraft = useReopenOpsSettlementDraft();
  const { toast } = useToast();
  const [detailId, setDetailId] = useState<number | null>(null);
  const detail = useOpsSettlement(detailId);
  const items = data?.items ?? [];

  async function handleCreate() {
    try {
      const created = await createSettlement.mutateAsync(undefined);
      toast({ kind: 'success', message: `Đã tạo phiếu quyết toán ${created.code}.` });
      setDetailId(created.id);
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Tạo phiếu thất bại.' });
    }
  }

  return (
    <section className="ops-wallet__section" aria-label="Phiếu quyết toán">
      <header className="ops-wallet__section-head">
        <h2>Phiếu quyết toán</h2>
        <button type="button" className="btn-primary" onClick={() => void handleCreate()} disabled={createSettlement.isPending}>
          {createSettlement.isPending ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
          Lập phiếu quyết toán
        </button>
      </header>

      <p className="ops-modal-hint">Phiếu ghi nhận đối chiếu các khoản chi, không xác nhận việc chuyển tiền.</p>
      <div className="ops-wallet__scroll">
        <table className="tt-table ops-wallet__table">
          <thead>
            <tr>
              <th>Mã phiếu</th>
              <th>Ngày lập</th>
              <th>Tổng</th>
              <th>Trạng thái</th>
              <th aria-label="Thao tác" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const status = STATUS_LABELS[item.status];
              return (
                <tr key={item.id} className="ops-wallet__row">
                  <td className="ops-money" data-label="Mã phiếu">{item.code}</td>
                  <td data-label="Ngày lập">{new Date(item.createdAt).toLocaleDateString('vi-VN')}</td>
                  <td className="ops-money" data-label="Tổng">{formatVnd(item.totalAmount)}</td>
                  <td data-label="Trạng thái"><span style={{ color: status.color }}>{status.label}</span></td>
                  <td className="ops-row-actions ops-wallet__wide">
                    <button type="button" className="btn-secondary" onClick={() => setDetailId(item.id)}>
                      Xem
                    </button>
                    {(item.status === 'DRAFT' || item.status === 'PENDING') && <button type="button" className="btn-primary" disabled={finalizeSettlement.isPending} onClick={() => void finalizeSettlement.mutateAsync(item.id).then(() => toast({ kind: 'success', message: 'Đã ghi nhận phiếu quyết toán.' })).catch((error: unknown) => toast({ kind: 'error', message: error instanceof Error ? error.message : 'Không lưu được phiếu.' }))}>Hoàn tất phiếu</button>}
                    {(item.status === 'DRAFT' || item.status === 'PENDING') && <button type="button" className="btn-secondary" disabled={reopenDraft.isPending} onClick={() => void reopenDraft.mutateAsync(item.id).then(() => toast({ kind: 'success', message: 'Đã mở các khoản chi. Vào Lịch sử chi để bổ sung và lập lại phiếu.' })).catch((error: unknown) => toast({ kind: 'error', message: error instanceof Error ? error.message : 'Không lưu được phiếu.' }))}>Mở khoản chi để bổ sung</button>}
                  </td>
                </tr>
              );
            })}
            {!isLoading && !isError && items.length === 0 && (
              <tr><td colSpan={5} className="ops-wallet__empty">Chưa có phiếu nào.</td></tr>
            )}
          </tbody>
        </table>
        <OpsQueryFeedback loading={isLoading} error={isError} label="phiếu quyết toán" onRetry={refetch} />
      </div>

      {detailId != null && (
        <OpsModalBackdrop onClose={() => setDetailId(null)} ariaLabel={`Phiếu quyết toán ${detail.data?.settlement.code ?? detailId}`}>
          <div className="ops-modal">
            <header className="ops-modal__head">
              <h2>{detail.data?.settlement.code ?? "Chi tiết quyết toán"}</h2>
              <div className="ops-modal__head-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!detail.data}
                  onClick={() => detail.data && void opsClient
                    .downloadSettlementExport(detailId, detail.data.settlement.code)
                    .catch((error: unknown) => toast({
                      kind: 'error',
                      message: error instanceof Error ? error.message : 'Tải Excel thất bại.',
                    }))}
                >
                  <Download size={14} /> Excel
                </button>
                <button type="button" className="btn-secondary" disabled={!detail.data} onClick={() => window.print()}>
                  <Printer size={14} /> In
                </button>
                <button type="button" aria-label="Đóng" onClick={() => setDetailId(null)}>✕</button>
              </div>
            </header>
            <div className="ops-modal__body">
              <OpsQueryFeedback loading={detail.isLoading} error={detail.isError} label="chi tiết quyết toán" onRetry={detail.refetch} />
              {detail.data && <OpsSettlementSheet grouping={detail.data.grouping} meta={{
                code: detail.data.settlement.code,
                createdAt: detail.data.settlement.createdAt,
                opsName: detail.data.settlement.opsUserName,
                note: detail.data.settlement.note,
              }} />}
            </div>
          </div>
        </OpsModalBackdrop>
      )}
    </section>
  );
}

/** The printable bảng kê (screen + @media print A4 sheet). */
export function OpsSettlementSheet({ grouping, meta }: {
  grouping: NonNullable<ReturnType<typeof useOpsSettlement>['data']>['grouping'];
  meta: { code: string; createdAt: string; opsName: string | null; note: string | null };
}) {
  return (
    <div className="ops-settlement-sheet">
      <h3>PHIẾU QUYẾT TOÁN {meta.code}</h3>
      <p>Người lập: {meta.opsName ?? '—'} · Ngày: {new Date(meta.createdAt).toLocaleDateString('vi-VN')}</p>
      {meta.note && <p>Ghi chú: {meta.note}</p>}
      {grouping.groups.map((group) => (
        <section key={group.shipmentId}>
          <h4>Lô {group.shipmentCode ?? group.billRef ?? '—'} — {group.customerName ?? ''} · {group.billRef ?? '—'}</h4>
          {(['withInvoice', 'withoutInvoice'] as const).map((basketKey) => {
            const basket = group[basketKey];
            if (basket.items.length === 0) return null;
            return (
              <table key={basketKey} className="tt-table ops-settlement-sheet__table">
                <thead>
                  <tr>
                    <th>{basketKey === 'withInvoice' ? 'Có hóa đơn' : 'Không hóa đơn'} — Cont</th>
                    <th>Loại phí</th>
                    <th>Số tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {basket.items.map((item, index) => (
                    <tr key={index}>
                      <td>{item.containerNumber ?? 'Phí chung lô'}</td>
                      <td>{item.expenseTypeName ?? ''}</td>
                      <td className="ops-money">{formatVnd(item.amount)}</td>
                    </tr>
                  ))}
                  <tr className="ops-settlement-sheet__subtotal">
                    <td colSpan={2}>Tổng {basketKey === 'withInvoice' ? 'có hóa đơn' : 'không hóa đơn'}</td>
                    <td className="ops-money">{formatVnd(basket.total)}</td>
                  </tr>
                </tbody>
              </table>
            );
          })}
          <p className="ops-settlement-sheet__group-total">Tổng lô: {formatVnd(group.total)}</p>
        </section>
      ))}
      <p className="ops-settlement-sheet__grand">
        TỔNG CỘNG: {formatVnd(grouping.totals.grand)}
        (Có HĐ: {formatVnd(grouping.totals.withInvoice)} · Không HĐ: {formatVnd(grouping.totals.withoutInvoice)})
      </p>
      <div className="ops-settlement-sheet__signatures">
        <span>Người lập (Ops)<small>(Ký, ghi rõ họ tên)</small></span>
        <span>Người nhận đối chiếu<small>(Ký, ghi rõ họ tên)</small></span>
      </div>
    </div>
  );
}
