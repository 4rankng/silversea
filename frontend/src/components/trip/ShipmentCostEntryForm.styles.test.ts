import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// QA 28/11 slice A (driver expenses @390×740): the empty face between the
// "Chi phí lô hàng & tiền đường" heading and the first subsection was a
// 257px illustration + instruction copy. The law now:
//   1. the section renders NO EmptyState/illustration block — the empty
//      face is one compact inline line in the lot table head, beside the
//      [+ Thêm chi phí] button;
//   2. that line is a single ellipsized caption row (margin 0, caption
//      token, nowrap) so it adds ~20px, not 257px;
//   3. the vertical budget from the section heading top to the empty line
//      stays ≤120px: section padding ≤12px (10px in the ≤600px band),
//      grid gap ≤12px, and the head row keeps items on one line.
const css = readFileSync(resolve(process.cwd(), 'src/components/trip/ShipmentCostEntryForm.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/components/trip/ShipmentCostEntryForm.tsx'), 'utf8');

/** The body of a rule whose selector sits alone on its line. */
function ruleBody(selector: string, scope: string = css): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = scope.match(new RegExp(`^\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1]!;
}

describe('ShipmentCostEntryForm — compact driver-expense empty face (QA 28/11 slice A)', () => {
  it('renders no EmptyState illustration block in the expense section', () => {
    expect(tsx).not.toMatch(/EmptyState/);
    expect(tsx).toContain('shipment-cost-entry__empty-inline');
    // The compact label lives beside the add button in the lot table head.
    expect(tsx).toMatch(/shipment-cost-entry__table-head[^]*?shipment-cost-entry__empty-inline/);
    expect(tsx).toContain('Chưa có chi phí phát sinh');
  });

  it('keeps the empty line to one compact caption row', () => {
    const body = ruleBody('.shipment-cost-entry__empty-inline');
    expect(body).toMatch(/margin:\s*0/);
    expect(body).toMatch(/font-size:\s*var\(--text-caption-size\)/);
    expect(body).toMatch(/white-space:\s*nowrap/);
    expect(body).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('caps the vertical budget between heading and empty line at ≤120px', () => {
    // Section chrome: padding and inter-block gap ≤12px each (the layout
    // rule, not the --control-mobile-h custom-property rule above it).
    const base = css.replace(/@media[^{]*\{[^}]*\}/g, '');
    const bodies = [...base.matchAll(/^\s*\.shipment-cost-entry\s*\{([^}]*)\}$/gm)].map((m) => m[1]!);
    const section = bodies.find((body) => body.includes('gap:'));
    expect(section, 'expected the layout rule for .shipment-cost-entry').toBeTruthy();
    expect(section).toMatch(/gap:\s*(?:[1-9]|1[0-2])px/);
    expect(section).toMatch(/padding:\s*(?:[1-9]|1[0-2])px/);
    // Mobile band (≤600px, driver phones) tightens padding further.
    const band = css.match(/@media \(max-width: 600px\)\s*\{([^}]*)\}/);
    expect(band, 'expected the ≤600px mobile band').toBeTruthy();
    expect(band![1]).toMatch(/\.shipment-cost-entry\s*\{[^}]*padding:\s*10px 8px/);
    // Head row: items on one line, no vertical stacking of the empty label.
    expect(ruleBody('.shipment-cost-entry__table-head')).toMatch(/align-items:\s*center/);
  });
});

describe('ShipmentCostEntryForm — phone-band draft line (SIL-1272)', () => {
  it('stacks the draft line to a full-width select at ≤600px so long fee names stay readable', () => {
    // 390px: the three-track line squeezed "Tên chi phí" to an 82px sliver —
    // "Phí lưu cont (DEM/DET)" clipped to "Phí lưu con" (QA measured
    // scrollWidth 183px vs clientWidth 82px). The phone band gives the
    // select the whole row over a two-track line (fields + auto actions).
    const band = css.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)\n\}/);
    expect(band, 'expected the ≤600px mobile band').toBeTruthy();
    const body = band![1]!;
    expect(body).toMatch(/\.shipment-cost-entry__draft-line\s*\{[^}]*grid-template-columns:\s*1fr auto/);
    expect(body).toMatch(/\.shipment-cost-entry__draft-line > \.ds-uui-select\s*\{[^}]*grid-column:\s*1 \/ -1/);
  });

  it('keeps the three-track line above the phone band — desktop (243px field) unchanged', () => {
    const base = css.replace(/@media[^{]*\{[^}]*\}/g, '');
    const line = base.match(/^\s*\.shipment-cost-entry__draft-line\s*\{([^}]*)\}$/m);
    expect(line?.[1] ?? '').toMatch(/grid-template-columns:\s*minmax\(0, 1\.2fr\)/);
    expect(line?.[1] ?? '').not.toMatch(/1fr auto/);
  });
});
