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
    // SIL-169 / card 20260927_152: the page-local `.customers-quick-search`
    // shell is retired — /customers search rides the shared FilterBar band,
    // whose control floor (`--filter-control-h`, with its own touch band)
    // lives in FilterBar.css. The page sheet must not re-declare a local
    // search height (a higher-specificity copy would silently beat the band).
    const css = read('src/pages/CustomersPage.css');
    expect(css, 'no page-local search-shell height survives the band cutover').not.toMatch(/\.customers-quick-search/);
    const band = read('src/components/FilterBar.css');
    expect(band).toMatch(/min-height:\s*var\(--filter-control-h\)/);
  });

  it('keeps header/page action buttons on the shared phone floor, not the 30px bare-button floor', () => {
    const responsive = read('src/styles/responsive.css');
    const block = responsive.match(
      /\.page-actions \.btn,\s*\.header-actions \.btn,\s*\.page-header \.btn:not\(\.btn--icon\) \{[^}]*\}/,
    )?.[0] ?? '';
    expect(block, 'action-button floor rule exists').not.toBe('');
    expect(block).toContain('min-height: var(--control-touch-h);');
    expect(block).not.toMatch(/min-height:\s*30px/);
  });

  it('leaves expense list action-button height to the shared .btn primitive', () => {
    const css = read('src/pages/ExpenseListPage.css');
    // Anchor on the SELECTOR, not on a cosmetic value. This block used to be
    // found by `border-radius: 13px`; the radius later moved to the app-wide
    // 14px control scale, so the anchor silently stopped matching and the
    // test failed on its own scaffolding rather than on the real contract.
    // The contract is only ever the negative: the page must NOT own height.
    // Check EVERY rule with this selector — there is more than one (the
    // grouped `width: auto` rule plus the padding/radius rule), and the
    // 2026-09-26 regression was height sneaking back into any of them.
    const blocks = [...css.matchAll(/\.expense-list-page \.page-actions \.btn \{[^}]*\}/g)].map((m) => m[0]);
    expect(blocks.length, 'expense action-button rules exist').toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block, `page CSS must not own control height: ${block}`).not.toMatch(/(?:min-)?height\s*:/);
    }
    // …and the shared phone floor is what supplies it.
    expect(css).toContain('Height belongs to the shared .btn phone floor');
  });

  it('uses the shared quick-create action and its coarse-pointer touch floor', () => {
    const page = read('src/pages/ExpenseEntryPage.tsx');
    expect(page).toContain('className="btn btn--ghost btn--sm"');
    const css = read('src/components/Button.css');
    expect(css).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\.btn--sm \{[\s\S]*?min-height: var\(--control-touch-h\)/);
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

  it('SIL-583 floors the audited inline triggers at 24px (WCAG 2.5.8, all pointers)', () => {
    // copy button: 20×20 → 24×24
    const debit = read('src/pages/ShipmentDebitPage.css');
    const copy = debit.match(/\.shipment-debit-copy\s*\{[^}]*\}/)?.[0] ?? '';
    expect(copy).toMatch(/width:\s*24px;/);
    expect(copy).toMatch(/height:\s*24px;/);
    // docs badge: 20px tall → min-height 24
    const badge = debit.match(/\.shipment-debit-docs__badge\s*\{[^}]*\}/)?.[0] ?? '';
    expect(badge).toMatch(/min-height:\s*24px;/);
    // master-plan notes trigger + detailed-plan note: 17px line → 24px floor
    const mpg = read('src/features/dispatch/master-plan/MasterPlanGrid.css');
    expect(mpg.match(/\.master-plan-grid__notes-trigger\s*\{[^}]*\}/)?.[0] ?? '').toMatch(/min-height:\s*24px;/);
    const dpg = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(dpg.match(/\.detailed-plan-grid__note\s*\{[^}]*\}/)?.[0] ?? '').toMatch(/min-height:\s*24px;/);
    // inline text buttons: plain `inline` ignores min-height — inline-block carries it
    const decl = dpg.match(/\.detailed-plan-grid__decl-value--action\s*\{[^}]*\}/)?.[0] ?? '';
    expect(decl).toMatch(/display:\s*inline-block;/);
    expect(decl).toMatch(/min-height:\s*24px;/);
    const editor = read('src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css');
    const carrier = editor.match(/\.dispatch-assignment-cell__carrier--action\s*\{[^}]*\}/)?.[0] ?? '';
    expect(carrier).toMatch(/display:\s*inline-block;/);
    expect(carrier).toMatch(/min-height:\s*24px;/);
  });

  it('SIL-583 r2 delivers the named touch clusters as REAL 44px element boxes (no pseudo)', () => {
    const responsive = read('src/styles/responsive.css');
    const coarse = responsive.match(/@media \(pointer: coarse\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(coarse, 'coarse block exists').not.toBe('');
    // Round-3 engine finding: ::after hit extensions are inert on this
    // engine — the round-1/2 layers were removed, and none may return.
    expect(coarse, 'no pseudo hit-extension layers may ship').not.toMatch(/::after\s*\{[^}]*inset:\s*-2px/);
    expect(coarse, 'no pseudo hit-extension layers may ship').not.toMatch(/::after\s*\{[^}]*inset-block:\s*-2px/);
    // The touch token is the REAL 44px §5 floor (decoupled from the 40px
    // ordinary ceiling) — QA verdict 2026-10-30 adopted owner option (a).
    expect(read('src/styles/tokens.css')).toMatch(/--control-touch-h:\s*44px;/);
    // Named QA clusters grow the ELEMENT (real border box) on touch form
    // factors: coarse pointer at any width, or ≤768px at any pointer (the
    // AC's 390/768 sweep widths).
    const debit = read('src/pages/ShipmentDebitPage.css');
    for (const cls of ['shipment-debit-menu__trigger', 'shipment-debit-group__chevron', 'shipment-debit-copy']) {
      const rule = debit.match(new RegExp(`@media \\(max-width: 768px\\), \\(hover: none\\) and \\(pointer: coarse\\) \\{[\\s\\S]*?\\.${cls} \\{([^}]*)\\}`))?.[1] ?? '';
      expect(rule, `${cls} grows to the real touch floor`).toMatch(/width:\s*var\(--control-touch-h\);/);
      expect(rule, `${cls} grows to the real touch floor`).toMatch(/height:\s*var\(--control-touch-h\);/);
    }
    const badge = debit.match(/@media \(max-width: 768px\), \(hover: none\) and \(pointer: coarse\) \{[\s\S]*?\.shipment-debit-docs__badge \{([^}]*)\}/)?.[1] ?? '';
    expect(badge, 'docs badge rides the touch floor').toMatch(/min-height:\s*var\(--control-touch-h\);/);
    const rowMenu = read('src/features/dispatch/dispatch-row-menu.css');
    expect(rowMenu).toMatch(
      /@media \(pointer: coarse\), \(max-width: 768px\) \{\s*:is\(#root, body\) \.dispatch-row-menu__trigger \{[^}]*width:\s*var\(--control-touch-h\);/,
    );
    const tabs = read('src/design-system/Tabs.css');
    expect(tabs).toMatch(/@media \(pointer: coarse\), \(max-width: 768px\) \{\s*\.ds-tabs__btn \{\s*min-height:\s*var\(--control-touch-h\);/);
    const filterBar = read('src/components/FilterBar.css');
    expect(filterBar).toMatch(
      /@media \(pointer: coarse\), \(max-width: 768px\) \{\s*(?:\/\*[^*]*\*\/\s*)?\.filter-bar \{ --filter-control-h: var\(--control-touch-h\); \}/,
    );
    const geometry = read('src/components/untitled-ui/base/control-geometry.css');
    expect(geometry).toMatch(/@media \(max-width: 768px\) \{\s*\[data-uui-control\],\s*\[data-uui-control\]\[data-control-size\] \{\s*--uui-control-h:\s*var\(--control-touch-h\);/);
    const dpg = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(dpg).toMatch(/@media \(pointer: coarse\), \(max-width: 768px\) \{\s*\.dpcard__note,\s*\.dpcard__info \{\s*min-height:\s*var\(--control-touch-h\);/);
    // Pagination rides the touch band too — and its UNCONDITIONAL rules stay
    // at the 40px ordinary ceiling so a fine pointer at ≥769px never sees 44.
    const pagination = read('src/design-system/Pagination.css');
    expect(pagination).toMatch(/\.ds-pagination__btn \{[^}]*min-width:\s*var\(--control-max-h\);/);
    expect(pagination).toMatch(/@media \(pointer: coarse\), \(max-width: 768px\) \{\s*\.ds-pagination__btn,\s*\.ds-pagination__jump input \{\s*min-width:\s*var\(--control-touch-h\);/);
  });

  it('SIL-583 round 3 floors the QA-failed clusters at 24px (mergetag trigger + ledger field links)', () => {
    // "Ghép (n/2)" trigger: 66×20 → min-height 24 (DebitLotTable status cell)
    const debit = read('src/pages/ShipmentDebitPage.css');
    const mergetag = debit.match(/\.shipment-debit-mergetag__trigger\s*\{[^}]*\}/)?.[0] ?? '';
    expect(mergetag, 'mergetag trigger floor exists').not.toBe('');
    expect(mergetag).toMatch(/min-height:\s*24px;/);
    expect(mergetag).toMatch(/display:\s*inline-flex;/);
    // ledger inline disclosure/edit links ("Thiếu N thông tin", "Sửa cước
    // thu khách", "BKS Báo khách (Ảo) — sửa", "Sửa BKS thực"): 17px → 24
    const ledger = read('src/pages/ShipmentContainersPage.css');
    const toggle = ledger.match(/\.shipment-container-ledger__missing-fields-toggle\s*\{[^}]*\}/)?.[0] ?? '';
    expect(toggle, 'missing-fields toggle floor exists').not.toBe('');
    expect(toggle).toMatch(/min-height:\s*24px;/);
    expect(toggle).toMatch(/display:\s*inline-block;/);
  });

  it('SIL-583 round 3 records the pseudo hit-extension engine finding (no new no-op layers)', () => {
    // Round 3 measured on Chromium: a position:relative control with a
    // computed ::after inset of −3px fails a REAL mouse click 2px above its
    // box — painted, bordered, shadowed, all zero captures. The ::after
    // hit-extension technique is inert on this engine. Round 2 (QA verdict
    // 2026-10-30) removed the inert layers and delivers the 44px touch law
    // by REAL element growth instead; the hit area is the element border
    // box: 24px floor everywhere (WCAG 2.5.8), 44px real floor on touch
    // form factors, 40px ordinary ceiling kept for desktop fine pointers.
    const responsive = read('src/styles/responsive.css');
    expect(responsive).toMatch(/hit-area ENGINE FINDING/);
    // The finding note names the truth: real box = real hit area.
    expect(responsive).toMatch(/REAL hit area is the element border box/);
    // And the round-2 resolution is recorded next to it.
    expect(responsive).toMatch(/round 2 resolution \(QA verdict 2026-10-30/);
  });

  it('SIL-583 residuals: link-color triggers keep a DEFINED min-height fallback (QA fail 29/10: 55×13)', () => {
    // A bare `var(--uui-control-h)` is invalid-at-computed-value on triggers
    // without data-uui-control (the property is undefined in their subtree):
    // the whole max() drops and min-height silently falls to `auto` — exactly
    // how the "Xem thêm" link measured 55×13 despite the floor.
    const mpg = read('src/features/dispatch/master-plan/MasterPlanGrid.css');
    const rule = mpg.match(/\.master-plan-grid__container-detail-trigger,\s*\n\.master-plan-grid__note-detail-trigger\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(rule, 'the shared trigger rule exists').not.toBe('');
    expect(rule).toMatch(/min-height:\s*max\(28px,\s*var\(--uui-control-h,\s*28px\)\)/);
    expect(rule, 'no bare var() in a min-height — it silently voids the floor').not.toMatch(/min-height:[^;]*var\(--uui-control-h\)/g);
  });

  it('SIL-583 residuals: date segments grow the HIT box only (glyph spacing untouched)', () => {
    // HH/DD/MM segments size to their glyphs (18.6–23px) — under the 24px
    // floor. content-box padding + equal negative margins widen the measured
    // target while the content box (and card 20260924_10 separator spacing)
    // stays byte-identical. The :is(#root, body) prefix must stay: without it
    // control-geometry's id-specific rule keeps the box border-box and the
    // padding eats the glyphs instead of growing the target.
    const seg = read('src/design-system/forms/DateTimeSegments.css');
    const rule = seg.match(/:is\(#root, body\) \.date-seg-group \.date-seg-wrapper \.date-seg\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule, 'the hit-box rule exists with its load-bearing prefix').not.toBe('');
    expect(rule).toMatch(/box-sizing:\s*content-box/);
    expect(rule).toMatch(/padding-inline:\s*3px/);
    expect(rule).toMatch(/margin-inline:\s*-3px/);
  });

  it('SIL-583 residuals: combobox typing overlay hit box ≥24 in both bands', () => {
    // Base band: control-geometry zeroed the overlay (16.2px measured).
    const geometry = read('src/components/untitled-ui/base/control-geometry.css');
    const base = geometry.match(/\[data-uui-control='combobox'\] input\[role='combobox'\],\s*\n#root \[data-uui-control='combobox'\] input\[role='combobox'\] \{([^}]*)\}/)?.[1] ?? '';
    expect(base, 'base overlay rule exists').not.toBe('');
    expect(base).toMatch(/min-height:\s*24px/);
    expect(base).toMatch(/padding-block:\s*4px/);
    expect(base).toMatch(/margin-block:\s*-4px/);
    // Phone band: the #root-prefixed combobox.css override outranks the base
    // rule (id specificity) and zeroed the box back to 21.6px.
    const cb = read('src/components/untitled-ui/base/select/combobox.css');
    const phone = cb.match(/@media \(max-width: 640px\), \(pointer: coarse\) \{[\s\S]*?#root \.uui-combobox \[data-combobox-value\] input\[role='combobox'\] \{([^}]*)\}/)?.[1] ?? '';
    expect(phone, 'phone overlay override exists').not.toBe('');
    expect(phone).toMatch(/min-height:\s*24px/);
    expect(phone).toMatch(/padding-block:\s*4px/);
    expect(phone).toMatch(/margin-block:\s*-4px/);
    expect(phone, 'the fill-the-field height stays').toContain('height: 100%');
  });

  it('SIL-583 residuals: dispatch sort label button floors at 24px (was 14.8px)', () => {
    const dpg = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    const sort = dpg.match(/\.detailed-plan-grid__sort \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(sort).toMatch(/min-height:\s*24px/);
  });
});
