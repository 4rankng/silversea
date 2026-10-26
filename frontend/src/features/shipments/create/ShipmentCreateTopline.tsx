interface ShipmentCreateToplineProps {
  /** SIL-171 edit mode: the title swaps; SIL-481 view: "Chi tiết lô hàng". */
  mode?: 'create' | 'edit' | 'view';
  requiredDone: number;
  requiredTotal: number;
}

/* Owner mock 11/10 ("Tạo lô hàng – dense layout.html"): the page title and the
 * required-field progress ride ONE topline at the head of the worksheet — and
 * since SIL-510 (owner 26/10) the actions no longer ride it with them: the
 * worksheet's ONE action bar is the viewport-fixed footer (`.csc-form-actions`),
 * always visible while scrolling, so a topline twin would put two action bars
 * on one viewport. */
export function ShipmentCreateTopline({
  mode = 'create',
  requiredDone,
  requiredTotal,
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
    </div>
  );
}
