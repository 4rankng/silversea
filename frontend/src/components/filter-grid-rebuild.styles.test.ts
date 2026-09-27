import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260927_152 — the filter bar is ONE WRAPPING LINE inside ONE toolbar
 * card, at every width, and which criteria are visible is MEASURED, not
 * declared.
 *
 * Supersedes the measured-grid contract of card 20260927_151. The grid
 * (`repeat(auto-fit, minmax(200px, 1fr))`) held column alignment across wrapped
 * lines but paid for it by stretching the first row to equal tracks and leaving
 * the wrapped row 7-33% full — measured 2026-09-27 at 1187/1402 on /shipments,
 * /shipments-detail and /accounting/invoice-tracking — which is the ragged tail
 * the operator rejected. A wrapping flex line packs each line to its own
 * content, so no line has a hole.
 *
 * The tests below defend the CONTRACT, not wording: the bar declares no column
 * count anywhere, exactly two items grow and both are capped, the search and the
 * `Bộ lọc` trigger always share a line, the criteria fold only through the
 * measured mode, and no popover is ever parked without coordinates.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const listCss = read('src/components/ListFilterBar.css');
const barCss = read('src/components/FilterBar.css');
const barTsx = read('src/components/ListFilterBar.tsx');
const modeTs = read('src/components/filter-bar-mode.ts');
const detailTsx = read('src/pages/ShipmentContainersPage.tsx');
const shipmentsTsx = read('src/pages/ShipmentsPage.tsx');
const dateFieldsTsx = read('src/design-system/forms/DateRangeFields.tsx');

/** Top-level (outside any @media) rule body for a selector. */
function topLevelBlock(css: string, selector: string): string {
  return css.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? '';
}

