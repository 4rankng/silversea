import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/features/shipments/detail/ShipmentContainerLedger.tsx'), 'utf8');

/**
 * Thao tác card-row contract — owner report 2026-10-16 (mobile screenshot):
 * in card mode the ledger's Thêm/Xóa pair shares one equal row (50/50 tracks,
 * stretched buttons) instead of stacking two fit-content chips in the wide
 * Thao tác band. Desktop keeps the stacked layout — its 7% actions column
 * shears side-by-side labels (column ladder in ShipmentContainersPage.css).
 * Pins the declarations AND their `@container` scope in one exact-block match:
 * un-scoping the rule would shear the pair in the 7% desktop column.
 */
describe('ledger Thao tác add/remove pair in card mode', () => {
  it('renders the pair inside the row-actions wrapper', () => {
    expect(tsx).toContain('shipment-container-ledger__row-actions');
  });

  it('lays the pair out as one 50/50 row, scoped to card mode only', () => {
    expect(css).toMatch(
      /@container shipments-detail \(max-width: 1000px\) \{\s*\.shipment-container-ledger__cell--actions \.shipment-container-ledger__row-actions \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); align-items: stretch; gap: 8px; \}\s*\.shipment-container-ledger__cell--actions \.shipment-container-ledger__row-actions > \.btn \{ width: 100%; \}\s*\}/,
    );
  });

  it('never widens the pair outside the card container', () => {
    const scoped = css.match(/\.shipment-container-ledger__cell--actions \.shipment-container-ledger__row-actions/g) ?? [];
    expect(scoped.length).toBeGreaterThan(0);
    // The pair rules exist only inside the card-mode container block — the
    // desktop table keeps its deliberate stacked layout.
    for (const match of css.matchAll(/\.shipment-container-ledger__cell--actions \.shipment-container-ledger__row-actions[^{]*\{[^}]*\}/g)) {
      const before = css.slice(0, match.index ?? 0);
      const opens = (before.match(/\{/g) ?? []).length;
      const closes = (before.match(/\}/g) ?? []).length;
      expect(opens).toBeGreaterThan(closes); // still inside some block
      const enclosing = before.slice(before.lastIndexOf('@container'), before.lastIndexOf('{'));
      expect(enclosing).toContain('max-width: 1000px');
    }
  });
});
