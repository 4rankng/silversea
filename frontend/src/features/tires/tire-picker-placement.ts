import type { CSSProperties } from "react";

/**
 * Geometry for the tire pickers' floating listbox menu (PositionPicker /
 * SupplierPicker). Pure so the flip/clamp math stays testable and the
 * controls only own refs and listeners.
 *
 * The menu opens below the trigger with an 8px gap; when the space below is
 * too tight (under the 180px readability floor) and above is roomier, it
 * flips above the trigger. Either way the box is clamped inside the viewport
 * padding and never grows past `maxWidth` / `maxHeight`.
 */
const GAP_PX = 8;
const VIEWPORT_PADDING_PX = 8;
/** Below this the menu is unreadable — flip up instead of squashing. */
const MIN_MENU_HEIGHT_PX = 180;

export function floatingPickerMenuStyle(
  rect: DOMRect,
  viewport: { width: number; height: number },
  options: { maxWidth?: number; maxHeight?: number } = {},
): CSSProperties {
  const maxWidth = options.maxWidth ?? 420;
  const maxHeightLimit = options.maxHeight ?? 280;

  const menuWidth = Math.min(rect.width, maxWidth, viewport.width - VIEWPORT_PADDING_PX * 2);
  const availableBelow = viewport.height - rect.bottom - GAP_PX - VIEWPORT_PADDING_PX;
  const availableAbove = rect.top - GAP_PX - VIEWPORT_PADDING_PX;
  const openUp = availableBelow < MIN_MENU_HEIGHT_PX && availableAbove > availableBelow;
  const maxHeight = Math.max(MIN_MENU_HEIGHT_PX, Math.min(maxHeightLimit, openUp ? availableAbove : availableBelow));

  return {
    top: openUp ? Math.max(VIEWPORT_PADDING_PX, rect.top - GAP_PX - maxHeight) : rect.bottom + GAP_PX,
    left: Math.max(VIEWPORT_PADDING_PX, Math.min(rect.left, viewport.width - menuWidth - VIEWPORT_PADDING_PX)),
    width: menuWidth,
    maxHeight,
    visibility: "visible",
  };
}
