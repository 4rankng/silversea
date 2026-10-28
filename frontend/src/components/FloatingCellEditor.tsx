import { createPortal } from 'react-dom';
import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { usePopoverPosition } from '../hooks/usePopoverPosition';
import './FloatingCellEditor.css';

/**
 * SIL-631 (owner 28/10, GLOBAL) — the one floating editor host for every
 * click-to-edit cell editor. The editor UI renders through a body portal at
 * fixed, viewport-aware coordinates instead of inside the value cell, so a
 * narrow column (or any `overflow` scroll box such as the drawer's
 * `.dispatch-container-detail__table-scroll`) can never clip the value being
 * edited. Geometry follows the ticket-blessed /shipments-detail popup and the
 * 28/10 webchat verdict (bottom-start): bottom-start placement under the
 * anchor cell, left edge aligned to the anchor (align-top doctrine — edges
 * align to the anchor, never vertically centered), flipping above when the
 * viewport has no room below.
 *
 * Doctrine mapping (owner 28/10: no-truncate / no-overlap / align-top):
 *  - no-truncate — min-width is max(consumer floor, 52ch), so a ≤50-char value
 *    (every editor here caps at maxLength 50/100) shows whole, never clipped;
 *  - no-overlap — the panel clears the anchor by the hook's 4px gap and never
 *    covers the anchor cell; the cell keeps its (dimmed) value while editing;
 *  - align-top — the panel is edge-aligned to the anchor (top edge = anchor
 *    bottom edge + gap; left edges flush), never centered on the row.
 *
 * The panel is hidden until `usePopoverPosition` measures a real anchor rect
 * (its "no coordinates means no position" promise), and follows the anchor on
 * scroll/resize through the hook. Consumers own ALL editor behavior — Enter
 * save, Esc revert, blur semantics, focus-on-open — and only move their editor
 * JSX under this host.
 */
export function FloatingCellEditor({ anchorRef, children, label, widthCh = 52, minWidth, className }: {
  /** The editing cell's stable anchor element — the wrapper that stays
   *  mounted across the trigger→editor swap (the dimmed value lives in it). */
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Accessible name of the floating editor group (e.g. "Sửa số container"). */
  label: string;
  /** no-truncate floor in ch units of the panel's font (the value font). */
  widthCh?: number;
  /** Optional pixel floor (e.g. the 420px ledger card) above the ch floor. */
  minWidth?: number;
  className?: string;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const coords = usePopoverPosition(popoverRef, anchorRef, true, minWidth ?? 320, 120, 'start');
  const style: CSSProperties = {
    top: coords?.top ?? 0,
    left: coords?.left ?? 0,
    maxHeight: coords?.maxHeight,
    // Hidden until measured — the hook returns null for a 0×0 (unmeasured)
    // anchor so the panel never paints at the padding corner first. opacity
    // (not visibility) keeps the panel in the accessibility tree while hidden
    // so role queries can still reach the editor the moment it opens.
    ...(coords ? {} : { opacity: 0, pointerEvents: 'none' as const }),
    ['--fce-min-w' as string]: minWidth != null ? `${minWidth}px` : undefined,
    ['--fce-value-ch' as string]: `${widthCh}ch`,
  };
  return createPortal(
    <div
      ref={popoverRef}
      className={`floating-cell-editor${className ? ` ${className}` : ''}`}
      style={style}
      data-cell-editor-portal=""
      role="group"
      aria-label={label}
    >
      {children}
    </div>,
    document.body,
  );
}
