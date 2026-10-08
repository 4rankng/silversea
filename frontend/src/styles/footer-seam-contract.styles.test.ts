import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20261004_330 — class sweep of the popover/footer seam law (card 20261004_322,
// docs/design-guidelines.md "Popover footers hug their content (cards 20261004_322,
// 20261004_330)"): the gap between the last content block and a footer/action
// row is a seam, not whitespace — `margin-top ≤ 4px` + `padding-top ≤ 8px`
// (~13px visual), with a hairline `border-top` as the separator. No filling
// spacer, no auto-margin stretch.
//
// Pre-fix HEAD (581309b6):
//   .month-picker__footer      margin-top 10 + padding 10px 2px 0  = 20px seam
//   .users-mobile-card__actions margin-top 10 + padding-top 10     = 20px seam
//   .trip-hero__actions        margin-top 4 + padding-top 14       = 18px seam
//                              (plus a DEAD `padding-top: 4px` earlier in the
//                              same block, shadowed by the later 14px)
// The hairlines each rule already carries keep their separator role, so the
// seam shrinks to the .modal__foot rhythm and nothing else changes.
//
// Card 20261004_332 deleted the `.users-mobile-card__actions` and
// `.trip-hero__actions` rules outright (zero TSX renderers, including the
// responsive.css phone-band override) together with this file's pins for them.
// `.month-picker__footer` is the remaining live pin. Declarations are pinned
// here; the browser seam measurement is the lead's render rung.

function read(relativePath: string) {
  const direct = resolve(process.cwd(), relativePath);
  if (existsSync(direct)) return readFileSync(direct, 'utf8');
  return readFileSync(resolve(process.cwd(), 'frontend', relativePath), 'utf8');
}

const topbarCss = read('src/components/layout/topbar.css');

const ruleBodies = (source: string): Array<{ selector: string; body: string }> =>
  [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().split('\n').pop()!.trim(),
    body: m[2],
  }));

// Parsed declaration map: keys are the property names the rule actually
// declares (exact match, so `padding` never shadows `padding-top`). A repeated
// property keeps the LAST declaration — CSS cascade inside one block.
function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(';')) {
    const [prop, ...rest] = part.split(':');
    if (rest.length === 0) continue;
    out[prop.trim().toLowerCase()] = rest.join(':').trim();
  }
  return out;
}

function px(value: string | undefined, label: string): number {
  const matched = value?.match(/^(\d+(?:\.\d+)?)px$/);
  expect(matched, `${label}: expected a px length, got ${value ?? '<absent>'}`).toBeTruthy();
  return Number(matched![1]);
}

// CSS 1–4 component shorthand: the first component is always the top edge.
function effectiveTop(d: Record<string, string>, long: 'margin-top' | 'padding-top', shorthand: 'margin' | 'padding'): number | undefined {
  const explicit = d[long];
  const short = d[shorthand];
  const value = explicit ?? (short ? short.trim().split(/\s+/)[0] : undefined);
  return value === undefined ? undefined : px(value, `${long} (effective)`);
}

const topbarRules = ruleBodies(topbarCss);

const monthFooter = topbarRules.find((rule) => rule.selector === '.month-picker__footer');

// One shared seam assertion per surface (AC1): the footer/action row follows
// its content directly — margin-top ≤ 4px, padding-top ≤ 8px — and keeps its
// hairline border-top as the separator.
function expectGluedSeam(rule: { selector: string; body: string } | undefined, file: string) {
  expect(rule, `${file}: rule missing`).toBeTruthy();
  const seam = decls(rule!.body);
  const margin = effectiveTop(seam, 'margin-top', 'margin');
  const padding = effectiveTop(seam, 'padding-top', 'padding');
  expect(margin, `${rule!.selector} margin-top`).toBeLessThanOrEqual(4);
  expect(padding, `${rule!.selector} padding-top`).toBeLessThanOrEqual(8);
  expect(rule!.body, `${rule!.selector} keeps its hairline separator`).toMatch(/border-top:\s*1px\b/);
}

