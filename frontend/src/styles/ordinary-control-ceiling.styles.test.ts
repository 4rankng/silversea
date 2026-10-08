import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// These are ordinary control owners, not table rows, photo/media slots or
// multiline/composite records. A shell minimum cannot enforce their ceiling.
const ordinaryOwners: Record<string, string[]> = {
  "src/features/shipments/create/ShipmentContainerCell.css": [".csc-container-cell__value", ".csc-container-cell__editor"],
  "src/components/trip/DriverContainerCard.css": [".dcc-bento__edit-btn,\n  .dcc-photo-remove"],
  "src/features/accounting/AccountingWorkInbox.css": [
    ".accounting-work-inbox__lane > header button"
  ],
  "src/features/suppliers/SupplierCarrierTrucks.css": [
    ".supplier-carrier-trucks__add input,\n  .supplier-carrier-trucks__add .btn"
  ],
  "src/features/dispatch/master-plan/DispatchAllocationPopover.css": [
    ".dispatch-allocation-popover__remove",
    ".dispatch-allocation-popover__add",
    ".dispatch-allocation-popover__actions > *"
  ],
  "src/features/dispatch/master-plan/MasterPlanGrid.css": [
    ".master-plan-grid__container-detail-trigger,\n  .master-plan-grid__note-detail-trigger",
    ".master-plan-grid__allocation-trigger",
    ".master-plan-grid__notes-trigger"
  ],
  "src/features/dispatch/detailed-plan/DetailedPlanGrid.css": [
    ".detailed-plan-grid__note-action",
    ".detailed-plan-grid__note-action--icon"
  ],
  "src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css": [
    ".dispatch-assignment-dialog__notes-tag,\n  .dispatch-assignment-dialog__notes-manage-btn,\n  .dispatch-assignment-dialog__notes-add-row input,\n  .dispatch-assignment-dialog__notes-add-row button,\n  .dispatch-tag-manager button,\n  .dispatch-tag-manager input"
  ],
  "src/features/recoverable-costs/RecoverableCostsWorkspace.css": [
    ".recoverable-costs__record>.btn"
  ],
  "src/features/users/users.css": [
    ".users-table-panel .table-sort-button",
    ".users-admin-page .btn-page",
    ".icon-input",
    ".pw-toggle",
    ".drawer:has(.users-form-cards) .input,\n  .drawer:has(.users-form-cards) select.input",
    ".kebab-btn",
    ".users-mobile-card__dropdown button",
    ".users-customer-scope__search",
    ".users-customer-scope__search input"
  ],
  "src/components/layout/topbar.css": [
    ".month-picker__cell"
  ],
  "src/components/layout/bottom-nav.css": [
    ".bottom-nav-item",
    ".mobile-user-sheet-close",
    ".mobile-user-sheet-btn"
  ],
  "src/components/layout/app-shell.css": [
    ".skip-link"
  ],
  "src/components/layout/sidebar.css": [
    ".sidebar-section-toggle",
    ".sidebar-item",
    ".sidebar-user-dropdown-item"
  ],
  "src/components/shared/Banner.css": [
    ".nepo-banner__close"
  ],
  "src/components/shared/Toast.css": [
    ".toast__close"
  ],
  "src/components/shipment/CarrierAllocationDialog.css": [
    ".carrier-allocation-dialog__remove",
    ".carrier-allocation-dialog__add"
  ],
  "src/pages/TruckTiresPage.css": [
    ".ttp-position-picker-manage"
  ],
  "src/pages/ForwarderTripDetailPage.css": [
    ".fwd-expense-action",
    ".fwd-expense-group__header .btn"
  ],
  "src/pages/DebtDetailPage.css": [
    ".dd-back",
    ".debt-detail-page .dd-back",
    ".debt-detail-page .dd-actions .btn"
  ],
  "src/pages/AdvanceWorkspacePage.css": [
    ".advance-workspace__governance-link"
  ],
  "src/pages/WorkflowFinance.css": [
    ".shipment-coordination__head .btn",
    ".workflow-pagination .btn"
  ],
  "src/pages/ShipmentsPage.css": [
    ".cus-quick-edit-modal__fields input:not([data-uui-control] > input),\n  .cus-quick-edit-modal__fields select",
    ".cus-quick-edit-modal__fields .ds-uui-select button",
    ".cus-quick-edit-modal__action",
    ".cus-container-table .cus-container-row__remove",
    ".cus-drawer-primary-action",
    ".cus-container-table .cus-container-cell input,\n  .cus-container-table .cus-container-cell .searchable-select__trigger",
    ".cus-container-edit-action"
  ],
  "src/pages/ShipmentContainersPage.css": [
    ".shipment-container-ledger__schedule-pill,\n  .shipment-container-ledger__schedule-time-pill",
    ".shipment-container-ledger__edit-action",
    ".shipment-container-ledger__schedule-clear",
    ".shipment-container-ledger__plate-clear button"
  ],
  "src/pages/ForwarderAdvancesPage.css": [
    ".fadv-form-panel__fields input",
    ".fadv-form-panel__close",
    ".fadv-form-panel__actions .btn"
  ],
  "src/pages/DashboardPage.css": [
    ".dash-wf .wf-minibtn",
    ".dash-wf .wf-banner-action"
  ],
  "src/pages/FleetPage.css": [
    ".fleet-page .page-actions .btn"
  ],
  "src/pages/FinancePage.css": [
    ".truck-row-toggle",
    ".dash-wf .wf-chart-toggle__btn"
  ],
  "src/pages/PayableListPage.css": [
    ".payables-page .page-actions .btn",
    ".commission-form .input"
  ],
  "src/pages/ShipmentDebitPage.css": [
    ".shipment-debit-row__expand-button"
  ],
  "src/pages/SettlementPrintPage.css": [
    ".settlement-expense-editor__actions .btn",
    ".settlement-expense-actions .btn"
  ],
  "src/pages/ShipmentDetailPage.css": [
    ".shipment-pod-review__action",
    ".shipment-pod-review__complete-button",
    ".shipment-pod-review__vat-field select"
  ],
  "src/pages/TripForm.css": [
    ".tc-back-btn"
  ],
  "src/pages/portal/PortalPages.css": [
    ".portal-back",
    ".portal-button",
    ".portal-timeline .portal-button"
  ],
  "src/pages/trip-detail/responsive.css": [
    ".td-page-head .header-actions .btn",
    ".td-page-head .header-actions .btn--danger"
  ],
  "src/pages/trip-list/responsive.css": [
    ".trip-list-page .quick-edit-toolbar__main .btn",
    ".trip-list-page .hero-actions .btn"
  ],
  "src/pages/trip-list/table.css": [
    ".trip-list-page .trip-copy-btn",
    ".trip-list-page .quick-money-input",
    ".trip-list-page .action-btn"
  ],
  "src/pages/trip-list/mobile-cards.css": [
    ".trip-list-page .trip-copy-btn--mobile"
  ],
  "src/pages/trip-list/table-extras.css": [
    ".trip-list-page .page-btn"
  ],
  "src/pages/config/customer-form.css": [
    ".customer-form__actions > .btn"
  ],
  "src/pages/config/customer-config-density.css": [
    ".cfg-page--customers .cfg-customer-table .row-action",
    ".cfg-customer-details > summary"
  ],
  "src/pages/config/config-page.css": [
    ".cfg-page .page-header__back-btn,\n.cfg-page .page-header [aria-label*=\"quay\" i]",
    ".company-info-comparison > summary",
    ".factory-record-details summary",
    ".cfg-secret-input__toggle",
    ".factories-table .row-action"
  ],
  "src/pages/config/RoutesConfigPage.css": [
    ".routes-config-page .routes-table .row-action"
  ],
  "src/pages/penalty/responsive.css": [
    ".penalty-row-act",
    ".penalty-chip",
    ".penalty-seg button",
    ".penalty-page .penalty-log-table .record-table__action .penalty-row-act"
  ],
  "src/pages/salary-attendance/salary-summary.css": [
    ".salary-edit-link"
  ],
  "src/pages/salary-attendance/responsive.css": [
    ".mobile-back-bar .btn"
  ],
  "src/pages/clerk/ClerkShipmentCreatePage.css": [
    ".csc-route-dialog__submit, .csc-shipping-line-dialog__submit",
    ".csc-back",
    ".csc-validation-summary button",
    ".csc-container-row__actions .csc-icon-button",
    ".csc-mode__option, .csc-flag-checkbox, .csc-add-container, .csc-container-add-control input, .csc-utility-button",
    ".csc-icon-button",
    ".csc-container-cell .csc-route-picker__add"
  ],
  "src/design-system/forms/SearchableSelect.css": [
    ".searchable-select__search"
  ],
  "src/pages/NotificationsPage.css": [
    ".notif-page__markall",
    ".notif-page__loadmore"
  ],
  "src/pages/accounting/DepositRefundTrackerPage.css": [
    ".deposit-tracker-warnings__dismiss"
  ]
};
const clean = (selector: string) => selector.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
const rules = (source: string) => [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: clean(match[1]), body: match[2] }));
const literalControlHeights = (body: string) => [...body.matchAll(/(?:^|;)\s*(?:min-)?height\s*:\s*([^;]+)(?=;|$)/g)]
  .flatMap(declaration => [...declaration[1].matchAll(/([\d.]+)px/g)].map(literal => Number(literal[1])));

