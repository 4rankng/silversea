import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-1178 — the "Cột hiển thị" panel must stay inside the viewport and never
 * render a column option cut in half.
 *
 * The audit read the debit-merge panel (a 29-option list) as a menu running
 * past the bottom of the screen with its last row sliced. The invariant pinned
 * here is the geometry, read from the stylesheet because the geometry IS the
 * stylesheet: the shell bounds the panel, the LIST is the scrollport inside it,
 * and the list's window is rounded down to WHOLE option rows — so the panel's
 * edge lands between two options, never through one.
 */

const css = readFileSync(resolve(process.cwd(), 'src/components/ColumnPicker.css'), 'utf8');

/** The body of one rule, by its exact selector. */
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('ColumnPicker panel — SIL-1178 the panel stays inside the viewport', () => {
  it('bounds the panel and scrolls the LIST inside it, not the panel itself', () => {
    const popover = rule('.column-picker__popover');
    // The panel's own ceiling: the anchor-bound number is published inline
    // (max-height), this is the viewport backstop for the unmeasured frame.
    expect(popover).toMatch(/max-height:\s*calc\(100dvh - 24px\)/);
    // The list is the scrollport inside the panel — `min-height: 0` is what
    // lets it shrink inside the panel's bound instead of spilling past it.
    const options = rule('.column-picker__popover .column-picker__options');
    expect(options).toMatch(/min-height:\s*0/);
    expect(options).toMatch(/overflow-y:\s*auto/);
    expect(options).toMatch(/overscroll-behavior:\s*contain/);
    // The body must not hold the list at its content height either.
    expect(rule('.column-picker__popover .column-picker__body')).toMatch(/min-height:\s*0/);
  });

  it('rounds the scroll window down to WHOLE option rows — no option is sliced by the panel edge', () => {
    const popover = rule('.column-picker__popover');
    // The row band is fixed (the house's 32px compact control height) and the
    // PITCH (band + the list's gap) is what the window must end on.
    expect(popover).toMatch(/--column-picker-row-h:\s*32px/);
    expect(popover).toMatch(/--column-picker-row-pitch:\s*calc\(/);
    const options = rule('.column-picker__popover .column-picker__options');
    expect(options).toMatch(/max-height:\s*round\(down,[^;]*var\(--column-picker-row-pitch\)\)/);
    // The fallback declaration stands for an engine without `round()`: the
    // window is still bounded by the panel, never by the viewport.
    expect(options).toMatch(/max-height:\s*calc\(var\(--column-picker-available, 100%\) - var\(--column-picker-chrome-h\)\)/);
    // The option band is the row height the rounding assumes.
    expect(rule('.column-picker__popover .column-picker__option')).toMatch(/min-height:\s*var\(--column-picker-row-h\)/);
    // The pitch and the list's gap read the SAME token, so they cannot drift.
    expect(rule('.column-picker__options')).toMatch(/gap:\s*var\(--column-picker-list-gap, 2px\)/);
    expect(popover).toMatch(/--column-picker-row-pitch:\s*calc\(var\(--column-picker-row-h\) \+ var\(--column-picker-list-gap, 2px\)\)/);
  });

  it('keeps the actions row ("Chọn tất cả" · "Mặc định") pinned while the list scrolls', () => {
    expect(rule('.column-picker__reset-row')).toMatch(/flex-shrink:\s*0/);
  });

  it('leaves the folded variant (the block inside "Bộ lọc") untouched', () => {
    // The scroll window belongs to the popover form only — the folded block
    // wraps its options across the dialog's rows and must not gain a scroll.
    const plainOptions = rule('.column-picker__options');
    expect(plainOptions).not.toMatch(/overflow-y/);
    expect(plainOptions).not.toMatch(/min-height/);
    expect(plainOptions).not.toMatch(/max-height/);
  });
});
