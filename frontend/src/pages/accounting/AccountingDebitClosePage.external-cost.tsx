import { useState } from 'react';
import { billBookingReference } from '../../lib/business-reference';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

/**
 * SIL-771 — ô 'Chi phí ngoài' của bảng Kiểm soát lô hàng: kế toán gõ số tiền
 * nguyên (VND) trực tiếp trên dòng; blur/Enter lưu, xoá trắng = xoá giá trị
 * (null). Draft sống trong ô — board refetch sau khi lưu, trang không giữ
 * state thêm. Con số render thô trong input (tiền lệ ts-adjust của lưới đối
 * chiếu); các cột tiền khác vẫn định dạng nhóm chữ số.
 */
export function ExternalCostCell({ row, onCommit, saving }: {
  row: AccountingDebitBoardRow;
  onCommit: (shipmentId: number, value: number | null) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<string>(row.chiPhiNgoai ?? '');
  const current = row.chiPhiNgoai ?? '';

  function commit() {
    if (draft === current) return;
    onCommit(row.shipmentId, draft === '' ? null : Number(draft));
  }

  return (
    <input
      className="debit-ext-cost"
      type="text"
      inputMode="numeric"
      aria-label={`Chi phí ngoài lô ${billBookingReference(row.billOrBooking) || row.code}`}
      placeholder="0"
      title="Chi phí ngoài (kẹt, hợp, nâng/hạ cảng) — cộng vào công thức lợi nhuận"
      value={draft}
      disabled={saving}
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
