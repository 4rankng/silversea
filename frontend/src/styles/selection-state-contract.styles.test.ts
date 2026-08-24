import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('selection-state contract', () => {
  it('uses neutral ink structure instead of semantic colour for explicit selections', () => {
    expect(read('src/pages/salary-attendance/calendar.css')).toContain('box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css')).toContain('box-shadow: inset 3px 0 0 var(--color-fg-primary, var(--text-primary, #101828));');
    expect(read('src/features/users/users.css')).toContain('.users-customer-scope__option.is-selected {\n  background: var(--surface);\n  box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/pages/config/config-page.css')).toContain('.cfg-finance-tab.is-active {\n  color: var(--ink);\n  border-color: var(--ink);\n  background: var(--surface);\n  box-shadow: inset 0 -2px 0 var(--ink);');
    expect(read('src/pages/config/config-page.css')).toContain('.cfg-provider-option.is-selected {\n  border-color: var(--ink);\n  background: var(--surface);\n  box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/pages/TruckTiresPage.css')).toContain('.ttp-unmount-choice.is-active {\n  border-color: var(--fg-1, #101828);\n  background: var(--bg-1, #fff);\n  box-shadow: inset 3px 0 0 var(--fg-1, #101828);');
    expect(read('src/pages/TruckTiresPage.css')).toContain(".ttp-position-picker-option[aria-selected='true'] {\n  background: var(--surface, #fff);\n  color: var(--fg-1, #101828);\n  box-shadow: inset 3px 0 0 var(--fg-1, #101828);");
    // The audit ledger rides the shared record-table base: its selection edge
    // and neutral fine-pointer hover are pinned by the record-table block
    // below, so this page only has to keep the adoption classes in place.
    expect(read('src/pages/AuditLogPage.tsx')).toContain('className="record-table ops-table table-hover"');
    expect(read('src/features/recoverable-costs/RecoverableCostsWorkspace.css')).toContain('.recoverable-costs__decision-group>[role=radio][data-selected]{border-color:var(--ink,var(--fg-1));background:var(--surface,var(--bg-1));box-shadow:inset 3px 0 0 var(--ink,var(--fg-1))}');
    expect(read('src/pages/config/debit-note-template-editor.css')).toContain('.debit-editor-column-picker__card.is-active {\n  border-color: var(--ink);\n  background: var(--surface);\n  color: var(--ink);\n  box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/pages/config/debit-note-template-editor.css')).toContain('.debit-editor-align-control button.is-active {\n  background: var(--ink);\n  color: var(--surface);');
    expect(read('src/pages/config/debit-note-template-editor.css')).toContain(".debit-editor-preview__table th.is-selected::after {\n  content: '';\n  position: absolute;\n  width: 9px;\n  height: 9px;\n  border: 2px solid var(--ink);");
    expect(read('src/pages/ForwarderTripDateRangePicker.css')).toContain('.ftrip-date-picker__range-tabs button.is-active { border-color: var(--fg-1); background: var(--surface); color: var(--fg-1); font-weight: 750; box-shadow: inset 3px 0 0 var(--fg-1); }');
    expect(read('src/pages/ForwarderTripDateRangePicker.css')).toContain('.ftrip-date-picker__days button.is-in-range { background: var(--surface-2); color: var(--fg-1); }');
    expect(read('src/pages/ForwarderTripDateRangePicker.css')).toContain('.ftrip-date-picker__days button.is-selected { background: var(--fg-1); color: var(--surface); font-weight: 800; }');
    expect(read('src/components/layout/topbar.css')).toContain('.month-picker__cell.is-selected {\n  background: var(--ink);\n  color: var(--surface);\n  border-color: var(--ink);');
    expect(read('src/pages/AdvanceWorkspacePage.css')).toContain('.advance-workspace__views .ds-tabs__btn--active {\n  background: var(--surface);\n  color: var(--ink);\n  border-bottom-color: var(--ink);\n  box-shadow: none;\n}');
    expect(read('src/pages/config/SalaryPeriodConfigPage.css')).toContain('.sp-mode-card.active {\n  border-color: var(--ink);\n  background: var(--surface);\n  box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/pages/portal/CustomerPortalLayout.css')).toContain('.customer-shell__bottom-nav a.is-active {\n    background: var(--surface, #fff);\n    color: var(--ink, #101828);\n    box-shadow: inset 0 2px 0 var(--ink, #101828);');
    expect(read('src/pages/trip-list/filters.css')).toContain('.trip-list-page .stab-pill.active {\n  background: var(--ink);\n  border-color: var(--ink);');
    expect(read('src/pages/trip-list/table-extras.css')).toContain('.trip-list-page .page-btn.active { background: var(--ink);');
    expect(read('src/components/layout/bottom-nav.css')).toContain('.bottom-nav-item.active .bottom-nav-icon-wrap {\n    background: var(--surface-3);\n    color: var(--ink);');
    expect(read('src/components/layout/bottom-nav.css')).toContain('  .bottom-nav-indicator {');
    expect(read('src/components/layout/bottom-nav.css')).toContain('    background: var(--ink);');
    expect(read('src/pages/trip-list/table.css')).toContain('.trip-list-page .quick-edit-row.selected {\n  background: var(--surface);\n  box-shadow: inset 3px 0 0 var(--ink);');
    expect(read('src/pages/clerk/ClerkShipmentCreatePage.css')).toContain('.csc-mode input:checked + span { border-color: var(--ink); background: var(--surface); color: var(--fg-1); box-shadow: inset 3px 0 0 var(--ink); }');
    expect(read('src/pages/ShipmentsDetailPage.css')).toContain('.shipments-detail-workspace .ds-pagination__btn--active { background: var(--ink); color: var(--surface); }');
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

  it('keeps success and warning as forwarder workflow context when a row is selected', () => {
    const css = read('src/pages/ForwarderTripsPage.css');

    expect(css).toContain('.ops-bill-row.is-selected.is-pending { background: var(--warning-soft); }');
    expect(css).toContain('.ops-bill-row.is-selected.is-paid { background: var(--success-soft); }');
  });

  it('keeps driver selection touch-safe and exposes salary when it is visible', () => {
    // The selector chip consumes the filter density token; touch safety comes
    // from the phone override that flips that token to the 44px minimum.
    expect(read('src/pages/salary-attendance/calendar.css')).toContain('  min-height: var(--filter-control-h);');
    expect(read('src/styles/tokens.css')).toMatch(
      /@media \(max-width: 767px\)\s*\{[\s\S]*?--filter-control-h:\s*var\(--control-touch-h\);/,
    );
    expect(read('src/pages/SalaryAttendancePage.tsx')).toContain('aria-label={`Xem bảng công của ${d.name}${salaryLabel}`}');
  });
});
