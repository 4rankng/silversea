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
 * 2. The menu-open reveal (`:has([role='combobox'][aria-expanded='true'])`)
 *    applies to every cell, pickers included — opening the menu still shows
 *    the editor. Only a combobox menu trigger qualifies: the factory detail
 *    peek is a dialog `button` and must not reveal the editor chrome
 *    (card 121026185510, FB-006 round 16).
 * 3. The default editor hide stays, so non-picker (text) cells keep the
 *    historical focus-within reveal.
 * 4. `:not()` (not a higher-specificity override) is the mechanism, so
 *    layout rules stay flat in the cascade. The ≤620px phone-record rule
 *    in ClerkShipmentCreatePage.css shows text/number editors continuously —
 *    and since case 2026-10-11-R14-01 (FB-006 round 14, owner re-report) it
 *    excludes picker cells too: the picked value + detail affordance must
 *    hold at every width, with the editor revealed only while the menu opens.
 */
const pageCss = readFileSync(resolve(process.cwd(), 'src/pages/clerk/ClerkShipmentCreatePage.css'), 'utf8');

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
      /\.csc-container-cell:has\(\[role='combobox'\]\[aria-expanded='true'\]\) \.csc-container-cell__display \{ opacity: 0; \}/,
    );
    expect(cellCss).toMatch(
      /\.csc-container-cell:has\(\[role='combobox'\]\[aria-expanded='true'\]\) \.csc-container-cell__editor > \* \{ opacity: 1; \}/,
    );
    // The menu-open selector must not itself be gated by :not(--picker).
    expect(cellCss).not.toMatch(
      /:not\(\.csc-container-cell--picker\):has\(\[role='combobox'\]\[aria-expanded='true'\]\)/,
    );
  });

  // Card 121026185510 (FB-006 round 16): the magnifier detail peek is an
  // in-cell `button` with aria-haspopup="dialog" and its own aria-expanded —
  // a bare `[aria-expanded='true']` menu-open selector treated the open
  // popover as an open picker menu, hiding the picked name and pinning the
  // full combobox + "Xoá" chrome exactly when the operator asked for the
  // factory's details. Only a real picker menu (input role=combobox) may
  // reveal the editor; the dialog trigger must never.
  it('scopes every aria-expanded reveal/fade rule to the combobox menu trigger', () => {
    expect(cellCss).not.toMatch(
      /\.csc-container-cell:has\(\[aria-expanded='true'\]\)/,
    );
    expect(cellCss).toMatch(
      /\.csc-container-cell:has\(\[role='combobox'\]\[aria-expanded='true'\]\) \.csc-container-cell__actions \{ opacity: 0; pointer-events: none; \}/,
    );
  });

  it('keeps the default editor hide for idle cells', () => {
    expect(cellCss).toMatch(
      /\.csc-container-cell__editor > \* \{ width: 100%; opacity: 0; \}/,
    );
  });

  it('keeps the picked-value contract in the stacked layout too (case 2026-10-11-R14-01)', () => {
    // The ≤620px continuous-editor carve-out serves text/number cells only.
    const stacked = pageCss.slice(pageCss.indexOf('/* Stacked records'));
    expect(stacked).toMatch(
      /\.csc-container-cell:not\(\.csc-container-cell--picker\) \.csc-container-cell__display \{ display: none; \}/,
    );
    expect(stacked).toMatch(
      /\.csc-container-cell:not\(\.csc-container-cell--picker\) \.csc-container-cell__editor > \* \{ opacity: 1; \}/,
    );
  });
});

/**
 * Card 171026113500 (FB-006, verify fail round 17) — the fade above is decided
 * by a descendant's `aria-expanded`, so the editor (the combobox and its "Xoá"
 * button) stayed in the document and in the accessibility tree, and any state
 * that kept the picker menu open put the full chrome back over the picked
 * name. A `collapsePickedEditor` cell (the create-form "Nhà máy" cell) now
 * takes its editor out of the visible DOM once a value is committed:
 *
 * 1. `--picked` (a value is committed) with no `--editing` session hides the
 *    editor subtree from painting, hit-testing and the a11y tree. Only the
 *    editor: the value band, the sub-value and the `actions` magnifier are not
 *    part of it and stay on screen.
 * 2. `visibility` — not `display: none` — so the box (and with it the column
 *    width and the row height) never moves (law book §4 no-truncation).
 * 3. Opening the picker menu restores the editor even without `--editing`, so
 *    the reveal contract above keeps holding for every picker cell.
 * 4. The two rules that already existed (or not) are untouched: this is an
 *    addition, and the container-type cell never carries `--picked` (the row
 *    opts only the factory cell in) — it keeps the Số container / type reveal.
 */
describe('container cell picked-editor collapse (card 171026113500)', () => {
  it('hides the editor of a picked cell from the visible DOM and the a11y tree', () => {
    expect(cellCss).toMatch(
      /\.csc-container-cell--picked:not\(\.csc-container-cell--editing\) \.csc-container-cell__editor \{ visibility: hidden; \}/,
    );
    // Only the editor is hidden: the value band and the magnifier band are
    // siblings, never descendants of it.
    expect(cellCss).not.toMatch(/\.csc-container-cell--picked[^{]*\.csc-container-cell__display[^{]*\{[^}]*visibility:\s*hidden/);
    expect(cellCss).not.toMatch(/\.csc-container-cell--picked[^{]*\.csc-container-cell__actions[^{]*\{[^}]*visibility:\s*hidden/);
  });

  it('never uses display:none for the collapse (the cell box must not move)', () => {
    expect(cellCss).not.toMatch(/\.csc-container-cell--picked[^{]*\{[^}]*display:\s*none/);
  });

  it('restores the editor when a picker menu opens, editing session or not', () => {
    expect(cellCss).toMatch(
      /\.csc-container-cell:has\(\[role='combobox'\]\[aria-expanded='true'\]\) \.csc-container-cell__editor \{ visibility: visible; \}/,
    );
  });
});
