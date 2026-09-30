import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterBar } from './FilterBar';
import { ListFilterBar } from '../components/ListFilterBar';

const componentCss = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.css'), 'utf8');
const filterBarCss = readFileSync(resolve(process.cwd(), 'src/components/FilterBar.css'), 'utf8');
const bandSource = readFileSync(resolve(process.cwd(), 'src/design-system/FilterBar.tsx'), 'utf8');
const modeSource = readFileSync(resolve(process.cwd(), 'src/design-system/filter-bar-mode.ts'), 'utf8');

describe('FilterBar layout/wrap contract (card 20260922_38)', () => {
  it('is one wrapping row: lines pack to content, actions pin right', () => {
    // The bar row itself rides the shared .filter-bar sheet — ONE wrapping flex
    // line (card 20260927_152, the shape Untitled UI PRO ships for its own
    // filter bar; the measured grid of _151 and its declared bands are retired).
    const bar = filterBarCss.match(/\.filter-bar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(bar).toMatch(/display:\s*flex;/);
    expect(bar).toMatch(/flex-wrap:\s*wrap;/);
    expect(bar).toMatch(/align-items:\s*flex-end;/);
    // One gap rhythm for both axes of the wrap.
    expect(bar).toMatch(/gap:\s*12px 16px;/);
    expect(bar).not.toMatch(/grid-template-columns/);
    expect(bar).not.toMatch(/border-block/);
    // No floating controls: wrap goes through the flex row only
    // (fix family 20260919_48 / 20260920_34 — the ragged-float defects).
    expect(filterBarCss).not.toMatch(/float\s*:/);
    expect(componentCss).not.toMatch(/float\s*:/);
    // The shared sheets are a structural dependency of the band module — a host
    // can never render an unstyled bar.
    expect(bandSource).toContain("import '../components/FilterBar.css';");
    expect(bandSource).toContain("import '../components/ListFilterBar.css';");
  });

  it('unifies control height per context and rises to the touch floor on coarse pointers', () => {
    // Card 20260920_19: siblings in one bar share one computed height. The
    // blanket [data-control-size] pair outranks every control-geometry size
    // rule regardless of stylesheet order.
    // Card 20260927_151: the rule lives on `.filter-bar` (FilterBar.css) so a
    // bare host cannot drift and no page declares a UUI field height.
    expect(filterBarCss).toMatch(
      /\.filter-bar \[data-uui-control\],\s*\.filter-bar \[data-uui-control\]\[data-control-size\]\s*\{[^}]*--uui-control-h:\s*var\(--filter-control-h\);/,
    );
    // Segmented date groups read --uui-control-h through inheritance/fallback.
    expect(filterBarCss).toMatch(/\.filter-bar\s*\{[^}]*--uui-control-h:\s*var\(--filter-control-h\);/);
    // Coarse pointers re-floor the whole bar at the touch minimum.
    expect(filterBarCss).toMatch(
      /@media \(pointer: coarse\)\s*\{[^}]*\.filter-bar\s*\{[^}]*--filter-control-h:\s*var\(--control-touch-h\);/,
    );
  });

  it('carries every hosted control family the width floors/caps the page bars used to guard', () => {
    // Searchable/combobox fields (.csc-searchable-field root + bare ComboBox
    // trigger): 240 floor against the documented 65px sliver + placeholder
    // truncation; 480 cap keeps long customer names off the row width.
    expect(componentCss).toMatch(
      /\.list-filter-bar \.csc-searchable-field,[\s\S]{0,400}?min-width:\s*200px;[\s\S]{0,80}?max-width:\s*480px;/,
    );
    // A STANDALONE date field (a direct bar cell) keeps the 149 floor against
    // the documented 95px squeeze with the calendar trigger collapsing; a
    // field inside the from/to group fills its own track instead.
    expect(componentCss).toMatch(/\.list-filter-bar > \[data-input-wrapper\]\s*\{[^}]*min-width:\s*149px;/);
    // Selects (.ds-uui-select root): width:auto + 180 floor against the
    // documented width:100% overflow of the trailing action past the viewport.
    expect(componentCss).toMatch(/\.list-filter-bar \.ds-uui-select\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*180px;/);
    // Quick filters stay one wrapping group.
    expect(componentCss).toMatch(/\.list-filter-bar__quick\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
  });
  it('never grows a bar child beyond its own value (case QA-2026-09-22-01)', () => {
    // The operator-reported stacking defect: the date root flex-grew to the
    // full row (1145px for DD/MM/YYYY) and forced one-control-per-row wrap.
    // Card 20260927_152: the bar is a wrapping flex line, so `flex-grow: 0` is
    // re-asserted on every child and only TWO items grow — the search (it fills
    // the line's slack, capped at 640px) and the from/to group (capped at its
    // own 348px natural width). Nothing can stretch across a line.
    expect(filterBarCss).toMatch(/\.filter-bar > \*\s*\{\s*flex-grow:\s*0;\s*\}/);
    // The search floor is a parameter (≥220 readable, ≤300 so it never owns a
    // line), not a magic number — 240 is the measured value that holds
    // /shipments to 2 rows at a 594px viewport.
    const searchFloor = Number(filterBarCss.match(/\.filter-bar__search-cell\s*\{[^}]*min-width:\s*(\d+)px/)?.[1]);
    expect(searchFloor).toBeGreaterThanOrEqual(220);
    expect(searchFloor).toBeLessThanOrEqual(300);
    expect(filterBarCss).toMatch(/\.filter-bar \.date-range-fields\s*\{[^}]*max-width:\s*348px;/);
    // The grid-era blanket `min-width: 0` on every child is gone: in flex the
    // engine default (min-content) is the safe one, and the blanket reset used
    // to cancel every family floor a page declared.
    expect(componentCss).not.toMatch(/\.list-filter-bar > \*:not\(\.filter-bar__spacer\)\s*\{[^}]*min-width:\s*0/);
    // A standalone date field keeps its 168px natural width and the 149 floor.
    expect(componentCss).toMatch(/\.filter-bar\.list-filter-bar > \[data-input-wrapper\]\s*\{[^}]*width:\s*168px;[^}]*min-width:\s*149px;/);
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
});

describe('FilterBar control integration', () => {
  it('renders the regions in layout order: search, controls, quick filters, spacer, actions', () => {
    const { container } = render(
      <FilterBar
        search={{ value: '', onChange: () => {}, placeholder: 'Tìm…', ariaLabel: 'Tìm kiếm' }}
        quickFilters={<button type="button">Hôm nay</button>}
        quickFiltersLabel="Bộ lọc nhanh"
        actions={<button type="button">Đặt lại</button>}
      >
        <select aria-label="Trạng thái">
          <option>Tất cả</option>
        </select>
      </FilterBar>,
    );
    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    const kids = Array.from(bar.children);
    expect(kids).toHaveLength(5);
    // The search cell is a stack (the shell plus its own validation line) so a
    // validation message never becomes a grid cell of its own.
    expect(kids[0].classList.contains('filter-bar__search-cell')).toBe(true);
    expect(kids[0].querySelector('.filter-bar__search')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Trạng thái' })).toBe(kids[1]);
    expect(bar.querySelector('.list-filter-bar__quick')).toBe(kids[2]);
    expect(bar.querySelector('.filter-bar__spacer')).toBe(kids[3]);
    // Card 20260925_8: actions ride as ONE grid item (.filter-bar__actions)
    // so multi-element fragments don't scatter into stray grid cells.
    const actions = bar.querySelector('.filter-bar__actions');
    expect(actions).toBe(kids[4]);
    expect(actions?.contains(screen.getByRole('button', { name: 'Đặt lại' }))).toBe(true);
  });

  it('renders the presets slot and the applied-count status as their own regions', () => {
    const { container } = render(
      <FilterBar
        search={{ value: '', onChange: () => {}, placeholder: 'Tìm…', ariaLabel: 'Tìm kiếm' }}
        presets={<button type="button">Hôm nay</button>}
        status={<span>2 bộ lọc đang áp dụng</span>}
        actions={<button type="button">Xóa lọc</button>}
      >
        <select aria-label="Trạng thái">
          <option>Tất cả</option>
        </select>
      </FilterBar>,
    );
    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    const kids = Array.from(bar.children);
    // search cell → control → presets → spacer → actions
    expect(kids).toHaveLength(5);
    expect(bar.querySelector('.filter-bar__presets')).toBe(kids[2]);
    expect(screen.getByRole('button', { name: 'Hôm nay' })).toBeTruthy();
    const actions = bar.querySelector('.filter-bar__actions') as HTMLElement;
    expect(actions).toBe(kids[4]);
    // The applied-count and the reset are ONE cluster at the right end.
    expect(actions.textContent).toContain('2 bộ lọc đang áp dụng');
    expect(actions.contains(screen.getByRole('button', { name: 'Xóa lọc' }))).toBe(true);
  });

  it('passes typed search text through unmodified', () => {
    const onChange = vi.fn();
    render(
      <FilterBar search={{ value: '  q  ', onChange, placeholder: 'Tên, MST…', ariaLabel: 'Tìm khách hàng' }} />,
    );
    const input = screen.getByRole('textbox', { name: 'Tìm khách hàng' }) as HTMLInputElement;
    expect(input).toHaveValue('  q  ');
    expect(input).toHaveAttribute('placeholder', 'Tên, MST…');
    fireEvent.change(input, { target: { value: '  an  ' } });
    expect(onChange).toHaveBeenCalledWith('  an  ');
  });

  it('labels the quick-filter group and drops the spacer without actions', () => {
    const { container } = render(
      <FilterBar quickFilters={<button type="button">Tất cả</button>} quickFiltersLabel="Lọc khách hàng" />,
    );
    const group = screen.getByRole('group', { name: 'Lọc khách hàng' });
    expect(group.className).toBe('list-filter-bar__quick');
    expect(container.querySelector('.filter-bar__spacer')).toBeNull();
    expect(container.querySelector('.filter-bar__search')).toBeNull();
  });

  it('renders every optional region as absent (no empty chrome)', () => {
    const { container } = render(
      <FilterBar actions={false}>
        <span data-testid="control" />
      </FilterBar>,
    );
    expect(container.querySelector('.filter-bar__search')).toBeNull();
    expect(container.querySelector('.list-filter-bar__quick')).toBeNull();
    expect(container.querySelector('.filter-bar__spacer')).toBeNull();
    expect(screen.getByTestId('control')).toBe(container.querySelector('.filter-bar.list-filter-bar')?.firstElementChild);
  });

  it('renders the legacy ListFilterBar alias as the same band (staged cutover, card 20260930_229)', () => {
    const { container } = render(
      <ListFilterBar search={{ value: '', onChange: () => {}, placeholder: 'Tìm…', ariaLabel: 'Tìm kiếm' }} />,
    );
    // The alias is the band, not a second bar: same DOM, same measured root.
    expect(container.querySelector('.filter-bar.filter-bar--card.list-filter-bar')).toBeTruthy();
  });
});

/**
 * The fold slot is what makes the filter law STRUCTURAL (card 20260930_229):
 * until the band existed, the two-row cap was audited after the fact by
 * `testplan/qa/scripts/ui-filter-audit-20260927.mjs`, and a bar whose content
 * needed three rows but mounted no `Bộ lọc` trigger could only be *exempted*
 * (`rowExempt` — /customers@640 was the one case). These are the once-written
 * bar-level tests: a consumer that hands the band a `fold` slot cannot produce
 * that shape — over the budget, the trigger is guaranteed by construction.
 */
describe('FilterBar fold — the law is structural (card 20260930_229)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // `clientWidth` is patched with defineProperty (a getter, not a spy), so it
    // needs its own restore.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      writable: true,
      value: 0,
    });
  });

  it('guarantees the fold affordance by construction — a fold slot ALWAYS mounts the trigger', () => {
    // The structural pin: the band renders FilterDropdown for every fold slot,
    // never a consumer-mounted trigger. The source assertion keeps a refactor
    // from quietly turning the slot back into "children the page wires itself".
    expect(bandSource).toMatch(/\{fold && \(\s*<FilterDropdown/);
    expect(bandSource).toMatch(/inlineWhenRoom=\{!fold\.neverInline\}/);
    // The row budget is the band's own measurement — default two lines.
    expect(bandSource).toContain('useFilterBarFit(barRef)');
    // Signature-agnostic: what the law needs is the TWO-line default, not the
    // absence of a type annotation on the ref parameter.
    expect(modeSource).toMatch(/useFilterBarFit\([^)]*maxLines = 2\)/);
  });

  it('renders the folded criteria inline as direct bar children while the strip holds two rows', () => {
    // jsdom lays nothing out (clientWidth 0), so the engine's no-measure safety
    // keeps the strip inline — the criteria are plain bar items and no trigger
    // exists. This is the healthy wide-bar state, one copy of each criterion.
    const { container } = render(
      <FilterBar
        fold={{
          criteria: <select aria-label="Khu vực"><option>Tất cả</option></select>,
          count: 0,
          onReset: () => {},
          ariaLabel: 'Bộ lọc',
        }}
      />,
    );
    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    expect(screen.getByRole('combobox', { name: 'Khu vực' }).parentElement).toBe(bar);
    expect(screen.queryByRole('button', { name: /^Bộ lọc/ })).toBeNull();
  });

  it('folds the criteria behind the trigger the moment the content exceeds the two-row budget', async () => {
    // The audit's old `rowExempt` shape — three rows and nothing to fold into —
    // is unreachable through the band: the measured rows pass the budget, the
    // mode drops to `dialog`, the criteria LEAVE the bar and the trigger is
    // there. Layout is stubbed the only way it can be in jsdom: boxes carry a
    // `data-row` index and the bar reports a width.
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const row = Number(this.getAttribute('data-row') ?? 0);
      const top = row * 50;
      return { top, bottom: top + 30, height: 30, width: 100, left: 0, right: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 900,
    });
    const { container } = render(
      <FilterBar
        fold={{
          criteria: (
            <>
              <div data-row={0}>Khu vực</div>
              <div data-row={1}>Nhà xe</div>
              <div data-row={2}>Hướng</div>
            </>
          ),
          count: 1,
          onReset: () => {},
          ariaLabel: 'Bộ lọc',
        }}
      />,
    );
    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    // The row budget is a MEASUREMENT and the band commits the verdict on the
    // frame after layout, so wait for the fold instead of reading the bar in the
    // same tick as the render.
    await waitFor(() => expect(bar.textContent).not.toContain('Khu vực'));
    const trigger = screen.getByRole('button', { name: 'Bộ lọc, 1 đang áp dụng' });
    expect(trigger).toBeTruthy();
    expect(rectSpy).toHaveBeenCalled();
  });

  it('keeps a two-row strip inline — the budget is measured, not a breakpoint', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const row = Number(this.getAttribute('data-row') ?? 0);
      const top = row * 50;
      return { top, bottom: top + 30, height: 30, width: 100, left: 0, right: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 900,
    });
    const { container } = render(
      <FilterBar
        fold={{
          criteria: (
            <>
              <div data-row={0}>Khu vực</div>
              <div data-row={1}>Hướng</div>
            </>
          ),
          count: 0,
          onReset: () => {},
          ariaLabel: 'Bộ lọc',
        }}
      />,
    );
    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;
    expect(bar.textContent).toContain('Khu vực');
    expect(screen.queryByRole('button', { name: /^Bộ lọc/ })).toBeNull();
  });

  it('opens the fold on the trigger, resets through the dialog, and keeps one copy of the criteria', () => {
    const onReset = vi.fn();
    render(
      <FilterBar
        fold={{
          criteria: <select aria-label="Khu vực"><option>Tất cả</option></select>,
          count: 2,
          onReset,
          ariaLabel: 'Bộ lọc',
          dialogLabel: 'Bộ lọc nâng cao',
          neverInline: true,
        }}
      />,
    );
    // neverInline is the documented escape for a criterion set that cannot fit
    // two rows at ANY width (the dispatch facet case) — the trigger is always
    // the shape, exactly as when the consumers mounted FilterDropdown with
    // `inlineWhenRoom={false}` themselves.
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc, 2 đang áp dụng' }));
    const dialog = screen.getByRole('dialog', { name: 'Bộ lọc nâng cao' });
    expect(within(dialog).getByRole('combobox', { name: 'Khu vực' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đặt lại' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Áp dụng' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('anchors the fold dialog to its trigger — portalled, and never painted before it has coordinates', () => {
    // The operator's 2026-09-27 complaint ("why the dropdown jump around not
    // right below where i clicked") is the anchor law: the panel rides a portal
    // to <body>, is wired to the trigger's aria contract, and stays
    // `visibility: hidden` until the positioner has run (`data-positioned`).
    // jsdom has no geometry, so the hidden-until-positioned gate is exactly
    // what CAN be pinned here; the rendered geometry is the audit script's
    // anchor probe.
    const { container } = render(
      <FilterBar
        fold={{
          criteria: <div>Kế hoạch</div>,
          count: 0,
          onReset: () => {},
          ariaLabel: 'Bộ lọc',
          neverInline: true,
        }}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Bộ lọc' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = document.querySelector('.filter-dropdown__popover') as HTMLElement;
    expect(panel).toBeTruthy();
    // The dialog is portalled OUT of the bar's subtree (the criteria's own
    // popovers already live at <body> and must not stack under the bar).
    expect(container.contains(panel)).toBe(false);
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    // No coordinates yet in jsdom → the panel must not claim to be positioned
    // (the CSS keeps it hidden; a hardcoded origin is the "jumps over the
    // header" defect family).
    expect(panel.hasAttribute('data-positioned')).toBe(false);
  });
});
