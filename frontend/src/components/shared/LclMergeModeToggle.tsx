import './LclMergeModeToggle.css';
// The selection's floating bottom bar shares this one stylesheet (spec 23/10
// §2): every surface that renders the toggle also floats the same bar, so the
// dock styles load with the mode UI rather than per-page.
import '../../styles/lcl-merge.css';

/**
 * Spec 23/10 (261023110000 §2) — the [📦 Gộp hàng] on-demand toggle that rides
 * the filter strip of every grouping surface (ĐV Kế hoạch Tổng quát / Chi
 * tiết Xe, CUS Chi phí - Quyết toán). Default OFF: the CHỌN column stays
 * hidden and the table keeps its full reading width. ON: the button flips to
 * the active "✕ Thoát gộp hàng" face and the page reveals the leading
 * checkbox column (LCL rows only on the dispatch side) plus the selection's
 * floating bottom bar.
 *
 * aria-pressed carries the mode so assistive tech hears a toggle, not two
 * unrelated buttons; the label swap is the spec's own affordance.
 */
export interface LclMergeModeToggleProps {
  active: boolean;
  onToggle: () => void;
  /** OFF-state label (default "📦 Gộp hàng"). */
  label?: string;
  /** ON-state label (default "✕ Thoát gộp hàng"). */
  activeLabel?: string;
}

export function LclMergeModeToggle({
  active,
  onToggle,
  label = '📦 Gộp hàng',
  activeLabel = '✕ Thoát gộp hàng',
}: LclMergeModeToggleProps) {
  return (
    <button
      type="button"
      className={`btn btn--sm lcl-merge-toggle${active ? ' lcl-merge-toggle--active' : ''}`}
      aria-pressed={active}
      title={active
        ? 'Tắt chế độ gộp hàng — ẩn cột CHỌN và bỏ mọi lựa chọn đang tích.'
        : 'Bật chế độ gộp hàng — hiện cột CHỌN để tích các lô hàng lẻ.'}
      onClick={onToggle}
    >
      {active ? activeLabel : label}
    </button>
  );
}
