import { useState } from 'react';
import { billBookingReference } from '../../lib/business-reference';
import { formatCurrency } from '../../lib/format';
import type { AccountingDebitBoardRow, DebitRateField } from '../../api/accountingDebitClient';

/**
 * SIL-805 — ô giá/chi phí kế toán sửa TRỰC TIẾP trên dòng bảng Kiểm soát
 * lô hàng (8 ô: cước thu, Lạch Huyện, phụ PS, phát sinh CUS, cước trả ĐV,
 * Lạch Huyện ĐV, phát sinh ĐV, phí RU — cả tab FCL lẫn LCL), khi lô chưa
 * khóa sổ (costLockedAt == null; hàng đã khóa vẫn render text định dạng,
 * không bao giờ là input). Cùng luật ô 'Chi phí ngoài' (SIL-771): draft
 * sống trong ô, blur/Enter lưu, digits only; ô RỖNG = không lưu gì — giá
 * trị hiệu lực (tự động hoặc override) luôn hiện ở placeholder định nhóm
 * chữ số, gõ lại đúng số đó thì blur không gửi. Con số render thô trong
 * input (tiền lệ ts-adjust); placeholder giữ định dạng để kế toán nhìn
 * được tiền đang áp dụng. Class `debit-ext-cost` dùng CHUNG với ô Chi phí
 * ngoài để nút [Lưu] của bảng kết thúc đúng ô đang sửa.
 *
 * GHI ĐÈ MỘT CHIỀU (review M1, 13/11): UI chỉ GHI đè giá trị tự động,
 * chưa có affordance XOÁ override (quay về kênh tự động) — wire/server
 * hỗ trợ sẵn (`rates.<field>: null` trên POST /api/accounting/debit-board/
 * rates), bypass UI là đường duy nhất cho tới khi khách cần (follow-up).
 *
 * SIL-814 (luật 24/10, Spec v4 §8.1.3): ô CHƯA XÁC ĐỊNH (`value == null`)
 * phải là Ô TRỐNG toàn phần — SIL-838 §3 already renders the locked face
 * empty, so the editable face may not park a '0' placeholder there either:
 * an unpriced lot (R3K-J1) must never look zero-filled. Only a cell with a
 * real effective value (auto hoặc override) keeps the formatted placeholder.
 * KB Ch.10 'thiếu dữ liệu hiện —' (QA 27/11): a line can opt its EMPTY face
 * into ghosting the em-dash (`emptyPlaceholder`) instead of silence — the
 * Phát sinh (CUS) line is that law's carrier; the default stays the SIL-814
 * blank face.
 */
export function RateCell({ row, field, label, value, onCommit, saving, emptyPlaceholder }: {
  row: AccountingDebitBoardRow;
  field: DebitRateField;
  label: string;
  /** Effective cell value (string money) — null = Chưa xác định (ô TRỐNG, placeholder rỗng — SIL-814). */
  value: string | null;
  onCommit: (shipmentId: number, field: DebitRateField, value: number) => void;
  saving: boolean;
  /** The ghost the EMPTY cell shows (KB 'thiếu dữ liệu hiện —'); default blank. */
  emptyPlaceholder?: string;
}) {
  const [draft, setDraft] = useState<string>('');
  const placeholder = value == null ? emptyPlaceholder ?? '' : formatCurrency(Number(value));

  function commit() {
    if (draft === '') return;
    const parsed = Number(draft);
    // Digits-only onChange keeps the draft parseable; the guard stays for
    // the programmatic path.
    if (!Number.isFinite(parsed)) return;
    const effective = value == null ? null : Number(value);
    setDraft('');
    if (effective != null && parsed === effective) return; // unchanged → no write
    onCommit(row.shipmentId, field, parsed);
  }

  return (
    <input
      className="debit-ext-cost"
      type="text"
      inputMode="numeric"
      aria-label={`${label} lô ${billBookingReference(row.billOrBooking) || row.code}`}
      placeholder={placeholder}
      title={`${label} — sửa trực tiếp trên dòng (ghi đè giá trị tự động)`}
      value={draft}
      disabled={saving}
      // KB ch10 QA 27/11: the input owns the FULL cell width via the paired
      // `.debit-line--rate` rule (width: 100%; min-width: 0) and the
      // formatted placeholder lives INSIDE it — the fixed money track is the
      // only width law. The retired ch floors (the placeholder self-sizing
      // hack, then the 13ch standard) are what pushed the value past the
      // track onto the adjacent column.
      // Digits only — the wire is numeric(15,0); paste garbage stays out.
      onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ''))}
      onClick={(event) => event.stopPropagation()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
        // Keep the row-click selection model from eating keystrokes.
        event.stopPropagation();
      }}
    />
  );
}
