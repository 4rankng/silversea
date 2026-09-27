import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260927_151 — the filter bar is ONE measured grid at every width.
 *
 * Supersedes the card 20260925_8 band contract. That rebuild made the bar a
 * real grid but kept a declared tablet band (`768-1279px ⇒ exactly 2 columns`),
 * and the band is what the operator photographed on 27/09: the 8-control
 * Chi tiết lô hàng bar spent FOUR rows on a 1187px screen where its width
 * fitted four columns — "if layout efficiently I just need 2 rows instead
 * currently 4 rows". Column count is now measured from the bar's own width at
 * every size; no band declares a count.
 *
 * The two structural pins that survive from the rebuild: wrapped rows land on
 * the same tracks (equal `1fr` tracks, not content-sized ones — measured
 * 2026-09-27: content-sized tracks gave one row 198px and 253px selects), and
 * the wide control families (from/to date group, segmented preset group) own
 * two tracks so they can never squeeze or wrap inside one.
 */

const listCss = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.css'), 'utf8');
const barCss = readFileSync(resolve(process.cwd(), 'src/components/FilterBar.css'), 'utf8');
const detailCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.css'), 'utf8');
const detailTsx = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.tsx'), 'utf8');
const shipmentsTsx = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.tsx'), 'utf8');
const dateFieldsTsx = readFileSync(resolve(process.cwd(), 'src/design-system/forms/DateRangeFields.tsx'), 'utf8');

/** Top-level (outside any @media) rule body for a selector. */
function topLevelBlock(css: string, selector: string): string {
  return css.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? '';
}

