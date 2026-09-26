import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Mobile touch-floor contract — design-guidelines.md §5 ("44px touch targets
 * on mobile") and the control-density contract in frontend/docs/design-system.md.
 *
 * The 2026-09-26 mobile sweep (qa/2026-09-26_mobile-ux-sweep/) measured these
 * exact regressions in a real browser across 360-1024px:
 *   - hamburger 32×44 on 52 routes (primary nav control under the floor)
 *   - header/page action buttons at 30px (`responsive.css` rule out-specifying
 *     Button.css's phone floor) and 40px (page CSS owning control height)
 *   - every UUI combobox input a 16px strip: tapping the field opened the
 *     list WITHOUT focusing the input, so the next keystroke went nowhere
 *   - unstyled `<small>` inheriting the UA `small { font-size: smaller }`
 *     rendered 9.6px / 8.8px on /recoverable-costs (§5 label floor is 11px)
 *   - /finance y-axis unit label `tr₫` at 9px
 * Ticket 6770b9cb (2026-09-10, 30/32px phone scale) predates the 09-22 law
 * book; the later law wins. These pins keep it that way.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('mobile touch floor (design-guidelines §5)', () => {
  it('squares the phone hamburger to the 44px touch floor', () => {
    const responsive = read('src/styles/responsive.css');
    expect(responsive).toMatch(
      /\.topbar__toggle\s*\{\s*width:\s*var\(--control-touch-h\);\s*height:\s*var\(--control-touch-h\);/,
    );
  });

  it('pins the ID-scoped .btn floor guard in all three touch bands', () => {
    const responsive = read('src/styles/responsive.css');
    const guard = '#root .btn { min-height: var(--control-touch-h); min-width: var(--control-touch-h); }';
    // phone ≤640, pointer:coarse any width, tablet 641-900.
    expect(responsive.split(guard).length - 1).toBe(3);
  });

  it('raises table-cell and card links to the touch floor on coarse pointers', () => {
    const responsive = read('src/styles/responsive.css');
    const coarse = responsive.match(/@media \(pointer: coarse\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(coarse, 'coarse-pointer block exists').not.toBe('');
    // `a` is display:inline where min-height is ignored — the rule must set
    // display for the floor to apply (68 inline table links at 15px, and
    // .fleet-tire-link/.as-mcard__code in custom cards).
    expect(coarse).toMatch(
      /#root td a\[href\],\s*#root th a\[href\],\s*#root \.fleet-tire-link,\s*#root \.as-mcard__code \{\s*display: inline-flex;\s*align-items: center;\s*flex-wrap: wrap;\s*max-width: 100%;\s*min-height: var\(--control-touch-h\);/,
    );
  });

  it('keeps the customer quick-search height in the stylesheet, not inline', () => {
    const tsx = read('src/pages/CustomersPage.tsx');
    // An inline `min-height` beats EVERY stylesheet rule — this exact bug
    // rendered the search at 30px across 360-1024 (2026-09-26 sweep).
    expect(tsx, 'no inline min-height on controls').not.toMatch(/minHeight:\s*'var\(--control/);
    const css = read('src/pages/CustomersPage.css');
    expect(css).toMatch(/\.customers-quick-search\s*\{\s*min-height:\s*var\(--control-compact-h\);/);
    expect(css).toMatch(
      /@media \(max-width: 640px\), \(pointer: coarse\) \{\s*\.customers-quick-search \{\s*min-height:\s*var\(--control-touch-h\);/,
    );
  });

  it('keeps header/page action buttons on the shared phone floor, not the 30px bare-button floor', () => {
    const responsive = read('src/styles/responsive.css');
    const block = responsive.match(
      /\.page-actions \.btn,\s*\.header-actions \.btn,\s*\.page-header \.btn:not\(\.btn--icon\),\s*\.page-header \.btn-primary \{[^}]*\}/,
    )?.[0] ?? '';
    expect(block, 'action-button floor rule exists').not.toBe('');
    expect(block).toContain('min-height: var(--control-touch-h);');
    expect(block).not.toMatch(/min-height:\s*30px/);
  });

  it('leaves expense list action-button height to the shared .btn primitive', () => {
    const css = read('src/pages/ExpenseListPage.css');
    const block = css.match(
      /\.expense-list-page \.page-actions \.btn \{[^}]*border-radius: 13px[^}]*\}/,
    )?.[0] ?? '';
    expect(block, 'expense action-button block exists').not.toBe('');
    expect(block, 'page CSS must not own control height').not.toMatch(/min-height/);
  });

  it('raises the bare expense quick-create action to the touch floor on phone/coarse pointers', () => {
    const css = read('src/pages/ExpenseEntryPage.css');
    expect(css).toMatch(
      /@media \(max-width: 640px\), \(pointer: coarse\) \{\s*\.expense-add-btn \{\s*min-height: var\(--control-touch-h\);/,
    );
  });

  it('stretches the combobox input over the whole field so taps focus it', () => {
    const cb = read('src/components/untitled-ui/base/select/combobox.css');
    expect(cb).toMatch(/\.uui-combobox__input \{\s*align-self: stretch;/);
    expect(cb).toMatch(/\.uui-combobox__input input\[role='combobox'\] \{\s*height: 100%;/);
    const phone = cb.match(/@media \(max-width: 640px\), \(pointer: coarse\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(phone, 'phone/coarse combobox block exists').not.toBe('');
    expect(phone).toContain('height: 100%');
    expect(phone, '`auto` collapsed the input back to the 16px text strip').not.toMatch(/height:\s*auto/);
    // The root's 4px vertical padding left a dead rim above/below the
    // stretched input — taps at top-3/bottom-3 fell through to main content
    // (probe: qa/2026-09-26_mobile-ux-sweep, all 3 zones must focus+type).
    expect(phone).toMatch(/#root \.uui-combobox \[data-combobox-value\]\s*\{\s*padding-block:\s*0;/);
  });

  it('pins recoverable-costs <small> text to the 11px caption token', () => {
    const css = read('src/features/recoverable-costs/RecoverableCostsWorkspace.css');
    expect(css).toContain('.recoverable-costs-page small{font-size:var(--text-caption-size)}');
  });

  it('keeps the finance chart y-axis unit label at the 11px floor', () => {
    const chart = read('src/components/charts/RevenueTrendChart.tsx');
    expect(chart, 'no 9px chart text').not.toContain('fontSize="9"');
  });
});
