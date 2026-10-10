import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cellCss = readFileSync(resolve(process.cwd(), 'src/features/shipments/create/ShipmentContainerCell.css'), 'utf8');

/**
 * Card 101026163000 (FB-006, QA round 13) — after a committed factory pick the
 * create-grid "Nhà máy" cell kept the full editable combobox (border + search
 * icon + "Xoá" clear button) on screen: react-aria rightly keeps focus on the
 * input, and the bare `:focus-within` reveal pinned the chrome open until
 * focus left the cell entirely. A picker cell must show its value (plus the
 * detail affordance) and reveal the editor chrome only while its menu is open.
 *
 * Contract:
 * 1. The `:focus-within` reveal/hide rules exclude `--picker` cells (via
 *    `:not()`), so a focused-but-closed picker collapses to its value text.
 * 2. The menu-open reveal (`:has([aria-expanded='true'])`) applies to every
 *    cell, pickers included — opening the menu still shows the editor.
 * 3. The default editor hide stays, so non-picker (text) cells keep the
 *    historical focus-within reveal.
 * 4. `:not()` (not a higher-specificity override) is the mechanism, so the
 *    ≤1037px stacked-layout rule in ClerkShipmentCreatePage.css that shows
 *    editors continuously still wins.
 */
describe('container cell picker reveal (card 101026163000)', () => {
  it('excludes picker cells from the focus-within display hide', () => {
    expect(cellCss).toMatch(
      /\.csc-container-cell:not\(\.csc-container-cell--picker\):focus-within \.csc-container-cell__display,/,
    );
  });

  it('excludes picker cells from the focus-within editor reveal', () => {
    expect(cellCss).toMatch(
      /\.csc-container-cell:not\(\.csc-container-cell--picker\):focus-within \.csc-container-cell__editor > \*,/,
    );
  });

  it('keeps the menu-open reveal for every cell, pickers included', () => {
    expect(cellCss).toMatch(
      /\.csc-container-cell:has\(\[aria-expanded='true'\]\) \.csc-container-cell__display \{ opacity: 0; \}/,
    );
    expect(cellCss).toMatch(
      /\.csc-container-cell:has\(\[aria-expanded='true'\]\) \.csc-container-cell__editor > \* \{ opacity: 1; \}/,
    );
    // The menu-open selector must not itself be gated by :not(--picker).
    expect(cellCss).not.toMatch(
      /:not\(\.csc-container-cell--picker\):has\(\[aria-expanded='true'\]\)/,
    );
  });

  it('keeps the default editor hide for idle cells', () => {
    expect(cellCss).toMatch(
      /\.csc-container-cell__editor > \* \{ width: 100%; opacity: 0; \}/,
    );
  });
});
