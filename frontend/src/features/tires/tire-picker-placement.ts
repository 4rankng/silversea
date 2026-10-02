import type { CSSProperties } from "react";

export function floatingPickerMenuStyle(
  rect: Pick<DOMRectReadOnly, "top" | "bottom" | "left" | "width">,
  viewport: { width: number; height: number },
  options: { maxWidth?: number; maxHeight?: number } = {},
): CSSProperties {
  const gap = 8;
  const viewportPadding = 8;
  const menuWidth = Math.max(0, Math.min(rect.width, options.maxWidth ?? 420, viewport.width - viewportPadding * 2));
  const availableBelow = viewport.height - rect.bottom - gap - viewportPadding;
  const availableAbove = rect.top - gap - viewportPadding;
  const openUp = availableBelow < 180 && availableAbove > availableBelow;
  const maxHeight = Math.max(0, Math.min(options.maxHeight ?? 280, openUp ? availableAbove : availableBelow));

  return {
    // Let the actual content height determine the upward top edge. Reserving
    // maxHeight here would detach a sparse menu from the connected field.
    top: openUp ? undefined : rect.bottom + gap,
    bottom: openUp ? viewport.height - rect.top + gap : undefined,
    left: Math.max(viewportPadding, Math.min(rect.left, viewport.width - menuWidth - viewportPadding)),
    width: menuWidth,
    maxHeight,
    visibility: "visible",
  };
}