describe('filter bar = one measured grid (card 20260927_151)', () => {
  it('the bar is a grid of EQUAL auto-fit tracks — every width, no declared column count', () => {
    // `.filter-bar` is THE bar layout (FilterBar.css): every filter surface in
    // the app carries it, component or hand-rolled.
    const bar = topLevelBlock(barCss, '.filter-bar');
    expect(bar, 'grid rule exists').not.toBe('');
    expect(bar).toMatch(/display:\s*grid/);
    // Equal tracks are the alignment guarantee: a wrapped row's controls sit on
    // the same column boundaries as the row above.
    expect(bar).toMatch(/grid-template-columns:\s*repeat\(auto-fit, minmax\(200px, 1fr\)\)/);
    expect(bar).toMatch(/align-items:\s*end/);
    expect(bar).toMatch(/gap:\s*12px 16px/);
    expect(barCss).not.toMatch(/float\s*:/);
  });

  it('no band declares a fixed column count any more (the retired tablet 2-col rule)', () => {
    // The only grid-template-columns declarations for the bar are the measured
    // auto-fit rule and the phone 1-column stack.
    const barColumnRules = [...barCss.matchAll(/\.filter-bar\s*\{[^}]*grid-template-columns:\s*([^;]+);/g)]
      .map((match) => match[1].trim());
    expect(barColumnRules).toHaveLength(2);
    expect(barColumnRules[0]).toBe('repeat(auto-fit, minmax(200px, 1fr))');
    expect(barColumnRules[1]).toBe('minmax(0, 1fr)');
    // The component sheet must never re-declare the grid.
    expect(listCss).not.toMatch(/grid-template-columns:\s*repeat\(auto-fit/);
    // The tablet band survives only to let the pair's children fill their cell.
    const tablet = listCss.match(/@media \(min-width: 768px\) and \(max-width: 1279px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(tablet, 'tablet band exists').not.toBe('');
    expect(tablet).not.toMatch(/grid-template-columns/);
  });

  it('hides the flex spacer and pins actions to the end of their grid row', () => {
    expect(barCss).toMatch(/\.filter-bar__spacer\s*\{\s*display:\s*none/);
    expect(barCss).toMatch(/\.filter-bar__spacer \+ \*\s*\{[^}]*grid-column:\s*auto \/ -1/);
    expect(barCss).toMatch(/\.filter-bar__spacer \+ \*\s*\{[^}]*justify-self:\s*end/);
  });

  it('the two structurally wide families own two tracks — the rest take one', () => {
    expect(listCss).toMatch(/\.filter-bar\.list-filter-bar > \.date-range-fields,\s*\n?\.filter-bar\.list-filter-bar > \.ds-tabs\s*\{\s*grid-column:\s*span 2;/);
    // The search stays a single track: two tracks pushed the detail bar onto a
    // third row at 1024-1187px.
    expect(listCss).not.toMatch(/\.filter-bar__search\s*\{[^}]*grid-column:\s*span/);
    // A control floor may never exceed one track (200px) or it overflows its
    // cell into the neighbour — the three family floors are the ones that count.
    expect(listCss).toMatch(/\.list-filter-bar \.csc-searchable-field,[\s\S]{0,400}?min-width:\s*200px/);
    expect(listCss).toMatch(/\.list-filter-bar \.ds-uui-select\s*\{[^}]*min-width:\s*180px/);
    expect(listCss).toMatch(/\.list-filter-bar\s*(?:>\s*)?\[data-input-wrapper\]\s*\{[^}]*min-width:\s*149px/);
  });

  it('mobile <768 stacks one column while the pairs keep their 2-up rhythm', () => {
    const mobile = barCss.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(mobile, 'mobile <768 block exists').not.toBe('');
    expect(mobile).toMatch(/\.filter-bar\s*\{/);
    expect(mobile).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(barCss).not.toContain('@media (max-width: 480px)');
    expect(listCss).not.toContain('@media (max-width: 480px)');
    expect(topLevelBlock(listCss, '.list-filter-bar__pair')).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(topLevelBlock(listCss, '.list-filter-bar__pair')).toMatch(/background:\s*transparent/);
    expect(topLevelBlock(listCss, '.list-filter-bar__pair')).toMatch(/border:\s*0/);
  });

  it('source order: measured grid, then the tablet pair-fill block, then mobile', () => {
    const desktopIdx = listCss.search(/\.filter-bar\.list-filter-bar/);
    const tabletIdx = listCss.search(/@media \(min-width: 768px\) and \(max-width: 1279px\)/);
    const mobileIdx = listCss.search(/@media \(max-width: 767px\)/);
    expect(desktopIdx).toBeGreaterThan(-1);
    expect(tabletIdx).toBeGreaterThan(desktopIdx);
    expect(mobileIdx).toBeGreaterThan(tabletIdx);
  });
});

describe('both shipment workboards ride the ONE from/to date group (cards 20260927_150/151)', () => {
  it('the shared group is two independent single-date fields, never a range picker', () => {
    expect(dateFieldsTsx).toContain("fromLabel = 'Từ ngày'");
    expect(dateFieldsTsx).toContain("toLabel = 'Đến ngày'");
    expect(dateFieldsTsx).toContain('BufferedUuiDateInput');
    expect(dateFieldsTsx).not.toContain('DateRangePopover');
    expect(dateFieldsTsx).not.toContain('DatePanel');
    // Order is enforced between the two fields: each carries the other's
    // boundary as min/max, so neither a typed date nor a calendar pick can
    // invert the range.
    expect(dateFieldsTsx).toMatch(/inputProps=\{\{ max: to \|\| undefined \}\}/);
    expect(dateFieldsTsx).toMatch(/inputProps=\{\{ min: from \|\| undefined \}\}/);
  });

  it('Chi tiết lô hàng mounts the shared group inside its bar', () => {
    expect(detailTsx).toContain('<DateRangeFields');
    expect(detailTsx).toContain('ariaLabel="Khoảng ngày vận chuyển"');
    expect(detailTsx).not.toContain('DateRangePopover');
    // The page-local pair markup (and its --from/--to slots) is gone.
    expect(detailTsx).not.toContain('list-filter-bar__pair');
    expect(detailTsx).not.toContain('shipments-detail-filter--from');
    expect(detailCss).not.toContain('.shipments-detail-filters__date-pair');
  });

  it('Tổng quan lô hàng mounts the group plus its visible quick ranges', () => {
    expect(shipmentsTsx).toContain('<DateRangeFields');
    expect(shipmentsTsx).toContain('<DateRangePresets');
    expect(shipmentsTsx).not.toContain('DateRangePopover');
    expect(shipmentsTsx).toContain('LOT_DATE_PRESETS');
  });
});
