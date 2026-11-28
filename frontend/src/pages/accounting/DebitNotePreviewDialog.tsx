import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '../../lib/format';
import { Btn, Modal } from '../../components/UI';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import {
  getDebitNoteRoundPreview,
  type DebitNoteRoundPreview,
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
 * khách. KB K10.37 §10.6.9 + K10.46 §10.7.4: "2 nút [Lưu] / [Lưu và tải file
 * Excel] — chỉ [Lưu] mới ghi vào công nợ." The buttons hand their acts to the
 * page:
 *   [Lưu]                    — ghi nhận Debit Note (đẩy số liệu sang Công nợ).
 *   [Lưu và tải file XLSX]   — export the preview as XLSX for review — KHÔNG
 *                              tạo Debit Note, không đụng Công nợ.
 * Nothing reaches Công nợ until [Lưu] runs, and no đợt → no act (the money
 * gate of the chốt law).
 */

export interface DebitNoteSavePayload {
  roundId: number;
  roundLabel: string;
  lotIds: number[];
  totals: { net: number; tax: number; gross: number };
}

export function DebitNotePreviewDialog({ open, customerIds, rounds, initialRoundId, busy, error, onSaveOnly, onDownloadXlsx, onClose }: {
  open: boolean;
  /** The selection's customer ids — scoping the đợt picker. */
  customerIds: number[];
  rounds: DebitSettlementRoundRow[];
  /** QA 28/11 finding 03 — the đợt the last Chọn Debit closed: preselected
   *  on open so the accountant continues straight to export. */
  initialRoundId?: number | null;
  busy: boolean;
  /** A save/export refusal (409 remedy text) surfaced verbatim INSIDE the
   *  dialog — pattern catch surface error.message (mẫu màn close), never a
   *  silent failure. */
  error: string | null;
  onSaveOnly: (payload: DebitNoteSavePayload) => void;
  /** Export the picked đợt's preview as XLSX — no Debit Note, no Công nợ. */
  onDownloadXlsx: (preview: DebitNoteRoundPreview) => void;
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
  // scope) may have changed between opens. A just-closed đợt (initialRoundId)
  // preselects when it survives the customer scope.
  useEffect(() => {
    if (!open) { setRoundId(null); return; }
    if (initialRoundId != null && roundId == null
      && candidateRounds.some((round) => round.id === initialRoundId)) {
      setRoundId(initialRoundId);
    }
  }, [open, initialRoundId, candidateRounds, roundId]);
  const selectedRound = candidateRounds.find((round) => round.id === roundId) ?? null;

  const previewQuery = useQuery({
    enabled: open && roundId != null,
    queryKey: qk.catalogs.debitNoteRoundPreview(roundId),
    queryFn: () => getDebitNoteRoundPreview(roundId!),
  });
  const preview = previewQuery.data ?? null;
  const savePayload: DebitNoteSavePayload | null = preview == null ? null : {
    roundId: preview.round.id,
    // SIL-1092 (K3.86/K6.32) — the label carries the đợt's CHIỀU: a THU đợt
    // and a TRA đợt of the same Lần·kỳ render identical 'Lần N · YYYY-MM'
    // strings, so the save/export toasts on the merge page could not tell
    // them apart either. KB terminology: Phải thu = đợt THU, Phải trả = TRA.
    roundLabel: `Lần ${preview.round.roundNo} · ${preview.round.periodKey} · ${preview.round.direction === 'THU' ? 'Phải thu' : 'Phải trả'}`,
    lotIds: preview.items.map((item) => item.shipmentId),
    totals: preview.totals,
  };

  // SIL-1092 (K3.86/K6.32) — the dropdown label names the chiều too: without
  // it, đợt THU #2 and đợt TRA #11 of the same month collapse into two
  // indistinguishable 'Lần 1 · 2026-11' options.
  const roundLabel = (round: DebitSettlementRoundRow) => `Lần ${round.roundNo} · ${round.periodKey} · ${round.direction === 'THU' ? 'Phải thu' : 'Phải trả'}`;

  return (
    // SIL-855 QA 23/11 — the Modal default 480px cut the TIỀN TRƯỚC THUẾ
    // column past the right edge (QA had to scroll horizontally to read the
    // money). min(92vw, 860px) — the house action-dialog width — fits the
    // four-column table without scrolling at the QA viewport.
    <Modal isOpen={open} title="Xem trước Debit Note" onClose={onClose} maxWidth="min(92vw, 860px)">
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
      {error && (
        <p className="debit-note" role="alert" style={{ margin: '8px 0', color: 'var(--err)' }}>
          {error}
        </p>
      )}
      {preview && (
        <div className="debit-note-preview__wrap" role="region" aria-label={preview.round.direction === 'TRA' ? 'Bảng bản kê công nợ nhà xe phải trả' : 'Bảng tổng hợp Debit Note'} tabIndex={0}>
          {/* SIL-1092 (K3.86 + K6.32) — the plate columns are DIRECTION-AWARE:
              a THU đợt is the customer Debit Note (BKS báo khách only); a TRA
              đợt is the BẢN KÊ CÔNG NỢ NHÀ XE PHẢI TRẢ (BKS thực of the trips
              + loại xe tính cước trả). The billing plate is never rendered on
              the TRA side — the wire carries it as null. */}
          {preview.round.direction === 'TRA' && (
            <p className="debit-note" style={{ margin: '0 0 8px', fontWeight: 600 }}>
              Bản kê công nợ nhà xe phải trả
              {selectedRound?.carrierLabel ? ` — nhà xe: ${selectedRound.carrierLabel}` : ''}
              {' '}· in BKS thực, không in BKS báo khách
            </p>
          )}
          <table className="debit-note-preview">
            <thead>
              <tr>
                <th scope="col">Lô</th>
                <th scope="col">Khách hàng</th>
                {preview.round.direction === 'TRA' ? (
                  <>
                    <th scope="col">BKS thực</th>
                    <th scope="col">Loại xe tính cước trả</th>
                  </>
                ) : (
                  <>
                    <th scope="col">BKS báo khách</th>
                    {/* SIL-1094 (KB §3.6.5 K3.87) — dòng lô ghép mang chú
                        thích "Ghép xe cùng Bill [Số Bill Lô 1]". */}
                    <th scope="col">GHI CHÚ</th>
                  </>
                )}
                <th scope="col">Tiền trước thuế</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((item) => (
                <tr key={item.shipmentId}>
                  {/* SIL-868 — the Lô cell names the SỐ BILL/BOOKING (the
                      customer-visible identity); the internal SHP-* code
                      never reaches the preview. */}
                  <td>{item.billOrBooking ?? `#${item.shipmentId}`}</td>
                  <td>{item.customerName ?? preview.round.customerName ?? '—'}</td>
                  {preview.round.direction === 'TRA' ? (
                    <>
                      <td>{item.actualTruckNo?.trim() || '—'}</td>
                      <td>{item.vehicleType?.trim() || '—'}</td>
                    </>
                  ) : (
                    <>
                      {/* Ticket 18/11 Task 2.4: hiển thị 100% BKS báo khách — the
                          same effectiveBillingPlate law the issued lines stamp. */}
                      <td>{item.billingTruckNo?.trim() || '—'}</td>
                      {/* SIL-1094 — GHI CHÚ: the merge note on a merged member
                          row; a lot without a merge carries no note (absence
                          is not data). */}
                      <td>{item.mergeNote ?? ''}</td>
                    </>
                  )}
                  <td className="debit-note-preview__money">{formatCurrency(item.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>Tổng tiền trước thuế</td><td className="debit-note-preview__money">{formatCurrency(preview.totals.net)}</td></tr>
              {/* Giảm giá has no source on the frozen billing path (a
                  negotiated discount folds into the receivable lines) — the
                  row renders the honest empty sum, never a fabricated number. */}
              <tr><td colSpan={4}>Giảm giá</td><td className="debit-note-preview__money">{formatCurrency(0)}</td></tr>
              <tr><td colSpan={4}>VAT</td><td className="debit-note-preview__money">{formatCurrency(preview.totals.tax)}</td></tr>
              <tr><td colSpan={4}>Tổng tiền sau thuế</td><td className="debit-note-preview__money">{formatCurrency(preview.totals.gross)}</td></tr>
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
        {/* KB K10.46 §10.7.4 — the download button exports the preview as
            XLSX and NEVER creates a Debit Note; only [Lưu] writes Công nợ. */}
        <Btn variant="secondary" size="sm" disabled={busy || preview == null} onClick={() => onDownloadXlsx(preview!)}>
          {busy ? 'Đang xuất file…' : 'Lưu và tải file XLSX'}
        </Btn>
        <Btn variant="primary" size="sm" disabled={busy || savePayload == null} onClick={() => onSaveOnly(savePayload!)}>
          {busy ? 'Đang lưu…' : 'Lưu'}
        </Btn>
      </div>
    </Modal>
  );
}
