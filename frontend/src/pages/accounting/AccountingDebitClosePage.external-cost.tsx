import { useState } from 'react';
import { billBookingReference } from '../../lib/business-reference';
import { formatCurrency } from '../../lib/format';
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

  // SIL-855 QA R8 (23/11) — the locked face: a frozen lot renders the saved
  // value as formatted text, never an input — same law as the 8 SIL-805 rate
  // cells (sau khóa số đọc thôi). Before this gate the input still rendered
  // on locked rows and the save 409'd only at the server, which is exactly
  // the misleading affordance the QA round hit ('chỉ Chi phí ngoài edit
  // được' on locked lots).
  if (row.costLockedAt != null) {
    return (
      <span
        className="debit-ext-cost-locked"
        title="Lô đã khóa sổ — số đã đóng băng, không sửa được"
      >
        {row.chiPhiNgoai == null ? null : formatCurrency(Number(row.chiPhiNgoai))}
      </span>
    );
  }

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
