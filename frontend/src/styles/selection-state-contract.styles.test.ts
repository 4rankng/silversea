import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('selection-state contract', () => {
  it('uses neutral ink structure instead of semantic colour for explicit selections', () => {
    expect(read('src/pages/salary-attendance/calendar.css')).toContain('box-shadow: inset 3px 0 0 var(--ink);');
    // Card _46 replacement surface (red census 2026-09-23 re-pin): dispatch-
    // detail's FacetMultiSelect rides the shared SearchableMultiSelect. Its
    // selected state is never color-only (PRD QuyTrinhO2C §8.3): every option
    // carries aria-selected + a conditionally-rendered check glyph (shape,
    // not hue), and the check column is a reserved structural slot in the
    // option row — nepocorp's own SearchableSelect pattern, ported.
    const multiSelect = read('src/design-system/forms/SearchableMultiSelect.tsx');
    expect(multiSelect).toContain('aria-selected={isSelected}');
    expect(multiSelect).toContain("{isSelected ? <Check size={15} /> : null}");
    expect(multiSelect).toContain("searchable-select__option${isActive ? ' searchable-select__option--active' : ''}");
    expect(read('src/design-system/forms/SearchableSelect.css')).toContain('.searchable-select__check {');
    expect(read('src/features/users/users.css')).toContain('.users-customer-scope__option.is-selected {\n  background: var(--surface);\n  box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/features/app-settings/FinancePolicySection.tsx')).toContain('variant="bordered"');
    expect(read('src/design-system/Tabs.css')).toContain('.ds-tabs--bordered .ds-tabs__btn--active {\n  color: var(--ink);\n  border-bottom-color: var(--ink);\n  background: transparent;');
    expect(read('src/pages/config/config-page.css')).toContain('.cfg-provider-option.is-selected {\n  border-color: var(--ink);\n  background: var(--surface);\n  box-shadow: inset 3px 0 0 var(--ink);');
    // Token migration: `--fg-1`/`--bg-1` are defined app-wide in
    // src/styles/tokens.css, so the defensive `, #101828` / `, #fff`
    // fallbacks were dropped from the sheet. The selection contract is that
    // the state is NEUTRAL INK STRUCTURE — a 3px inset ink edge, never a
    // brand/semantic tint — so that is what stays pinned.
    expect(read('src/pages/TruckTiresPage.css')).toContain('.ttp-unmount-choice.is-active {\n  border-color: var(--fg-1);\n  background: var(--bg-1);\n  box-shadow: inset 3px 0 0 var(--fg-1);');
    expect(read('src/pages/TruckTiresPage.css')).toContain(".ttp-position-picker-option[aria-selected='true'] {\n  background: var(--surface);\n  color: var(--fg-1);\n  box-shadow: inset 3px 0 0 var(--fg-1);");
    // No semantic/brand colour may leak into either selected state.
    for (const sel of ['.ttp-unmount-choice.is-active', ".ttp-position-picker-option[aria-selected='true']"]) {
      const block = read('src/pages/TruckTiresPage.css').match(new RegExp(`${sel.replace(/[[\]']/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';
      expect(block, `${sel} exists`).not.toBe('');
      expect(block, `${sel} must not tint with brand/semantic colour`).not.toMatch(/var\(--(?:brand|accent|success|warning|danger|info)/);
    }
    // The audit ledger rides the shared record-table base: its selection edge
    // and neutral fine-pointer hover are pinned by the record-table block
    // below, so this page only has to keep the adoption classes in place.
    expect(read('src/pages/AuditLogPage.tsx')).toContain('className="record-table ops-table table-hover"');
    expect(read('src/features/recoverable-costs/RecoverableCostsWorkspace.css')).toContain('.recoverable-costs__decision-group>[role=radio][data-selected]{border-color:var(--ink,var(--fg-1));background:var(--surface,var(--bg-1));box-shadow:inset 3px 0 0 var(--ink,var(--fg-1))}');
    expect(read('src/pages/config/debit-note-template-editor.css')).toContain('.debit-editor-column-picker__card.is-active {\n  border-color: var(--ink);\n  background: var(--surface);\n  color: var(--ink);\n  box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/pages/config/debit-note-template-editor.css')).toContain('.debit-editor-align-control button.is-active {\n  background: var(--ink);\n  color: var(--surface);');
    expect(read('src/pages/config/debit-note-template-editor.css')).toContain(".debit-editor-preview__table th.is-selected::after {\n  content: '';\n  position: absolute;\n  width: 9px;\n  height: 9px;\n  border: 2px solid var(--ink);");
    expect(read('src/components/layout/topbar.css')).toContain('.month-picker__cell.is-selected {\n  background: var(--ink);\n  color: var(--surface);\n  border-color: var(--ink);');
    // The advance workspace views no longer fork the group's selected state:
    // they ride the sanctioned `bordered` variant (its ink underline is pinned
    // on design-system/Tabs.css above), per the operator ruling 2026-09-27.
    expect(read('src/pages/AdvanceWorkspacePage.tsx')).toContain('variant="bordered"');
    expect(read('src/pages/config/SalaryPeriodConfigPage.css')).toContain('.sp-mode-card.active {\n  border-color: var(--ink);\n  background: var(--surface);\n  box-shadow: inset 3px 0 0 var(--ink);');
    // Same token migration as the TruckTires pins above: `--surface`/`--ink`
    // are defined app-wide, so the `, #fff` / `, #101828` fallbacks are gone.
    // The contract is the neutral-ink TOP edge on the active portal tab.
    expect(read('src/pages/portal/CustomerPortalLayout.css')).toContain('.customer-shell__bottom-nav a.is-active {\n    background: var(--surface);\n    color: var(--ink);\n    box-shadow: inset 0 2px 0 var(--ink);');
    expect(read('src/pages/trip-list/table-extras.css')).toContain('.trip-list-page .page-btn.active { background: var(--ink);');
    expect(read('src/components/layout/bottom-nav.css')).toContain('.bottom-nav-item.active .bottom-nav-icon-wrap {\n    background: var(--surface-3);\n    color: var(--ink);');
    expect(read('src/components/layout/bottom-nav.css')).toContain('  .bottom-nav-indicator {');
    expect(read('src/components/layout/bottom-nav.css')).toContain('    background: var(--ink);');
    expect(read('src/pages/trip-list/table.css')).toContain('.trip-list-page .quick-edit-row.selected {\n  background: var(--surface);\n  box-shadow: inset 3px 0 0 var(--ink);');
    // Card 20260922_31 converted the cargo option set to the app's connected
    // segmented treatment: the selected segment is still neutral ink (filled,
    // never a brand/semantic tint) — the same recipe as the /shipments-detail
    // date presets.
    expect(read('src/pages/clerk/ClerkShipmentCreatePage.css')).toContain('.csc-mode input:checked + span { background: var(--ink); color: var(--surface); }');
    expect(read('src/pages/ShipmentContainersPage.css')).toContain('.shipments-detail-workspace .ds-pagination__btn--active { background: var(--ink); color: var(--surface); }');
    expect(read('src/design-system/Pagination.css')).toContain('.ds-pagination__btn--active {\n  background: var(--ink);\n  border-color: var(--ink);');
    expect(read('src/design-system/forms/SearchableSelect.css')).toContain('.searchable-select__option--active {\n  color: var(--ink);\n  background: var(--surface-2);');
    expect(read('src/components/trip/CheckboxCard.css')).toContain('.tc-checkbox-card--checked {\n  background: var(--surface);\n  border-color: var(--ink);\n  box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/pages/ForwarderSettlementsPage.css')).toContain('.fset-check-item--selected {\n  background: var(--surface);\n  border-color: var(--ink);\n  box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/pages/trip-list/mobile-cards.css')).toContain('.trip-list-page .trip-mcard--quick.selected {\n  border-color: var(--ink);\n  box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/pages/DebtDetailPage.css')).toContain('.dd-aging-cell--active {\n  background: var(--surface);\n  border-color: var(--ink);\n  box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/pages/DashboardPage.css')).toContain('.dash-wf .wf-chart-toggle .d-btn.is-active {\n  background: var(--ink);\n  color: var(--fg-on-brand);');
  });

  it('keeps the shared record-table base selection structural and hover neutral', () => {
    const css = read('src/styles/record-table.css');

    expect(css).toContain('.record-table tbody tr.is-selected {\n  background: var(--surface);\n  box-shadow: inset 3px 0 0 var(--ink);');
    // Hover is a quiet scan aid for fine pointers only — never a selection look.
    expect(css).toContain('@media (hover: hover) and (pointer: fine)');
    expect(css).toContain('color-mix(in srgb, var(--fg-1) 2%, var(--surface))');
    // Mobile record cards must stay labelled by their column names.
    expect(css).toContain('content: attr(data-label);');
  });

  // Card 20260929_207, completed 2026-09-30: the four remaining `data-selected`
  // row surfaces dropped their accent left border / accent fill for the shared
  // record-table recipe — a neutral surface plus the 3px inset ink edge. They
  // are pinned HERE, the contract's home, so a later page cannot re-tint a
  // selection edge into a brand colour, whichever property it reaches for.
  it('pins the data-selected row surfaces that carry the shared neutral-ink edge', () => {
    const surfaces = [
      ['src/pages/AccountingWorkspacePage.css',
        '.accounting-register__table tbody tr[data-selected] { background: var(--surface); box-shadow: inset 3px 0 0 var(--ink); }'],
      ['src/pages/accounting/PhoiPhieuControlPage.css',
        '.ppc-board tbody tr[data-selected="true"] {\n  background: var(--surface);\n  box-shadow: inset 3px 0 0 var(--ink);\n}'],
      ['src/features/expense-accounting/ExpenseAccounting.css',
        '.expense-register-table tbody tr[data-selected="true"] { background: var(--surface); box-shadow: inset 3px 0 0 var(--ink); }'],
      // The customers grid paints its zebra on the CELLS, so its neutral
      // surface rides them and the ink edge is painted on the first cell — an
      // edge on the `<tr>` would sit under those cell backgrounds and vanish.
      ['src/pages/CustomersPage.css',
        '.record-table tbody tr.customers-row[data-selected],\n.record-table tbody tr.customers-row[data-selected] td { background: var(--surface); }\n.record-table tbody tr.customers-row[data-selected] > td:first-child { box-shadow: inset 3px 0 0 var(--ink); }'],
    ] as const;
    for (const [sheet, rule] of surfaces) {
      const css = read(sheet);
      expect(css, sheet).toContain(rule);
      // The banned full-height coloured left border stays gone from these
      // sheets. The tint ban lives in the exact rule pinned above — a
      // page-owned callout rail (`.expense-accounting-notice`) is not a
      // selection state and is not this contract's business.
      expect(css, sheet).not.toMatch(/border-left:\s*[2-6]px solid/);
    }
  });

  it('keeps success and warning as forwarder workflow context when a row is selected', () => {
    const css = read('src/pages/ForwarderTripsPage.css');

    expect(css).toContain('.ops-bill-row.is-selected.is-pending { background: var(--warning-soft); }');
    expect(css).toContain('.ops-bill-row.is-selected.is-paid { background: var(--success-soft); }');
  });

  it('keeps driver selection touch-safe and exposes salary when it is visible', () => {
    // The selector chip consumes the filter density token; the compact mobile
    // contract (ticket 6770b9cb) keeps it proportional (32px, ≥28px floor).
    expect(read('src/pages/salary-attendance/calendar.css')).toContain('  min-height: var(--filter-control-h);');
    expect(read('src/styles/tokens.css')).toMatch(
      /@media \(max-width: 640px\)\s*\{[\s\S]*?--filter-control-h:\s*var\(--control-compact-h\);/,
    );
    expect(read('src/pages/SalaryAttendancePage.tsx')).toContain('aria-label={`Xem bảng công của ${d.name}${salaryLabel}`}');
  });
});
