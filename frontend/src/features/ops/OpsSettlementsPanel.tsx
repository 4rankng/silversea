import { useState } from 'react';
import { Download, FileText, Loader2, Printer } from 'lucide-react';
import {
  useOpsSettlements,
  useCreateOpsSettlement,
  useOpsSettlement,
} from '../../hooks/useOpsQueries';
import { opsClient } from '../../api/opsClient';
import { useToast } from '../../components/shared/Toast';
import { formatVnd } from './opsStatus';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Chờ kế toán', color: 'var(--warn, #d97706)' },
  APPROVED: { label: 'Đã quyết toán', color: 'var(--ok, #16a34a)' },
  REJECTED: { label: 'Bị trả về', color: 'var(--err, #dc2626)' },
};

/**
 * Đề nghị thanh toán (OpsVanHanh §5.4): tạo phiếu gom các khoản đang mở, xem
 * bảng kê theo lô (2 rổ hóa đơn), tải Excel, in A4.
 */
export function OpsSettlementsPanel() {
  const { data, isLoading } = useOpsSettlements();
  const createSettlement = useCreateOpsSettlement();
  const { toast } = useToast();
  const [detailId, setDetailId] = useState<number | null>(null);
  const detail = useOpsSettlement(detailId);
  const items = data?.items ?? [];

  async function handleCreate() {
    try {
      const created = await createSettlement.mutateAsync(undefined);
      toast({ kind: 'success', message: `Đã tạo đề nghị thanh toán ${created.code}.` });
      setDetailId(created.id);
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Tạo phiếu thất bại.' });
    }
  }

  return (
    <section className="ops-wallet__section" aria-label="Đề nghị thanh toán">
      <header className="ops-wallet__section-head">
        <h2>Đề nghị thanh toán</h2>
        <button type="button" className="btn-primary" onClick={() => void handleCreate()} disabled={createSettlement.isPending}>
          {createSettlement.isPending ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
          Tạo Đề Nghị Thanh Toán
        </button>
      </header>

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
                <tr key={item.id}>
                  <td className="ops-money">{item.code}</td>
                  <td>{new Date(item.createdAt).toLocaleDateString('vi-VN')}</td>
                  <td className="ops-money">{formatVnd(item.totalAmount)}</td>
                  <td><span style={{ color: status.color }}>{status.label}</span></td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => setDetailId(item.id)}>
                      Xem
                    </button>
                  </td>
                </tr>
              );
            })}
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={5} className="ops-wallet__empty">Chưa có phiếu nào.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {detailId != null && detail.data && (
        <OpsModalBackdrop onClose={() => setDetailId(null)} ariaLabel={`Đề nghị thanh toán ${detail.data.settlement.code}`}>
          <div className="ops-modal">
            <header className="ops-modal__head">
              <h2>{detail.data.settlement.code}</h2>
              <div className="ops-modal__head-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void opsClient
                    .downloadSettlementExport(detailId, detail.data.settlement.code)
                    .catch((error: unknown) => toast({
                      kind: 'error',
                      message: error instanceof Error ? error.message : 'Tải Excel thất bại.',
                    }))}
                >
                  <Download size={14} /> Excel
                </button>
                <button type="button" className="btn-secondary" onClick={() => window.print()}>
                  <Printer size={14} /> In
                </button>
                <button type="button" aria-label="Đóng" onClick={() => setDetailId(null)}>✕</button>
              </div>
            </header>
            <div className="ops-modal__body">
              <OpsSettlementSheet grouping={detail.data.grouping} meta={{
                code: detail.data.settlement.code,
                createdAt: detail.data.settlement.createdAt,
                opsName: detail.data.settlement.opsUserName,
                note: detail.data.settlement.note,
              }} />
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
      <h3>ĐỀ NGHỊ THANH TOÁN {meta.code}</h3>
      <p>Người lập: {meta.opsName ?? '—'} · Ngày: {new Date(meta.createdAt).toLocaleDateString('vi-VN')}</p>
      {meta.note && <p>Ghi chú: {meta.note}</p>}
      {grouping.groups.map((group) => (
        <section key={group.shipmentId}>
          <h4>Lô {group.shipmentCode ?? group.shipmentId} — {group.customerName ?? ''} · {group.billRef ?? '—'}</h4>
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
        <span>Kế toán duyệt<small>(Ký, ghi rõ họ tên)</small></span>
      </div>
    </div>
  );
}
