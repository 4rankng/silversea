import type { ReactNode } from 'react';

interface ShipmentCreateToplineProps {
  /** SIL-171 edit mode: the title swaps; SIL-481 view: "Chi tiết lô hàng". */
  mode?: 'create' | 'edit' | 'view';
  requiredDone: number;
  requiredTotal: number;
  /** SIL-1145 (QA-Retest4): the required field labels still missing — when
   *  the meter sits below its total, a hint beside the chip names them in
   *  slot order (the same labels the stars ride), instead of leaving a bare
   *  "Bắt buộc: 0/9" that says nothing about WHAT is missing. Empty at the
   *  total (9/9) so the hint never renders as noise. */
  missingLabels?: string[];
  /** SIL-917 (KB §3.2.7): the Huỷ / Lưu nháp / Tạo lô hàng cluster rides the
   *  page head alongside the title + chip. The workspace passes it for the
   *  CREATE worksheet only; edit and view keep the footer/review bar alone
   *  (SIL-510's one-bar law survives for those modes). */
  actions?: ReactNode;
}

/* Owner mock 11/10 ("Tạo lô hàng – dense layout.html"): the page title and the
 * required-field progress ride ONE topline at the head of the worksheet. The
 * action cluster returned to it with SIL-917 (KB §3.2.7, audit 24/11) as the
 * HEAD twin of the viewport-fixed footer bar. */
export function ShipmentCreateTopline({
  mode = 'create',
  requiredDone,
  requiredTotal,
  missingLabels = [],
  actions,
}: ShipmentCreateToplineProps) {
  const view = mode === 'view';
  return (
    <div className="csc-topline">
      <h1 className="csc-topline__title">{view ? 'Chi tiết lô hàng' : mode === 'edit' ? 'Sửa lô hàng' : 'Tạo lô hàng'}</h1>
      {!view && (
        <span className="csc-topline__progress">
          Bắt buộc: <strong>{requiredDone}/{requiredTotal}</strong>
        </span>
      )}
      {!view && missingLabels.length > 0 && (
        // SIL-1145: the enumeration rides beside the chip as a muted hint —
        // NOT the retired "Cần bổ sung N thông tin" panel (SIL-627 keeps it
        // gone); this is one line naming the missing fields.
        <span className="csc-topline__missing" title={`Còn thiếu: ${missingLabels.join(', ')}`}>
          Còn thiếu: {missingLabels.join(', ')}
        </span>
      )}
      {actions && <div className="csc-topline__actions">{actions}</div>}
    </div>
  );
}
