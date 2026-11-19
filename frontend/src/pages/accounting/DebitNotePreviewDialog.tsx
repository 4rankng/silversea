import { useMemo, useState } from 'react';
import { formatCurrency } from '../../lib/format';
import { Btn, Modal } from '../../components/UI';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import type { DebitSettlementRoundRow } from '../../api/accountingDebitClient';
import './DebitNotePreviewDialog.css';

/**
 * Ticket 18/11 Task 2.4 — Bảng xem trước Xuất Debit Note. [Xuất Debit Note]
 * no longer issues immediately: it opens THIS preview over the selected rows
 * (gom theo đợt chốt Lần · Tháng · Năm), shows 100% BKS báo khách per row,
 * computes the four closing totals, and the two explicit save acts are:
 *   [Lưu]                    — ghi nhận Debit Note (đẩy số liệu sang Công nợ).
 *   [Lưu và tải file XLSX]   — the same save, then the XLSX download.
 * Nothing reaches Công nợ until one of the two save buttons runs.
 */

export function DebitNotePreviewDialog({ open, rows, rounds, busy, onSaveOnly, onSaveAndDownload, onClose }: {
  open: boolean;
  rows: AccountingDebitBoardRow[];
  rounds: DebitSettlementRoundRow[];
  busy: boolean;
  onSaveOnly: () => void;
  onSaveAndDownload: () => void;
  onClose: () => void;
}) {
  // The selection may span one customer; a settlement round is scoped to one
  // customer + carrier — default the picker to a round that matches.
  const customerIds = useMemo(() => [...new Set(rows.map((row) => row.customerId).filter((id): id is number => id != null))], [rows]);
  const candidateRounds = useMemo(
    () => (customerIds.length === 1
      ? rounds.filter((round) => round.customerId === customerIds[0])
      : rounds),
    [rounds, customerIds],
  );
  const [roundId, setRoundId] = useState<number | null>(null);
  const selectedRound = candidateRounds.find((round) => round.id === roundId) ?? null;

  const baseTotal = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.thu.tongThu ?? 0), 0),
    [rows],
  );
  // Ticket 18/11 Task 2.4 — the four closing rows. VAT follows the ISSUED
  // DOCUMENT's law (review 18/11 HIGH: every frozen debit line books EXEMPT
  // at 0% — `calculateVatSnapshot(amount, 0, 'EXEMPT')`), so the preview's
  // VAT is 0 and Tổng tiền sau thuế matches exactly what lands in Công nợ.
  // Giảm giá has no source in the data model yet — the line renders the
  // honest empty sum. A chosen round with vatRate > 0 is surfaced as a
  // divergence note, never silently applied.
  const documentVatRate = 0;
  const discountTotal = 0;
  const vatTotal = Math.round(baseTotal * documentVatRate / 100);
  const afterTaxTotal = baseTotal - discountTotal + vatTotal;

  const roundLabel = (round: DebitSettlementRoundRow) => `Lần ${round.roundNo} · ${round.periodKey}`;

  return (
    <Modal isOpen={open} title="Xem trước Debit Note" onClose={onClose}>
      <p className="debit-note" style={{ margin: '0 0 8px' }}>
        {rows.length} lô đã chọn · đợt chốt
        {' '}
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
            {rows.map((row) => (
              <tr key={row.shipmentId}>
                <td>{row.code ?? row.billOrBooking ?? `#${row.shipmentId}`}</td>
                <td>{row.customerName ?? '—'}</td>
                {/* Ticket: hiển thị 100% BKS báo khách — giá trị thật khi có,
                    không bịa biển khi lô chưa gán. */}
                <td>{row.billingTruckNo?.trim() || '—'}</td>
                <td className="debit-note-preview__money">{formatCurrency(Number(row.thu.tongThu ?? 0))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Tổng tiền trước thuế</td><td className="debit-note-preview__money">{formatCurrency(baseTotal)}</td></tr>
            <tr><td colSpan={3}>Giảm giá</td><td className="debit-note-preview__money">{formatCurrency(discountTotal)}</td></tr>
            <tr><td colSpan={3}>VAT (miễn thuế 0%)</td><td className="debit-note-preview__money">{formatCurrency(vatTotal)}</td></tr>
            <tr><td colSpan={3}>Tổng tiền sau thuế</td><td className="debit-note-preview__money">{formatCurrency(afterTaxTotal)}</td></tr>
          </tfoot>
        </table>
      </div>
      {candidateRounds.length === 0 && (
        <p className="debit-note" style={{ margin: '8px 0 0' }}>
          Chưa có đợt chốt (Lần/Tháng/Năm) cho khách của lựa chọn — tạo đợt ở [Chọn Debit] để gán trước khi lưu.
        </p>
      )}
      {selectedRound != null && selectedRound.vatRate > 0 && (
        <p className="debit-note" role="note" style={{ margin: '8px 0 0' }}>
          Đợt chốt đặt VAT {selectedRound.vatRate}% — Debit Note hiện xuất miễn thuế (0%) theo quy tắc hóa đơn; VAT của đợt CHƯA được áp dụng vào Công nợ.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <Btn variant="secondary" size="sm" disabled={busy} onClick={onClose}>Hủy</Btn>
        <Btn variant="secondary" size="sm" disabled={busy || rows.length === 0} onClick={onSaveAndDownload}>
          {busy ? 'Đang lưu…' : 'Lưu và tải file XLSX'}
        </Btn>
        <Btn variant="primary" size="sm" disabled={busy || rows.length === 0} onClick={onSaveOnly}>
          {busy ? 'Đang lưu…' : 'Lưu'}
        </Btn>
      </div>
    </Modal>
  );
}
