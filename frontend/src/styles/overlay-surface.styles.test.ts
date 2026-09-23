import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260922_36 (nepocorp F4, law book §3): every floating overlay surface —
// dialog, modal, popover, dropdown, tooltip, toast, drawer, picker popup, sheet,
// row-action menu — renders on the `--surface` token. In a flat UI the white
// fill is the only elevation cue, so an overlay is NEVER raw white
// (#fff/#ffffff/white/white-rgb), NEVER a canvas or alias fill (--bg*, and the
// white alias --bg-2), and NEVER an undefined alias whose fallback fires raw
// white (var(--surface-1, #fff) renders #fff — the token does not exist).
// `var(--surface, #fff)` IS compliant: it falls back to the same white and the
// repo pins that exact form (bottom-nav.styles.test.ts). Assertions are
// rule-local, house pattern — see table-no-truncation.styles.test.ts.
//
// Scope-exclusions are EXACT and each names its carrying lane + date. No
// blanket disables.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const ruleBodies = (css: string): Array<{ selector: string; body: string }> =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().split('\n').pop()!.trim(),
    body: m[2],
  }));

const OVERLAY_LAYER =
  /popover|dropdown|menu|modal|dialog|tooltip|toast|drawer|picker|palette|sheet|popup/i;
const RAW_WHITE = /^#f{3}(?:f{3})?$|^white$|^rgba?\(\s*255\b/i;
const ALIAS_FILL = /var\(\s*--(?:bg[\w-]*|surface-1\b|surface-white\b|background-color)/i;

// Overlay-layer CSS hosts in this card's scope. Comment = what floats there.
const CSS_SCOPE = [
  'src/components/ConfirmDialog.css', // confirm modal surface
  'src/components/Modal.css', // modal surface + polished variant
  'src/components/Drawer.css', // drawer surface
  'src/components/Table.css', // .fee-action-dropdown floating menu
  'src/components/UI.css', // shared UI primitives (checkbox, overlays)
  'src/components/shared/Toast.css', // toast surface
  'src/components/layout/topbar.css', // .month-picker popover
  'src/components/layout/sidebar.css', // .rail-tooltip, user dropdown
  'src/components/shipment/CarrierAllocationDialog.css', // allocation dialog
  'src/components/untitled-ui/base/select/combobox.css', // combobox popover
  'src/components/billing/BillingDocumentBuilder.css', // dialog-hosted builder
  'src/design-system/forms/DateTimePickerPanels.css', // .dtp-popover / .dtp-dialog
  'src/design-system/forms/TimePickerSurface.css', // time picker popup/sheet
  'src/design-system/forms/DatePickerSurface.css', // .date-picker__popup
  'src/design-system/forms/SearchableSelect.css', // .searchable-select__popover
  'src/features/ops/ops-modal.css', // ops modal surface
  'src/features/dispatch/master-plan/DispatchAllocationPopover.css', // allocation popover
  'src/pages/clerk/ClerkShipmentCreatePage.css', // .csc-customer-popover
];

// Overlay hosts whose floating surface is an inline style or Tailwind class.
const TSX_SCOPE = [
  'src/components/SearchDropdown.tsx', // topbar search results dropdown
  'src/components/charts/RevenueTrendChart.tsx', // HTML chart tooltip
  'src/components/shared/CommandPalette.tsx', // command palette
  'src/components/shared/Tooltip.tsx', // shared tooltip
  'src/components/layout/MobileAccountSheet.tsx', // mobile bottom sheet
  'src/components/UI/DropdownMenu/DropdownMenu.tsx', // radix dropdown surface
  'src/components/UI/Select/Select.tsx', // radix select surface
  'src/components/untitled-ui/base/select/popover.tsx', // uui select popover
  'src/components/untitled-ui/base/select/multi-select.tsx', // uui multi popover
  'src/components/untitled-ui/application/modals/modal.tsx', // uui modal surface
  'src/features/users/components/UserTable.tsx', // row-action menu
  'src/features/dispatch/components/ReassignDialog.tsx', // reassign dialog
  'src/pages/SupplierListPage.tsx', // row-action menu (fill landed in a8c84bea mixed-hunk carry)
  'src/pages/CustomersPage.tsx', // row-action menu (fill carried by lead, landed d142ae3d)
  'src/pages/config/CustomersConfigPage.tsx', // row-action menu
  'src/pages/config/RoutesConfigPage.tsx', // row-action menu
  'src/pages/accounting/AccountingDebitClosePage.tsx', // floating popover
  'src/pages/PayableDetailPage.tsx', // export menu (§3 flat-contract sweep)
];

// Files with overlay raw-white offenders that this card must NOT edit.
const EXCLUDED: Array<{ file: string; lane: string; date: string }> = [
  // CustomersPage.tsx exclusion retired 2026-09-22: its fill fix (d142ae3d)
  // landed, so it moved INTO scope (TSX_SCOPE/TSX_SURFACES).
  // SupplierListPage.tsx exclusion never needed: its fill hunk landed inside
  // 20260922_36's sweep (a8c84bea, mixed-hunk carry) and the 20260922_40
  // carrying landing brings the file to full coherence — registered normally.
  // WIP uncommitted ContainerDialog lane churn — scanned only at its landing.
  { file: 'src/pages/ShipmentsPage.tsx', lane: 'ContainerDialog lane', date: '2026-09-22' },
  { file: 'src/pages/ShipmentsPage.css', lane: 'ContainerDialog lane', date: '2026-09-22' },
  { file: 'src/pages/ShipmentContainersPage.tsx', lane: 'ContainerDialog lane', date: '2026-09-22' },
  { file: 'src/pages/ShipmentContainersPage.css', lane: 'ContainerDialog lane', date: '2026-09-22' },
];

// Floating SURFACES that must carry `background: var(--surface` (plain or with
// the compliant #fff fallback). Selector = last line of the rule's selector list.
const CSS_SURFACES: Array<[string, RegExp]> = [
  ['src/components/ConfirmDialog.css', /^\.confirm-box$/],
  ['src/components/Modal.css', /^\.modal__content$/],
  ['src/components/Modal.css', /^\.modal--polished \.modal__content$/],
  ['src/components/Drawer.css', /^\.drawer$/],
  ['src/components/Table.css', /^\.fee-action-dropdown$/],
  ['src/components/shared/Toast.css', /^\.toast$/],
  ['src/components/layout/topbar.css', /^\.month-picker$/],
  ['src/components/layout/sidebar.css', /^\.rail-tooltip$/],
  ['src/components/shipment/CarrierAllocationDialog.css', /^\.carrier-allocation-dialog__row$/],
  ['src/components/shipment/CarrierAllocationDialog.css', /^\.carrier-allocation-dialog__footer$/],
  ['src/components/billing/BillingDocumentBuilder.css', /^\.billing-builder__topbar$/],
  ['src/design-system/forms/DateTimePickerPanels.css', /^\.dtp-popover$/],
  ['src/design-system/forms/DateTimePickerPanels.css', /^\.dtp-time__exact > input$/],
  ['src/design-system/forms/TimePickerSurface.css', /^\.time-picker__popup,\s*\.time-picker__dialog$/],
  ['src/design-system/forms/TimePickerSurface.css', /^\.time-picker__sheet$/],
  ['src/design-system/forms/DatePickerSurface.css', /^\.date-picker__popup$/],
  ['src/design-system/forms/SearchableSelect.css', /^\.searchable-select__popover$/],
  ['src/features/ops/ops-modal.css', /^\.ops-modal$/],
  ['src/features/dispatch/master-plan/DispatchAllocationPopover.css', /^\.dispatch-allocation-popover$/],
  ['src/pages/clerk/ClerkShipmentCreatePage.css', /^\.csc-customer-popover$/],
];

// TSX overlay sites: the literal each floating surface must carry.
const TSX_SURFACES: Array<[string, RegExp]> = [
  ['src/components/SearchDropdown.tsx', /background: 'var\(--surface\)'/],
  ['src/components/charts/RevenueTrendChart.tsx', /background: 'var\(--surface\)'/],
  ['src/components/UI/DropdownMenu/DropdownMenu.tsx', /bg-\[var\(--surface\)\]/],
  ['src/components/UI/Select/Select.tsx', /bg-\[var\(--surface\)\]/],
  ['src/components/untitled-ui/base/select/popover.tsx', /bg-\[var\(--surface\)\]/],
  ['src/components/untitled-ui/base/select/multi-select.tsx', /bg-\[var\(--surface\)\]/],
  ['src/components/untitled-ui/application/modals/modal.tsx', /bg-\[var\(--surface\)\]/],
  ['src/features/users/components/UserTable.tsx', /background: 'var\(--surface\)'/],
  ['src/pages/CustomersPage.tsx', /background: 'var\(--surface\)'/],
  ['src/pages/config/CustomersConfigPage.tsx', /background: 'var\(--surface\)'/],
  ['src/pages/SupplierListPage.tsx', /background: 'var\(--surface\)'/],
  ['src/pages/config/RoutesConfigPage.tsx', /background: 'var\(--surface\)'/],
  ['src/pages/accounting/AccountingDebitClosePage.tsx', /background: 'var\(--surface/],
];

describe('floating overlays ride the --surface token (card 20260922_36, F4)', () => {
  it('overlay-layer CSS rules never paint raw white or alias fills', () => {
    const violations: string[] = [];
    for (const file of CSS_SCOPE) {
      for (const { selector, body } of ruleBodies(read(file))) {
        if (!OVERLAY_LAYER.test(selector)) continue;
        for (const value of [...body.matchAll(/background(?:-color)?\s*:\s*([^;}]*)/gi)].map((m) => m[1].trim())) {
          if (RAW_WHITE.test(value)) violations.push(`${file} · ${selector} · background: ${value}`);
          if (ALIAS_FILL.test(value)) violations.push(`${file} · ${selector} · background: ${value}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('dialog-hosted billing builder carries no raw-white backgrounds at all', () => {
    const violations: string[] = [];
    for (const { selector, body } of ruleBodies(read('src/components/billing/BillingDocumentBuilder.css'))) {
      for (const value of [...body.matchAll(/background(?:-color)?\s*:\s*([^;}]*)/gi)].map((m) => m[1].trim())) {
        if (RAW_WHITE.test(value)) violations.push(`BillingDocumentBuilder.css · ${selector} · background: ${value}`);
      }
    }
    const tsx = read('src/components/billing/BillingDocumentBuilder.tsx');
    if (/background(?:Color)?:\s*['"]#f{3}(?:f{3})?['"]/.test(tsx)) violations.push('BillingDocumentBuilder.tsx · raw-white inline background');
    expect(violations).toEqual([]);
  });

  it('every registered floating surface fills with var(--surface', () => {
    const violations: string[] = [];
    for (const [file, selectorRe] of CSS_SURFACES) {
      const matches = ruleBodies(read(file)).filter((r) => selectorRe.test(r.selector));
      if (matches.length === 0) violations.push(`${file} · no rule matches ${selectorRe}`);
      else if (!matches.some((r) => /background:\s*var\(--surface/.test(r.body)))
        violations.push(`${file} · ${matches[0].selector} · expected background: var(--surface…`);
    }
    expect(violations).toEqual([]);
  });

  it('TSX overlay surfaces use the --surface token (inline or Tailwind arbitrary)', () => {
    const violations: string[] = [];
    for (const [file, mustMatch] of TSX_SURFACES) {
      if (!mustMatch.test(read(file))) violations.push(`${file} · missing ${mustMatch}`);
    }
    expect(violations).toEqual([]);
  });

  it('TSX overlay files carry no raw-white or canvas-alias backgrounds', () => {
    const violations: string[] = [];
    for (const file of TSX_SCOPE) {
      const src = read(file);
      for (const m of src.matchAll(/background(?:Color)?:\s*([^,}\n]*)/g)) {
        const value = m[1];
        if (/['"]#f{3}(?:f{3})?['"]|['"]white['"]|rgba?\(\s*255/.test(value))
          violations.push(`${file} · background: ${value.trim()}`);
        if (/var\(--bg/.test(value)) violations.push(`${file} · background: ${value.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('untitled-ui floating surfaces no longer ride the raw-white bg-primary class', () => {
    // bg-primary on buttons/inputs (a control fill) is out of card scope — only
    // the floating surface class lists are pinned here.
    expect(read('src/components/untitled-ui/base/select/popover.tsx')).not.toContain('border-secondary bg-primary');
    expect(read('src/components/untitled-ui/base/select/multi-select.tsx')).not.toContain('border-secondary bg-primary');
    expect(read('src/components/untitled-ui/application/modals/modal.tsx')).not.toContain('rounded-xl bg-primary');
  });

  it('every scope-exclusion names its carrying lane and date', () => {
    expect(EXCLUDED.length).toBeGreaterThan(0);
    for (const entry of EXCLUDED) {
      expect(entry.lane.length).toBeGreaterThan(0);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('overlay layers carry no ad-hoc elevation shadows (§3 flat contract)', () => {
    // Elevation comes from the surface ladder + the 1px border, never a
    // shadow. Allowed forms: `none`, the approved --sh-* tokens (the shell
    // pins them all to none), and ring-form shadows — focus/pulse/inset
    // indicators (`0 0 0 …`), which are not elevation.
    const allowed = (value: string): boolean =>
      value === 'none'
      || /^var\(--sh-[a-z-]+\)/.test(value)
      || /^(inset\s+)?0 0 0\b/.test(value);
    const violations: string[] = [];
    for (const file of CSS_SCOPE) {
      for (const { selector, body } of ruleBodies(read(file))) {
        if (!OVERLAY_LAYER.test(selector)) continue;
        for (const value of [...body.matchAll(/box-shadow\s*:\s*([^;}]*)/gi)].map((m) => m[1].trim())) {
          if (!allowed(value)) violations.push(`${file} · ${selector} · box-shadow: ${value}`);
        }
      }
    }
    for (const file of TSX_SCOPE) {
      const src = read(file);
      for (const m of src.matchAll(/boxShadow:\s*['"`]([^'"`]+)['"`]/g)) {
        const value = m[1].trim();
        if (!allowed(value)) violations.push(`${file} · boxShadow: '${value}'`);
      }
    }
    expect(violations).toEqual([]);
  });
});