describe('popover/action-row seams hug their content (card 20261004_330)', () => {
  it('month picker footer: margin-top ≤ 4px, padding-top ≤ 8px, hairline kept', () => {
    // 20px seam in the month popover (margin 10 + padding 10) — instance 1.
    expectGluedSeam(monthFooter, 'src/components/layout/topbar.css');
  });
});

// ---------------------------------------------------------------------------
// Card 20261004_334 — residual batch: the over-ceiling seams card 330's AC4
// mechanical sweep left behind (qa/2026-10-04_330_ac4-class-sweep.txt, seams
// 14–20px). LIVE instances (real TSX renderers) clamp to the same ceiling —
// `margin-top ≤ 4px` + `padding-top ≤ 8px` — and keep their hairline where one
// existed. DEAD selectors (no TSX render anywhere) belong to card 332's
// delete-vs-wire sweep and are deliberately NOT pinned here:
// `.ancillary-fee-card__actions` (Table.css),
// `.as-page .as-mcard__actions` (AdminAdvanceSettlementsPage.css),
// `.credit-override-queue__toolbar` (CreditOverrideQueuePage.css),
// `.trip-list-page .table-foot` (table-extras.css) — plus the phone-band
// `.trip-hero__actions` override already deleted by card 332.
//
// Red-first: every fixed row below failed at pre-fix HEAD (each named rule
// carried its over-ceiling margin/padding) before the clamps landed. An absent
// declaration counts as 0 — a row may carry its seam in margin only, padding
// only, or neither — and a bare `0` is a legal "no seam component".
// ---------------------------------------------------------------------------

const residualSources: Record<string, string> = {
  'src/pages/ForwarderSettlementsPage.css': read('src/pages/ForwarderSettlementsPage.css'),
  'src/pages/LoginPage.css': read('src/pages/LoginPage.css'),
  'src/pages/ForwarderAdvancesPage.css': read('src/pages/ForwarderAdvancesPage.css'),
  'src/pages/config/config-page.css': read('src/pages/config/config-page.css'),
  'src/components/trip/ContainerInstancesCard.css': read('src/components/trip/ContainerInstancesCard.css'),
  'src/pages/TruckTiresPage.css': read('src/pages/TruckTiresPage.css'),
  'src/pages/penalty/violation-types.css': read('src/pages/penalty/violation-types.css'),
  'src/components/billing/BillingDocumentBuilder.css': read('src/components/billing/BillingDocumentBuilder.css'),
  'src/components/layout/sidebar.css': read('src/components/layout/sidebar.css'),
  'src/components/trip/ActionBar.css': read('src/components/trip/ActionBar.css'),
  'src/pages/SettlementPrintPage.css': read('src/pages/SettlementPrintPage.css'),
  'src/pages/TripEditPage.css': read('src/pages/TripEditPage.css'),
};

function seamTop(body: string, long: 'margin-top' | 'padding-top', shorthand: 'margin' | 'padding'): number {
  const d = decls(body);
  const explicit = d[long];
  const short = d[shorthand];
  const value = explicit ?? (short ? short.trim().split(/\s+/)[0] : undefined);
  if (value === undefined) return 0;
  if (/^0(?:\.0+)?$/.test(value)) return 0;
  return px(value, `${long} (effective)`);
}

type ResidualRow = {
  file: string;
  selector: string;
  nth: number; // occurrence index among rules with this exact selector (@media children count in file order)
  hairline?: RegExp; // separator the fixed rule must keep
  allowMissing?: boolean; // composed guard: an absent rule passes
  note: string;
};

