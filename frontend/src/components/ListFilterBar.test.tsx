import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ListFilterBar } from './ListFilterBar';

const componentCss = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.css'), 'utf8');
const filterBarCss = readFileSync(resolve(process.cwd(), 'src/components/FilterBar.css'), 'utf8');

describe('ListFilterBar layout/wrap contract (card 20260922_38)', () => {
  it('is one wrapping row: wrap only when out of space, consistent rows below, never ragged floats', () => {
    // The bar row itself rides the shared .filter-bar sheet.
    const bar = filterBarCss.match(/\.filter-bar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(bar).toMatch(/display:\s*flex;/);
    expect(bar).toMatch(/flex-wrap:\s*wrap;/);
    expect(bar).toMatch(/align-items:\s*end;/);
    // One gap rhythm — a wrapped second row aligns exactly like the first.
    // Nepocorp reference rhythm after case QA-2026-09-22-02: 12px row gap,
    // 24px column gap, flat chrome (the old 8px uniform + border-block bands
    // read as unfinished scaffolding — operator 2026-09-22).
    expect(bar).toMatch(/gap:\s*12px 24px;/);
    expect(bar).not.toMatch(/border-block/);
    // No floating controls: wrap goes through the flex row only
    // (fix family 20260919_48 / 20260920_34 — the ragged-float defects).
    expect(filterBarCss).not.toMatch(/float\s*:/);
    expect(componentCss).not.toMatch(/float\s*:/);
    // The shared sheet is a structural dependency of the component module —
    // a host can never render an unstyled bar.
    const moduleSource = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.tsx'), 'utf8');
    expect(moduleSource).toContain("import './FilterBar.css';");
    expect(moduleSource).toContain("import './ListFilterBar.css';");
  });

  it('unifies control height per context and rises to the touch floor on coarse pointers', () => {
    // Card 20260920_19: siblings in one bar share one computed height. The
    // blanket [data-control-size] pair outranks every control-geometry size
    // rule regardless of stylesheet order.
    expect(componentCss).toMatch(
      /\.list-filter-bar \[data-uui-control\],\s*\.list-filter-bar \[data-uui-control\]\[data-control-size\]\s*\{[^}]*--uui-control-h:\s*var\(--filter-control-h\);/,
    );
    // Segmented date groups read --uui-control-h through inheritance/fallback.
    expect(componentCss).toMatch(/\.list-filter-bar\s*\{[^}]*--uui-control-h:\s*var\(--filter-control-h\);/);
    // Coarse pointers re-floor the whole bar at the 44px touch minimum.
    expect(componentCss).toMatch(
      /@media \(pointer: coarse\)\s*\{[^}]*\.list-filter-bar\s*\{[^}]*--filter-control-h:\s*var\(--control-touch-h\);/,
    );
  });

  it('carries every hosted control family the width floors/caps the page bars used to guard', () => {
    // Searchable/combobox fields (.csc-searchable-field root + bare ComboBox
    // trigger): 240 floor against the documented 65px sliver + placeholder
    // truncation; 480 cap keeps long customer names off the row width.
    expect(componentCss).toMatch(
      /\.list-filter-bar \.csc-searchable-field,\s*\.list-filter-bar \[data-uui-control='combobox'\]\s*\{[^}]*min-width:\s*240px;[^}]*max-width:\s*480px;/,
    );
    // Segmented date groups ([data-input-wrapper] root): 149 floor against the
    // documented 95px squeeze with the calendar trigger collapsing.
    expect(componentCss).toMatch(/\.list-filter-bar \[data-input-wrapper\]\s*\{[^}]*min-width:\s*149px;/);
    // Selects (.ds-uui-select root): width:auto + 180 floor against the
    // documented width:100% overflow of the trailing action past the viewport.
    expect(componentCss).toMatch(/\.list-filter-bar \.ds-uui-select\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*180px;/);
    // Quick filters stay one wrapping group.
    expect(componentCss).toMatch(/\.list-filter-bar__quick\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
  });
  it('never grows a bar child — grid cells shrink, floors hold (case QA-2026-09-22-01)', () => {
    // The operator-reported stacking defect: the date root flex-grew to the
    // full row (1145px for DD/MM/YYYY) and forced one-control-per-row wrap.
    // Card 20260925_8: the bar is a real grid now — no child can flex-grow
    // (inert flex pins removed); the invariant that remains is min-width:0
    // (a cell shrinks inside its track instead of overflowing a neighbour)
    // plus the per-family width floors below.
    expect(componentCss).toMatch(/\.list-filter-bar > \*:not\(\.filter-bar__spacer\)\s*\{[^}]*min-width:\s*0;/);
    expect(componentCss).not.toMatch(/\.list-filter-bar > \*:not\(\.filter-bar__spacer\)\s*\{[^}]*flex:/);
    expect(componentCss).toMatch(/\.list-filter-bar \[data-input-wrapper\]\s*\{[^}]*width:\s*168px;[^}]*min-width:\s*149px;/);
  });

  // Card 20260925_1 (CHIEF 25/09 09:46, 390px screenshot): phones expose a
  // 2-column pair wrapper so short-value controls (date pair, dropdown pair)
  // share one row instead of stacking every control full-width. The shared
  // component defines the contract; every host inherits the same pair rule.
  it('phones pair short-value controls on a 2-column grid (card 20260925_1 short-value pairing)', () => {
    // Card 20260925_8: the mobile break moved 480 → 767 (mandate <768 stack).
    const mobile = componentCss.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    // The pair wrapper exists and lays out as a 2-column grid on phones.
    expect(mobile).toMatch(/\.list-filter-bar__pair\s*\{[^}]*display:\s*grid/);
    expect(mobile).toMatch(/\.list-filter-bar__pair\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    // Pair descendants release the desktop width floors so the grid can size
    // each one to its 1/2 track.
    expect(mobile).toMatch(/\.list-filter-bar__pair \[data-input-wrapper\][\s\S]*?max-width:\s*none/);
    expect(mobile).toMatch(/\.list-filter-bar__pair \.ds-uui-select[\s\S]*?max-width:\s*none/);
    // Spacer is desktop-only (pins actions to the row end); on phones it
    // must collapse so the column stack puts actions on their own row.
    expect(mobile).toMatch(/\.list-filter-bar \.filter-bar__spacer\s*\{\s*display:\s*none/);
  });

  // Card 20260925_1: every hosted control surface reads --filter-control-h
  // on phones so search, date, select, native input all share one height
  // token (44px, the touch floor) — no more 64/80/72 mis-matches.
  it('phones pin every hosted control to the chosen --filter-control-h token (card 20260925_1 one-height)', () => {
    // Card 20260925_8: mobile break 480 → 767.
    const mobile = componentCss.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    // Search input shell + data-uui-control + date wrapper + select all read the token.
    expect(mobile).toMatch(/min-height:\s*var\(--filter-control-h\)/);
    // No shadow on any control at mobile (flat law, design §3).
    expect(mobile).toMatch(/\.list-filter-bar \[data-uui-control\]\s*\{[^}]*box-shadow:\s*none/);
  });

  // Card 20260925_5 (CHIEF 25/09 19:09, 1920px screenshot 'Tổng quan lô
  // hàng'): the date pair and the short-select pair used to render as a
  // detached white panel — the wrapper defaulted to `display: block`, so the
  // two stacked labelled controls floated as a chunky block on a row of
  // their own while the search / Xuất-Nhập / Kế hoạch sat in the bar's
  // flex row, reading as two different filter bars on the same page.
  // Card 20260925_8 (REBUILD): the desktop pair is one 2-col GRID cell of
  // the bar's grid row (the old inline flex-cell could still re-wrap and
  // break the column rhythm), baseline-aligned with the rest of the row,
  // no panel chrome (bg transparent, border 0, border-radius 0, no
  // shadow). The mobile ≤767 rule below re-states the same 2-col layout
  // for the phone stack.
  it('desktop pair is one 2-col grid cell of the bar — no detached panel (cards 20260925_5 / 20260925_8)', () => {
    // Pull the desktop-default rule (the one OUTSIDE any @media block) so
    // a future regression that moved the rule into a media condition would
    // also fail this assertion.
    const desktopBlock = componentCss.match(
      /\.list-filter-bar__pair\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(desktopBlock, 'pair has a top-level default rule').not.toBe('');
    // The pair rows its two children horizontally via a 2-col grid (no
    // vertical stacking, no flex re-wrap).
    expect(desktopBlock).toMatch(/display:\s*grid/);
    expect(desktopBlock).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(desktopBlock).toMatch(/align-items:\s*end/);
    expect(desktopBlock).toMatch(/gap:\s*12px/);
    // Flat sheet: no panel chrome (the default `box-shadow: none` covers
    // that side — the rule never pins one explicitly so the page-level
    // "no-shadow anywhere" assertion still holds).
    expect(desktopBlock).toMatch(/background:\s*transparent/);
    expect(desktopBlock).toMatch(/border:\s*0/);
    expect(desktopBlock).toMatch(/border-radius:\s*0/);
    // The desktop rule must precede the mobile @media block so the grid
    // rule still wins on phones via source order. Catch a regression that
    // flips the order, which would let mobile layout leak onto desktop.
    const desktopIdx = componentCss.search(/\.list-filter-bar__pair\s*\{/);
    const mobileIdx = componentCss.search(/@media \(max-width: 767px\)/);
    expect(desktopIdx).toBeGreaterThan(-1);
    expect(mobileIdx).toBeGreaterThan(desktopIdx);
    // Mobile contract (card 20260925_1) is preserved: pair is a 2-col
    // grid at <768, with width floors released so tracks size each cell.
    const mobile = componentCss.match(/@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(mobile).toMatch(/\.list-filter-bar__pair\s*\{[^}]*display:\s*grid/);
    expect(mobile).toMatch(/\.list-filter-bar__pair\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  });
});

describe('ListFilterBar control integration', () => {
  it('renders the regions in layout order: search, controls, quick filters, spacer, actions', () => {
    const { container } = render(
      <ListFilterBar
        search={{ value: '', onChange: () => {}, placeholder: 'Tìm…', ariaLabel: 'Tìm kiếm' }}
        quickFilters={<button type="button">Hôm nay</button>}
        quickFiltersLabel="Bộ lọc nhanh"
        actions={<button type="button">Đặt lại</button>}
      >
        <select aria-label="Trạng thái">
          <option>Tất cả</option>
        </select>
      </ListFilterBar>,
    );
    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    const kids = Array.from(bar.children);
    expect(kids).toHaveLength(5);
    expect(bar.querySelector('.filter-bar__search')).toBe(kids[0]);
    expect(screen.getByRole('combobox', { name: 'Trạng thái' })).toBe(kids[1]);
    expect(bar.querySelector('.list-filter-bar__quick')).toBe(kids[2]);
    expect(bar.querySelector('.filter-bar__spacer')).toBe(kids[3]);
    // Card 20260925_8: actions ride as ONE grid item (.filter-bar__actions)
    // so multi-element fragments don't scatter into stray grid cells.
    const actions = bar.querySelector('.filter-bar__actions');
    expect(actions).toBe(kids[4]);
    expect(actions?.contains(screen.getByRole('button', { name: 'Đặt lại' }))).toBe(true);
  });

  it('passes typed search text through unmodified', () => {
    const onChange = vi.fn();
    render(
      <ListFilterBar search={{ value: '  q  ', onChange, placeholder: 'Tên, MST…', ariaLabel: 'Tìm khách hàng' }} />,
    );
    const input = screen.getByRole('textbox', { name: 'Tìm khách hàng' }) as HTMLInputElement;
    expect(input).toHaveValue('  q  ');
    expect(input).toHaveAttribute('placeholder', 'Tên, MST…');
    fireEvent.change(input, { target: { value: '  an  ' } });
    expect(onChange).toHaveBeenCalledWith('  an  ');
  });

  it('labels the quick-filter group and drops the spacer without actions', () => {
    const { container } = render(
      <ListFilterBar quickFilters={<button type="button">Tất cả</button>} quickFiltersLabel="Lọc khách hàng" />,
    );
    const group = screen.getByRole('group', { name: 'Lọc khách hàng' });
    expect(group.className).toBe('list-filter-bar__quick');
    expect(container.querySelector('.filter-bar__spacer')).toBeNull();
    expect(container.querySelector('.filter-bar__search')).toBeNull();
  });

  it('renders every optional region as absent (no empty chrome)', () => {
    const { container } = render(
      <ListFilterBar actions={false}>
        <span data-testid="control" />
      </ListFilterBar>,
    );
    expect(container.querySelector('.filter-bar__search')).toBeNull();
    expect(container.querySelector('.list-filter-bar__quick')).toBeNull();
    expect(container.querySelector('.filter-bar__spacer')).toBeNull();
    expect(screen.getByTestId('control')).toBe(container.querySelector('.filter-bar.list-filter-bar')?.firstElementChild);
  });
});