describe('ordinary control owner ceiling', () => {
  for (const [path, selectors] of Object.entries(ordinaryOwners)) {
    it(`${path} keeps every ordinary owner at or below the approved ceiling`, () => {
      const cssRules = rules(readFileSync(resolve(process.cwd(), path), 'utf8'));
      for (const selector of selectors) {
        const bodies = cssRules.filter(rule => rule.selector === clean(selector)).map(rule => rule.body);
        expect(bodies.length, selector).toBeGreaterThan(0);
        for (const body of bodies) {
          for (const height of literalControlHeights(body)) {
            expect(height, `${selector}: ${body}`).toBeLessThanOrEqual(40);
          }
        }
      }
    });
  }

  it('includes terminal declarations and fallback heights without treating line-height as a control floor', () => {
    expect(literalControlHeights('line-height: 52px; min-height: 44px')).toEqual([44]);
    expect(literalControlHeights('height: 40px; min-height: var(--control-touch-h, 44px)')).toEqual([40, 44]);
    expect(literalControlHeights('line-height: 52px; padding: 0 14px')).toEqual([]);
  });

  it('keeps single-label checkbox owners compact while described records retain their content flow', () => {
    for (const [path, selector] of [
      ['src/components/trip/CheckboxCard.css', '.tc-checkbox-card:not(:has(.tc-checkbox-card__desc))'],
      ['src/features/users/users.css', '.users-customer-scope__option:not(:has(small))'],
    ]) {
      const body = rules(readFileSync(resolve(process.cwd(), path), 'utf8')).find(rule => rule.selector === selector)?.body ?? '';
      expect(body, selector).toContain('min-height: var(--control-max-h)');
      expect(body, selector).toContain('padding-block: 0');
      expect(body, selector).toContain('box-sizing: border-box');
      expect(body, selector).not.toMatch(/(?:max-)?height:\s*\d+px|overflow:|text-overflow:|white-space:\s*nowrap/);
    }
    const card = rules(readFileSync(resolve(process.cwd(), 'src/components/trip/CheckboxCard.css'), 'utf8')).find(rule => rule.selector === '.tc-checkbox-card')?.body ?? '';
    expect(card).toContain('min-height: 48px');
    expect(card).not.toMatch(/max-height|overflow:|text-overflow/);
  });

  it('keeps every supported licensed close-button size within the ceiling', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/untitled-ui/base/buttons/close-button.tsx'), 'utf8');
    expect(source).not.toContain('root: "size-11"');
    expect(source).toContain('lg: { root: "size-10"');
  });

  it('keeps the dormant legacy OPS search alias on the house control budget', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ForwarderTripsPage.css'), 'utf8');
    const aliases = [...css.matchAll(/--ops-control-height:\s*([^;]+);/g)].map(match => match[1]);
    expect(aliases).toEqual(['var(--control-max-h)', 'var(--control-max-h)']);
  });

  it('budgets ordinary label actions without clipping their text', () => {
    const notifications = rules(readFileSync(resolve(process.cwd(), 'src/pages/NotificationsPage.css'), 'utf8'));
    const loadMore = notifications.find(rule => rule.selector === '.notif-page__loadmore')?.body ?? '';
    expect(loadMore).toContain('min-height: var(--control-max-h)');
    expect(loadMore).toContain('padding: 0 16px');
    expect(loadMore).not.toMatch(/max-height|overflow:\s*hidden|text-overflow/);
    const navigation = rules(readFileSync(resolve(process.cwd(), 'src/components/layout/bottom-nav.css'), 'utf8'));
    expect(navigation.find(rule => rule.selector === '.bottom-nav-icon-wrap')?.body).toContain('padding: 0;');
    expect(navigation.find(rule => rule.selector === '.bottom-nav-item')?.body).toContain('padding-block: 0;');
  });

  it('budgets supported large licensed buttons and nested search/user input borders at their owners', () => {
    const geometry = readFileSync(resolve(process.cwd(), 'src/components/untitled-ui/base/control-geometry.css'), 'utf8');
    expect(geometry).toMatch(/\[data-uui-control='button'\]\[data-control-size='lg'\][^{]*,[^{]*\[data-uui-control='button'\]\[data-control-size='xl'\]\s*\{[^}]*padding-block: 4px;/);
    const users = readFileSync(resolve(process.cwd(), 'src/features/users/users.css'), 'utf8');
    expect(users).toContain('height: calc(var(--control-max-h) - 3px)');
    expect(users).toContain('height: calc(var(--control-max-h) - 2px)');
    const search = readFileSync(resolve(process.cwd(), 'src/design-system/forms/SearchableSelect.css'), 'utf8');
    expect(search).toContain('height: calc(var(--control-max-h) - 1px)');
    expect(search).toMatch(/\.searchable-select__search\s*\{[^}]*padding: 0 12px;/);
  });
});