const residualRows: Array<ResidualRow & { rules: Array<{ selector: string; body: string }> }> = (
  [
    { file: 'src/pages/ForwarderSettlementsPage.css', selector: '.fset-card__footer', nth: 0, hairline: /border-top:\s*1px\b/, note: 'checker/approver footer 14px → ≤12px' },
    { file: 'src/pages/ForwarderSettlementsPage.css', selector: '.fset-form-actions', nth: 0, hairline: /border-top:\s*1px\b/, note: 'settlement create form actions 20px → ≤12px' },
    { file: 'src/pages/LoginPage.css', selector: '.login-footer', nth: 0, hairline: /border-top:\s*1px\b/, note: 'login footer 20px → ≤12px' },
    { file: 'src/pages/LoginPage.css', selector: '.login-footer', nth: 1, note: 'login footer phone band 16px → ≤12px (safe-area bottom kept)' },
    { file: 'src/pages/ForwarderAdvancesPage.css', selector: '.fadv-form-panel__actions', nth: 0, note: 'advance form panel actions 18px → ≤12px' },
    { file: 'src/pages/config/config-page.css', selector: '.cfg-page .cfg-form-actions', nth: 0, note: 'config form actions 18px → ≤12px' },
    { file: 'src/pages/config/config-page.css', selector: '.cfg-page--company-info .cfg-form-actions', nth: 0, allowMissing: true, note: 'composed guard: company-info override must not re-inflate the seam' },
    { file: 'src/components/trip/ContainerInstancesCard.css', selector: '.ci-editor__footer', nth: 0, note: 'container-instance editor footer 16px → ≤12px' },
    { file: 'src/pages/TruckTiresPage.css', selector: '.ttp-dialog-actions', nth: 0, note: 'tire dialog actions 16px → ≤12px' },
    { file: 'src/pages/penalty/violation-types.css', selector: '.penalty-empty-actions', nth: 0, note: 'penalty empty-state actions 16px → ≤12px' },
    { file: 'src/components/billing/BillingDocumentBuilder.css', selector: '.billing-builder__footer', nth: 0, hairline: /border-top:\s*1px\b/, note: 'billing builder footer 14px → ≤12px' },
    { file: 'src/components/layout/sidebar.css', selector: '.sidebar-footer', nth: 0, hairline: /border-top:\s*1px\b/, note: 'sidebar footer 14px → ≤12px' },
    { file: 'src/components/trip/ActionBar.css', selector: '.tc-action-bar', nth: 0, hairline: /border-top:\s*1px\b/, note: 'trip create sticky action bar 14px → ≤12px' },
    { file: 'src/pages/SettlementPrintPage.css', selector: '.settlement-expense-actions', nth: 0, note: 'settlement expense actions 14px → ≤12px' },
    { file: 'src/pages/TripEditPage.css', selector: '.tc-rail-actions', nth: 0, hairline: /border(?:-top)?:\s*1px\b/, note: 'trip edit rail action card 14px → ≤12px (sides/bottom padding kept)' },
  ] as ResidualRow[]
).map((row) => ({
  ...row,
  rules: ruleBodies(residualSources[row.file]).filter((rule) => rule.selector === row.selector),
}));

describe('residual action-row seams hug their content (card 20261004_334)', () => {
  for (const row of residualRows) {
    const where = `${row.selector} @ ${row.file} #${row.nth}`;

    it(`${where}: ${row.note}`, () => {
      const rule = row.rules[row.nth];
      if (row.allowMissing && !rule) return;
      expect(rule, `${where}: rule missing`).toBeTruthy();
      expect(seamTop(rule!.body, 'margin-top', 'margin'), `${where} margin-top`).toBeLessThanOrEqual(4);
      expect(seamTop(rule!.body, 'padding-top', 'padding'), `${where} padding-top`).toBeLessThanOrEqual(8);
      if (row.hairline) expect(rule!.body, `${where} keeps its hairline separator`).toMatch(row.hairline);
    });

    it(`${where}: no rule of this selector exceeds the 12px seam ceiling`, () => {
      for (const [index, rule] of row.rules.entries()) {
        const seam = seamTop(rule.body, 'margin-top', 'margin') + seamTop(rule.body, 'padding-top', 'padding');
        expect(seam, `${row.selector} @ ${row.file} #${index} seam`).toBeLessThanOrEqual(12);
      }
    });
  }
});
