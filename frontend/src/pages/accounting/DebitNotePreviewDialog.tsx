import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '../../lib/format';
import { Btn, Modal } from '../../components/UI';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import {
  getDebitNoteRoundPreview,
  type DebitSettlementRoundRow,
} from '../../api/accountingDebitClient';
import { qk } from '../../api/keys';
import './DebitNotePreviewDialog.css';

/**
 * Ticket 18/11 Task 2.4 (SIL-855) — Bảng xem trước Xuất Debit Note theo ĐỢT
 * chốt (Lần · Tháng · Năm). [Xuất Debit Note] opens THIS dialog; kế toán
 * chọn đợt, dialog kéo TOÀN BỘ lô của đợt đó từ server — tính trên CÙNG nền
 * khóa lô đông lạnh mà [Lưu] phát hành (buildFrozenShipmentDebitLines) —
 * nên 4 dòng tổng xem trước ≡ số Công nợ nhận, và mỗi dòng in 100% BKS báo
 * khách. The two explicit save acts hand (roundId, lot ids, totals) to the
 * page:
 *   [Lưu]                    — ghi nhận Debit Note (đẩy số liệu sang Công nợ).
 *   [Lưu và tải file XLSX]   — the same save, then the XLSX download.
 * Nothing reaches Công nợ until one of the two save buttons runs, and no
 * đợt → no save (the money gate of the chốt law).
 */

export interface DebitNoteSavePayload {
  roundId: number;
  roundLabel: string;
  lotIds: number[];
  totals: { net: number; tax: number; gross: number };
}

export function DebitNotePreviewDialog({ open, customerIds, rounds, busy, onSaveOnly, onSaveAndDownload, onClose }: {
  open: boolean;
  /** The selection's customer ids — scoping the đợt picker. */
  customerIds: number[];
  rounds: DebitSettlementRoundRow[];
  busy: boolean;
  onSaveOnly: (payload: DebitNoteSavePayload) => void;
  onSaveAndDownload: (payload: DebitNoteSavePayload) => void;
  onClose: () => void;
}) {
  // The selection may span one customer; a settlement round is scoped to one
  // customer + carrier — default the picker to a round that matches.
  const candidateRounds = useMemo(
    () => (customerIds.length === 1
      ? rounds.filter((round) => round.customerId === customerIds[0])
      : rounds),
    [rounds, customerIds],
  );
  const [roundId, setRoundId] = useState<number | null>(null);
  // Each open starts the đợt choice fresh — the selection (and its customer
  // scope) may have changed between opens.
  useEffect(() => {
    if (!open) setRoundId(null);
  }, [open]);
  const selectedRound = candidateRounds.find((round) => round.id === roundId) ?? null;

  const previewQuery = useQuery({
    enabled: open && roundId != null,
    queryKey: qk.catalogs.debitNoteRoundPreview(roundId),
    queryFn: () => getDebitNoteRoundPreview(roundId!),
  });
  const preview = previewQuery.data ?? null;
  const savePayload: DebitNoteSavePayload | null = preview == null ? null : {
    roundId: preview.round.id,
    roundLabel: `Lần ${preview.round.roundNo} · ${preview.round.periodKey}`,
    lotIds: preview.items.map((item) => item.shipmentId),
    totals: preview.totals,
  };

  const roundLabel = (round: DebitSettlementRoundRow) => `Lần ${round.roundNo} · ${round.periodKey}`;

  return (
    <Modal isOpen={open} title="Xem trước Debit Note" onClose={onClose}>
      <p className="debit-note" style={{ margin: '0 0 8px' }}>
        Đợt chốt (Lần · Tháng · Năm){' '}
        <UuiSelectField
          label="Đợt chốt (Lần · Tháng · Năm)"
          value={roundId == null ? '' : String(roundId)}
          onChange={(event) => setRoundId(event.target.value === '' ? null : Number(event.target.value))}
          options={[
            { value: '', label: '— Chọn đợt (Lần · Tháng · Năm) —' },
            ...candidateRounds.map((round) => ({ value: String(round.id), label: roundLabel(round) })),
          ]}
        />
      </p>
      {roundId != null && previewQuery.isPending && (
        <p className="debit-note" style={{ margin: '8px 0' }}>Đang tải bảng xem trước của đợt…</p>
      )}
      {roundId != null && previewQuery.isError && (
        <p className="debit-note" role="alert" style={{ margin: '8px 0', color: 'var(--err)' }}>
          {previewQuery.error.message}
        </p>
      )}
      {preview && (
        <div className="debit-note-preview__wrap" role="region" aria-label="Bảng tổng hợp Debit Note" tabIndex={0}>
          <table className="debit-note-preview">
            <thead>
              <tr>
                <th scope="col">Lô</th>
                <th scope="col">Khách hàng</th>
                <th scope="col">BKS báo khách</th>
                <th scope="col">Tiền trước thuế</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((item) => (
                <tr key={item.shipmentId}>
                  <td>{item.code ?? `#${item.shipmentId}`}</td>
                  <td>{item.customerName ?? preview.round.customerName ?? '—'}</td>
                  {/* Ticket 18/11 Task 2.4: hiển thị 100% BKS báo khách — the
                      same effectiveBillingPlate law the issued lines stamp. */}
                  <td>{item.billingTruckNo?.trim() || '—'}</td>
                  <td className="debit-note-preview__money">{formatCurrency(item.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3}>Tổng tiền trước thuế</td><td className="debit-note-preview__money">{formatCurrency(preview.totals.net)}</td></tr>
              {/* Giảm giá has no source on the frozen billing path (a
                  negotiated discount folds into the receivable lines) — the
                  row renders the honest empty sum, never a fabricated number. */}
              <tr><td colSpan={3}>Giảm giá</td><td className="debit-note-preview__money">{formatCurrency(0)}</td></tr>
              <tr><td colSpan={3}>VAT</td><td className="debit-note-preview__money">{formatCurrency(preview.totals.tax)}</td></tr>
              <tr><td colSpan={3}>Tổng tiền sau thuế</td><td className="debit-note-preview__money">{formatCurrency(preview.totals.gross)}</td></tr>
            </tfoot>
          </table>
        </div>
      )}
      {candidateRounds.length === 0 && (
        <p className="debit-note" style={{ margin: '8px 0 0' }}>
          Chưa có đợt chốt (Lần/Tháng/Năm) cho khách của lựa chọn — tạo đợt ở [Chọn Debit] để gán trước khi lưu.
        </p>
      )}
      {selectedRound == null && candidateRounds.length > 0 && (
        <p className="debit-note" style={{ margin: '8px 0 0' }}>
          Chọn đợt chốt để gom toàn bộ lô của đợt vào bảng xem trước — chưa chọn đợt thì chưa thể lưu Debit Note.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <Btn variant="secondary" size="sm" disabled={busy} onClick={onClose}>Hủy</Btn>
        <Btn variant="secondary" size="sm" disabled={busy || savePayload == null} onClick={() => onSaveAndDownload(savePayload!)}>
          {busy ? 'Đang lưu…' : 'Lưu và tải file XLSX'}
        </Btn>
        <Btn variant="primary" size="sm" disabled={busy || savePayload == null} onClick={() => onSaveOnly(savePayload!)}>
          {busy ? 'Đang lưu…' : 'Lưu'}
        </Btn>
      </div>
    </Modal>
  );
}