describe('filter bar = one wrapping line in one card (card 20260927_152)', () => {
  it('the bar wraps instead of tracking columns — every width, no declared column count', () => {
    const bar = topLevelBlock(barCss, '.filter-bar');
    expect(bar, 'bar rule exists').not.toBe('');
    expect(bar).toMatch(/display:\s*flex/);
    expect(bar).toMatch(/flex-wrap:\s*wrap/);
    // Bottom-aligned stacks (label above control) are what keeps a line even.
    expect(bar).toMatch(/align-items:\s*flex-end/);
    expect(bar).toMatch(/gap:\s*12px 16px/);
    expect(barCss).not.toMatch(/float\s*:/);
  });

  it('no column count is declared for the bar anywhere — the retired grid and its bands', () => {
    // A declared count is the defect family: `repeat(auto-fit, …)` stretched the
    // first row, and the declared tablet 2-column band forced four rows out of
    // eight controls. Neither may come back in either sheet.
    expect(barCss).not.toMatch(/\.filter-bar\s*\{[^}]*grid-template-columns/);
    expect(barCss).not.toMatch(/grid-column\s*:/);
    expect(listCss).not.toMatch(/\.filter-bar[^{]*\{[^}]*grid-template-columns/);
    expect(listCss).not.toMatch(/grid-column\s*:/);
    expect(barCss).not.toMatch(/@media \(max-width: 480px\)/);
    expect(listCss).not.toMatch(/@media \(max-width: 480px\)/);
    // The one grid left in the sheets is the from/to pair's inner 2-track
    // group — a control group, not the bar layout.
    const pair = topLevelBlock(listCss, '.list-filter-bar__pair');
    expect(pair).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('the toolbar card is the bar surface: hairline border, surface token, no shadow', () => {
    const card = topLevelBlock(barCss, '.filter-bar--card');
    expect(card).toMatch(/background:\s*var\(--surface\)/);
    expect(card).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(card).not.toMatch(/box-shadow/);
    // …and every shared bar carries it.
    expect(barTsx).toContain('filter-bar filter-bar--card list-filter-bar');
  });

  it('pins the action cluster to the right end of its line', () => {
    expect(barCss).toMatch(/\.filter-bar__spacer\s*\{\s*display:\s*none/);
    expect(barCss).toMatch(/\.filter-bar__spacer \+ \*\s*\{\s*margin-left:\s*auto/);
  });

  it('keeps the width floors that stop a squeezed family from collapsing', () => {
    // Flex sizes to content, so a family that under-reports its intrinsic width
    // would shrink to a sliver: these floors are the guard (measured: the
    // combobox chain reported 65px, the date wrapper ~0).
    expect(listCss).toMatch(/\.list-filter-bar \.csc-searchable-field,[\s\S]{0,400}?min-width:\s*200px/);
    expect(listCss).toMatch(/\.list-filter-bar \.ds-uui-select\s*\{[^}]*min-width:\s*180px/);
    expect(listCss).toMatch(/\.filter-bar\.list-filter-bar > \[data-input-wrapper\]\s*\{[^}]*min-width:\s*149px/);
  });

  it('only two items grow, and both are capped — nothing stretches across a line', () => {
    // The search fills the line's slack so a wrapped line never reads as a
    // ragged tail; the from/to group grows back to its natural width when there
    // is room. Every other bar item is `flex-grow: 0` and content-sized.
    expect(barCss).toMatch(/\.filter-bar > \*\s*\{\s*flex-grow:\s*0;\s*\}/);
    // The search floor is a parameter, not a magic number: ≥220 keeps a
    // readable query field, ≤300 keeps it off a line of its own. 240 is the
    // measured value that holds /shipments to 2 rows at a 594px viewport.
    const searchFloor = Number(barCss.match(/\.filter-bar__search-cell\s*\{[^}]*min-width:\s*(\d+)px/)?.[1]);
    expect(searchFloor).toBeGreaterThanOrEqual(220);
    expect(searchFloor).toBeLessThanOrEqual(300);
    expect(barCss).toMatch(/\.filter-bar__search-cell\s*\{[^}]*max-width:\s*640px/);
    expect(barCss).toMatch(/\.filter-bar \.date-range-fields\s*\{[^}]*flex:\s*1 1 322px/);
    expect(barCss).toMatch(/\.filter-bar \.date-range-fields\s*\{[^}]*max-width:\s*348px/);
    expect(barCss).not.toMatch(/\.filter-bar > \*:not\([^)]*\)\s*\{[^}]*width:\s*100%/);
  });

  it('the search and the Bộ lọc trigger always share the primary line', () => {
    // Operator 2026-09-27: "in small screen size we have put bo loc button there
    // same row with search bar, where search bar still take most of the space".
    // A ≥220px search floor + the ~104px trigger leave the pair inside a
    // ~340px bar.
    const searchFloor = Number(barCss.match(/\.filter-bar__search-cell\s*\{[^}]*min-width:\s*(\d+)px/)?.[1]);
    expect(searchFloor).toBeGreaterThanOrEqual(220);
    // The trigger is content-sized and shares the width contract with the bar.
    expect(barCss).toMatch(/:is\(\.filter-bar, \.filter-dropdown__body\)[^{]*\.searchable-select/);
    expect(barTsx.indexOf('{search &&')).toBeLessThan(barTsx.indexOf('{children}'));
    expect(barTsx.indexOf('{children}')).toBeLessThan(barTsx.indexOf('{presets &&'));
  });

  it('declares no narrow-width band for the bar — the line packs itself', () => {
    // Card 20260927_152: the full-width one-column phone stack was the defect
    // (operator screenshot 2026-09-27 at ~647px CSS: six full-bleed rows, a
    // 1200px-wide "Kế hoạch" dropdown). Nothing declares a column count now.
    expect(barCss).not.toMatch(/@media \(max-width: 767px\)\s*\{[^@]*\.filter-bar\s*\{/);
    expect(listCss).not.toMatch(/@media \(min-width: 768px\) and \(max-width: 1279px\)/);
  });

  it('folds the criteria by MEASURED rows, never by a breakpoint', () => {
    // "when there is enough space we try our best to display all filters, not
    // group inside bo loc" / "group inside bo loc is only when we have no other
    // choice due to screensize limitation" (operator 2026-09-27).
    expect(barTsx).toContain('useFilterBarFit');
    expect(barTsx).toContain('FilterBarModeProvider');
    expect(modeTs).toMatch(/countLines\(bar\)\s*<=\s*maxLines/);
    expect(modeTs).toMatch(/new ResizeObserver\(measure\)/);
    // The verdict is width-deterministic (no per-frame flapping).
    expect(modeTs).toContain('needWidth');
    expect(modeTs).toContain('fitWidth');
    // The criteria stay a single copy: inline on the bar, or behind the trigger.
    const dropdownTsx = read('src/components/FilterDropdown.tsx');
    expect(dropdownTsx).toMatch(/if \(barMode === 'inline' && inlineWhenRoom\) return <>\{children\}<\/>;/);
  });

  it('never parks a popover without coordinates — no `?? 12` fallback anywhere', () => {
    // The operator's third complaint: "why the dropdown jump around not right
    // below where I clicked". Every click-popover keeps its panel hidden until
    // `usePopoverPosition` (or the searchable-select positioner) has run.
    const consumers = [
      'src/components/FilterDropdown.tsx',
      'src/design-system/forms/InlineLabelSelect.tsx',
      'src/design-system/forms/DatePickerSurface.tsx',
      'src/design-system/forms/TimePickerSurface.tsx',
    ];
    for (const file of consumers) {
      const source = read(file);
      expect(source, `${file} has no hardcoded popover origin`).not.toMatch(/\?\?\s*12/);
      expect(source, `${file} gates on a measured position`).toMatch(/data-positioned|data-positioned=/);
    }
    const hook = read('src/hooks/usePopoverPosition.ts');
    expect(hook).toMatch(/triggerRect\.width === 0 && triggerRect\.height === 0/);
    // …and re-measures when the trigger itself moves (the bar re-wraps).
    expect(hook).toMatch(/triggerObserver/);
    const searchable = read('src/design-system/forms/useSearchableSelectPosition.ts');
    expect(searchable).toMatch(/dataset\.positioned = 'true'/);
    // The ≤640px top-pinned sheet is what painted the picker over the header.
    expect(read('src/design-system/forms/SearchableSelect.css')).not.toMatch(/top:\s*max\(72px/);
  });
});

describe('the from/to date group is two independent fields (CHIEF 2026-09-27)', () => {
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

  it('the cue rides inside the field and the seam is decorative', () => {
    // Operator reference 2026-09-27: "Từ 01/09/2026 → Đến 30/09/2026".
    expect(dateFieldsTsx).toContain('fieldPrefix="Từ"');
    expect(dateFieldsTsx).toContain('fieldPrefix="Đến"');
    expect(dateFieldsTsx).toMatch(/className="date-range-fields__arrow"[^>]*aria-hidden="true"/);
    const groupCss = read('src/design-system/forms/DateRangeFields.css');
    expect(groupCss).toMatch(/\[data-has-prefix\]\s*\{[^}]*border:\s*1px solid/);
    expect(groupCss).toMatch(/\[data-has-prefix\][^{]*\.date-seg-group\s*\{[^}]*border:\s*0/);
  });

  it('Chi tiết lô hàng mounts the shared group inside its bar', () => {
    expect(detailTsx).toContain('<DateRangeFields');
    expect(detailTsx).toContain('ariaLabel="Khoảng ngày vận chuyển"');
    expect(detailTsx).not.toContain('DateRangePopover');
    expect(detailTsx).not.toContain('shipments-detail-filter--from');
  });

  it('Tổng quan lô hàng mounts the group plus its visible quick ranges', () => {
    expect(shipmentsTsx).toContain('<DateRangeFields');
    expect(shipmentsTsx).toContain('<DateRangePresets');
    expect(shipmentsTsx).not.toContain('DateRangePopover');
    expect(shipmentsTsx).toContain('LOT_DATE_PRESETS');
  });
});
