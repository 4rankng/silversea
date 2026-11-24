import type { ReactNode } from 'react';

interface ShipmentCreateToplineProps {
  /** SIL-171 edit mode: the title swaps; SIL-481 view: "Chi tiết lô hàng". */
  mode?: 'create' | 'edit' | 'view';
  requiredDone: number;
  requiredTotal: number;
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
      {actions && <div className="csc-topline__actions">{actions}</div>}
    </div>
  );
}
