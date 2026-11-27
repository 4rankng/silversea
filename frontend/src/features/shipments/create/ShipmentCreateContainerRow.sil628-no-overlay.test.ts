import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-628 (id 732, owner 31/10) — the container table's action column carries
 * ONLY the row delete button; icon affordances in one cell never overlap.
 *
 * Measured root (qa/2026-10-31_sil619-629/before): the factory detail ⓘ
 * overlay (`.csc-container-cell__actions`, absolute) resolved against
 * `#shipment-section-cargo` — the only positioned ancestor ≥1280 — and
 * painted a 315px-tall strip over the delete column; elementFromPoint at the
 * delete button's center returned the overlay span, so the click never
 * reached "Xóa container" (SIL-629's mechanism on a filled form).
 */
const ROW = readFileSync(
  join(__dirname, 'ShipmentCreateContainerRow.tsx'),
  'utf8',
);
const CELL_CSS = readFileSync(
  join(__dirname, 'ShipmentContainerCell.css'),
  'utf8',
);

describe('SIL-628 anti-overlap containment + SIL-1161 in-cell detail affordance', () => {
  it('renders the detail affordance IN-CELL — no popover, no detached overlay source', () => {
    // SIL-1161 (KB 10.2.1) revives the factory detail affordance as an
    // in-cell button opening the house OperationalSiteDetailsDialog — the
    // hover popover (FactoryDetailPopover) stays retired.
    expect(ROW).toContain('Xem chi tiết nhà máy');
    expect(ROW).toContain('actions={');
    expect(ROW).not.toContain('FactoryDetailPopover');
    // The lucide Info icon has no remaining consumer in the row.
    expect(ROW).not.toMatch(/import \{[^}]*\bInfo\b[^}]*\} from 'lucide-react'/);
  });

  it('pins every cell as its own containing block (overlay can never escape its cell)', () => {
    expect(CELL_CSS).toContain('.csc-container-cell { cursor: text; position: relative; }');
  });

  it('keeps the overlay fade law pinned (the shared primitive stays intact for consumers)', () => {
    expect(CELL_CSS).toMatch(
      /\.csc-container-cell:has\(\[role='combobox'\]\[aria-expanded='true'\]\) \.csc-container-cell__actions \{ opacity: 0; pointer-events: none; \}/,
    );
  });
});
