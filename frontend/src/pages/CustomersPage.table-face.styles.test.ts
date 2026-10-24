import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-169 visual-gate re-dispatch (board comment 1314, 24/10): at 1440 the
// shared record-table CONTAINER card band (@container ≤1100px) hijacked the
// ≥640 face — stacked data-label cells, the LONGMINH code sub-line clipped by
// a card border, 230-240px rows with dead bands, raw-cased chips ("LOG COM").
// The fix pins the verdict's REAL-TABLE contract: real table geometry from
// 640px viewport (page-owned, the shared --table opt-in only starts at 768),
// the 978px budget as a horizontal-scroll floor, and title-cased short-name
// chips on every face.

const css = readFileSync(resolve(process.cwd(), 'src/pages/CustomersPage.css'), 'utf8');
const pageTsx = readFileSync(resolve(process.cwd(), 'src/pages/CustomersPage.tsx'), 'utf8');
const configTsx = readFileSync(resolve(process.cwd(), 'src/pages/config/CustomersConfigPage.tsx'), 'utf8');

describe('customers ≥640 face is the real 7-column table (SIL-169 re-dispatch)', () => {
  it('owns real table geometry for the whole ≥640 range, keyed on .cus-table', () => {
    const mediaBlock = css.match(/@media \(min-width: 640px\) \{[\s\S]*?\n\}\n/)?.[0];
    expect(mediaBlock, 'the ≥640 table-geometry media block exists').toBeTruthy();
    expect(mediaBlock).toContain('.record-table.cus-table { display: table; }');
    expect(mediaBlock).toContain('display: table-header-group;');
    expect(mediaBlock).toContain('display: table-row;');
    expect(mediaBlock).toContain('display: table-cell;');
    // The card band's per-cell data-label eyebrow must never render in table
    // mode — the header renders exactly once, at the top of the table.
    expect(mediaBlock).toContain('.record-table.cus-table tbody td::before { content: none; }');
  });

  it('keeps the 978px verdict budget as a floor that scrolls, never squeezes', () => {
    expect(css).toMatch(/\.record-table\.cus-table \{ min-width: 978px; \}/);
    // The horizontal scroll adoption rides the shared wrap class on both
    // pages' table wraps.
    expect(pageTsx).toContain('record-table-wrap record-table-wrap--scroll');
    expect(configTsx).toContain('record-table-wrap record-table-wrap--scroll');
  });

  it('keeps the 56px row contract on both faces', () => {
    expect(css).toMatch(/\.customers-page \.record-table tbody td \{[^}]*height: 56px/);
    const densityCss = readFileSync(resolve(process.cwd(), 'src/pages/config/customer-config-density.css'), 'utf8');
    expect(densityCss).toMatch(/\.cfg-page--customers \.record-table tbody td \{[^}]*height: 56px/);
  });
});

describe('short-name chips are title-cased on every face (SIL-169 re-dispatch ④)', () => {
  it('the /customers table row and mobile card chips both case the short name', () => {
    const chips = pageTsx.match(/<span className="cus-chip">\{[^}]*\}<\/span>/g) ?? [];
    expect(chips.length, 'both chip faces render').toBe(2);
    for (const chip of chips) {
      expect(chip).toContain('titleCaseVn(c.shortName)');
      expect(chip).not.toContain('{c.shortName}');
    }
  });

  it('the /config/customers catalog chip cases the short name too', () => {
    const chip = configTsx.match(/<span className="cus-chip">\{[^}]*\}<\/span>/)?.[0];
    expect(chip, 'the catalog chip renders').toBeTruthy();
    expect(chip).toContain('titleCaseVn(c.shortName)');
  });
});
