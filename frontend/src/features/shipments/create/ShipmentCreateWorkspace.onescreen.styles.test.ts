import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-499 — the "onescreen" wide band (≥1280px) that compresses the
 * shipment worksheet into one viewport. These pins hold the SPEC numbers
 * (ticket comment 1840: card padding 12-16, table row 48, section band 36,
 * gap 12 — fonts untouched) and the two-column structure the lane chose by
 * measurement after the ticket mockup proved unreachable (see the CSS file
 * header + testplan/cases/case-QA-2026-10-26-sil481-onescreen.md).
 */
const CSS = readFileSync(
  join(__dirname, '../../../pages/clerk/ClerkShipmentCreatePage.onescreen.css'),
  'utf8',
);
const IDENTITY = readFileSync(
  join(__dirname, 'ShipmentCreateIdentitySection.tsx'),
  'utf8',
);

describe('SIL-499 onescreen wide band', () => {
  it('scopes every rule to the existing 1280px breakpoint (no new drift width)', () => {
    const blocks = CSS.match(/@media \(min-width: 1280px\)/g) ?? [];
    expect(blocks.length, 'exactly one 1280px media block').toBe(1);
    expect(CSS, 'no other media width').not.toMatch(/@media \(min-width: (?!1280px)/);
  });

  it('worksheet is the 2-column grid; the form joins it via display: contents', () => {
    expect(CSS).toMatch(/\.csc-workspace \{ display: grid; grid-template-columns: minmax\(0, 4fr\) minmax\(0, 8fr\); gap: 12px; \}/);
    expect(CSS).toMatch(/\.csc-form \{ display: contents; \}/);
  });

  it('places every section + freight (both with and without freight preview); the action bar stays viewport-fixed', () => {
    for (const area of [
      // SIL-596: row 1 = mode + identity equal-height siblings; the strip
      // tenant of identity's old r1-r2 span is retired (SIL-521).
      '#shipment-section-mode { grid-area: 1 / 1 / 2 / 2; align-self: stretch; }',
      '#shipment-section-identity { grid-area: 1 / 2 / 2 / 3; }',
      '#shipment-section-schedule { grid-area: 3 / 1 / 4 / 3; }',
      '#shipment-section-route { grid-area: 3 / 1 / 4 / 3; }',
      '#shipment-section-cargo { grid-area: 4 / 1 / 5 / 3; }',
    ]) {
      expect(CSS, area).toContain(area);
    }
    // SIL-596: the freight card owns a FULL-width row — column 2 may never
    // sit empty beside it (§10.8.2: no orphan grid cell).
    expect(CSS).toContain('[data-freight-preview] { grid-area: 2 / 1 / 3 / 3; align-self: start; margin: 0; }');
    // SIL-510: the action bar is NOT a grid row — it is the viewport-fixed
    // footer, so the wide band places neither a grid area nor a padding
    // override on it (a comment may name it; a rule may not).
    expect(CSS).not.toMatch(/\.csc-form-actions\s*\{/);
    // Freight-absent collapse: no empty track may stay behind.
    for (const pull of [
      ':not(:has([data-freight-preview])) #shipment-section-schedule { grid-area: 2 / 1 / 3 / 3; }',
      ':not(:has([data-freight-preview])) #shipment-section-cargo { grid-area: 3 / 1 / 4 / 3; }',
    ]) {
      expect(CSS, pull).toContain(pull);
    }
  });

  it('keeps the SPEC density numbers (padding 12, worksheet gap 12, heading band 36, table row 48)', () => {
    expect(CSS).toMatch(/\.csc-workspace \{ display: grid; grid-template-columns: minmax\(0, 4fr\) minmax\(0, 8fr\); gap: 12px; \}/);
    expect(CSS).toMatch(/\.csc-section \{ padding: 12px 14px !important; gap: 8px !important; \}/);
    // 7px block padding + ~21px title line + 1px border = the 36px band.
    expect(CSS).toMatch(/\.csc-section__heading \{ margin: -12px -14px 0; padding: 7px 14px; \}/);
    expect(CSS).toMatch(/\.csc-container-table tbody th, \.csc-container-table tbody td \{ padding: 7px 6px; \}/);
  });

  it('separates the topline actions from the section band by ≥12px (SIL-509)', () => {
    // Owner ticket 26/10: the actions row sat flush on the "Nhận diện lô"
    // band at ≥1280. The SIL-499 zero-margin squeeze is superseded there.
    expect(CSS).toMatch(/\.csc-topline \{ margin-bottom: 12px; \}/);
  });

  it('never shrinks typography (SPEC: font giữ nguyên)', () => {
    expect(CSS, 'no font-size declarations in the wide band').not.toMatch(/font-size:/);
  });

  it('identity bands carry the wide-grid hooks; the card is ONE column (no dead cell)', () => {
    expect(IDENTITY).toContain('csc-identity-grid csc-identity-grid--contact');
    expect(IDENTITY).toContain('csc-identity-grid csc-identity-grid--refs');
    expect(IDENTITY).toContain('csc-identity-grid csc-identity-grid--choices');
    // SIL-596 (id 696, owner 30/10): the `3fr/2fr` template existed to host
    // the retired tờ khai strip; keeping it left a permanent ~40%-width
    // dead column beside contact/refs. The card is one full-width stack now.
    expect(CSS).not.toMatch(/#shipment-section-identity \{ grid-template-columns:/);
    for (const deadPin of [
      '.csc-identity-grid--contact { grid-column: 1; grid-row: 3; }',
      '.csc-identity-grid--refs { grid-column: 1; grid-row: 4; }',
      '.csc-identity-grid--choices { grid-column: 1 / -1; grid-row: 2; }',
    ]) {
      expect(CSS, `dead-column pin must stay retired: ${deadPin}`).not.toContain(deadPin);
    }
    // Choices chips keep their wide-band density treatment.
    expect(CSS).toMatch(/\.csc-identity-grid--choices \.csc-identity-grid__flags-row \{ flex-wrap: nowrap; \}/);
    expect(CSS).toMatch(/\.csc-identity-grid--choices \.csc-flag-checkbox \{ padding-inline: 9px; \}/);
    // SIL-521: the strip band is retired — no identity grid placement left.
    expect(CSS).not.toMatch(/csc-declaration-strip/);
  });
});
