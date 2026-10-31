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

  it('worksheet is the single-column grid; the form joins it via display: contents', () => {
    // SIL-604: the 4fr/8fr pairing had no tenant left once the mode band
    // stopped sharing row 1 with identity — every section owns a full-width
    // row now.
    expect(CSS).toMatch(/\.csc-workspace \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 12px; \}/);
    expect(CSS).toMatch(/\.csc-form \{ display: contents; \}/);
  });

  it('places every section + freight (both with and without freight preview); the action bar stays viewport-fixed', () => {
    for (const area of [
      // SIL-604 (id 707): the mode band leads the form as its own FULL-width,
      // content-sized row — the equal-height stretch (SIL-596) centered
      // ~105px of controls inside a 238px card (ticket khung đỏ,
      // qa/2026-10-30_sil604_ui-modeband-1307-before). No stretch, no
      // centering: a content-sized card has nothing to center.
      '#shipment-section-mode { grid-area: 1 / 1 / 2 / 3; align-self: start; }',
      '#shipment-section-identity { grid-area: 2 / 1 / 3 / 3; }',
      // SIL-611 (id 714): the schedule band is deleted — cargo moves beside
      // the closing Ghi chú row on FCL, and a rendered route card (hàng lẻ)
      // pushes cargo to the last row.
      '#shipment-section-notes { grid-area: 5 / 1 / 6 / 3; }',
      '#shipment-section-route { grid-area: 4 / 1 / 5 / 3; }',
      '#shipment-section-cargo { grid-area: 4 / 1 / 5 / 3; }',
      '.csc-workspace:has(#shipment-section-route) #shipment-section-cargo { grid-area: 5 / 1 / 6 / 3; }',
    ]) {
      expect(CSS, area).toContain(area);
    }
    // The supersize shape must stay dead: no stretch, no align-content
    // centering, and no column-local placement pin on the mode card.
    expect(CSS).not.toMatch(/#shipment-section-mode \{[^}]*stretch/);
    expect(CSS).not.toMatch(/#shipment-section-mode \{[^}]*align-content/);
    expect(CSS).not.toMatch(/#shipment-section-mode \{ grid-area: 1 \/ 1 \/ 2 \/ 2/);
    // SIL-596: the freight card owns a FULL-width row — no orphan grid cell
    // (§10.8.2: hide a column only when it is empty).
    expect(CSS).toContain('[data-freight-preview] { grid-area: 3 / 1 / 4 / 3; align-self: start; margin: 0; }');
    // SIL-611: the deleted schedule band never comes back.
    expect(CSS).not.toMatch(/#shipment-section-schedule/);
    // SIL-510: the action bar is NOT a grid row — it is the viewport-fixed
    // footer, so the wide band places neither a grid area nor a padding
    // override on it (a comment may name it; a rule may not).
    expect(CSS).not.toMatch(/\.csc-form-actions\s*\{/);
    // Freight-absent collapse: no empty track may stay behind. The LCL
    // freight-absent pin doubles the predicates to out-rank :has(route).
    for (const pull of [
      ':not(:has([data-freight-preview])) #shipment-section-notes { grid-area: 4 / 1 / 5 / 3; }',
      ':not(:has([data-freight-preview])) #shipment-section-route { grid-area: 3 / 1 / 4 / 3; }',
      ':not(:has([data-freight-preview])) #shipment-section-cargo { grid-area: 3 / 1 / 4 / 3; }',
      ':not(:has([data-freight-preview])):has(#shipment-section-route) #shipment-section-cargo { grid-area: 4 / 1 / 5 / 3; }',
    ]) {
      expect(CSS, pull).toContain(pull);
    }
  });

  it('keeps the SPEC density numbers (padding 12, worksheet gap 12, heading band 36, table row 48)', () => {
    expect(CSS).toMatch(/\.csc-workspace \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 12px; \}/);
    expect(CSS).toMatch(/\.csc-section \{ padding: 12px 14px !important; gap: 8px !important; \}/);
    // 7px block padding + ~21px title line + 1px border = the 36px band.
    expect(CSS).toMatch(/\.csc-section__heading \{ margin: -12px -14px 0; padding: 7px 14px; \}/);
    expect(CSS).toMatch(/\.csc-container-table tbody th, \.csc-container-table tbody td \{ padding: 7px 6px; \}/);
  });

  it('SIL-604 retest: the mode band card carries its own 6px vertical padding (59px row + 12px = 71px ≤ AC 72)', () => {
    // QA measured the card at 83px = 59px in-range control line + 2×12px
    // section padding. The AC names the CARD height, so the band pins a
    // dedicated padding — the inner row, its single line and centering stay.
    expect(CSS).toMatch(/#shipment-section-mode \{ padding: 6px 14px !important; \}/);
  });

  it('separates the topline actions from the section band by ≥12px (SIL-509)', () => {
    // Owner ticket 26/10: the actions row sat flush on the "Nhận diện lô"
    // band at ≥1280. The SIL-499 zero-margin squeeze is superseded there.
    expect(CSS).toMatch(/\.csc-topline \{ margin-bottom: 12px; \}/);
  });

  it('never shrinks typography (SPEC: font giữ nguyên)', () => {
    expect(CSS, 'no font-size declarations in the wide band').not.toMatch(/font-size:/);
  });

  it('SIL-642: the FCL bulk datetime is retired — the mode band is Loại hàng + segmented only', () => {
    const WORKSPACE = readFileSync(join(__dirname, 'ShipmentCreateWorkspace.tsx'), 'utf8');
    // SIL-642 (id 746, owner 31/10) retired the band datetime outright: no
    // bulk block may live between the mode-band row and the identity
    // section, and no FCL-only band gate may return.
    const modeBandRegion = WORKSPACE.slice(
      WORKSPACE.indexOf('csc-mode-band__row'),
      WORKSPACE.indexOf('<ShipmentCreateIdentitySection'),
    );
    expect(modeBandRegion, 'the band datetime block is gone').not.toContain('csc-bulk-appointment');
    expect(modeBandRegion, 'no FCL band gate survives').not.toMatch(/cargoMode === 'FCL' && \(/);
    // The LCL schedule datetime is the band's only remaining field
    // (SIL-587), still gated to LCL.
    expect(modeBandRegion, 'the LCL datetime stays').toMatch(/cargoMode === 'LCL' && \(/);
    // SIL-611 (id 714, owner 30/10): the "Lịch & ghi chú" section is gone —
    // no `id="schedule"` section in the DOM, and the Ghi chú band renders
    // strictly AFTER Thông tin hàng (the copy-down button rides cargo,
    // under the table it fills).
    expect(WORKSPACE).not.toMatch(/id="schedule"/);
    expect(WORKSPACE.indexOf('id="notes"')).toBeGreaterThan(WORKSPACE.indexOf('id="cargo"'));
    const cargoRegion = WORKSPACE.slice(
      WORKSPACE.indexOf('id="cargo"'),
      WORKSPACE.indexOf('id="notes"'),
    );
    expect(cargoRegion, 'copy-down button under the container table').toContain('Copy giờ hẹn xuống cont trống');
    // No placement left for a schedule band; the 1fr/2fr split (which
    // measured a ~265px dead strip beside the 150px control) stays dead.
    expect(CSS).not.toMatch(/#shipment-section-schedule \.csc-bulk-appointment/);
    expect(CSS).not.toMatch(/#shipment-section-schedule \{ grid-template-columns:/);
    // SIL-604: the band row is one baseline line — content-sized mode card
    // (worksheet rows never justify-fill).
    expect(CSS).toMatch(/#shipment-section-mode \{ grid-area: 1 \/ 1 \/ 2 \/ 3; align-self: start; \}/);
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
