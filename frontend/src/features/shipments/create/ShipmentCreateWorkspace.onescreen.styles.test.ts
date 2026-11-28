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
 *
 * AstraQA2 staging audit 28/11 (container table top y=597 at 1366×768; one
 * editable row must clear the sticky footer) supersedes the SPEC's vertical
 * budget: worksheet gap 8, card padding 8, heading band 31, mode card 38,
 * topline gap 8, row cells 5px, and label-beside-control identity rows.
 * The structural pins (placement, display:contents, one media block, no
 * font-size) are unchanged.
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
    // row now. Gap: SIL-499 SPEC 12px superseded by the AstraQA2 28/11
    // 8px rhythm (audit lever: smaller section gaps above the cargo sheet).
    expect(CSS).toMatch(/\.csc-workspace \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 8px; \}/);
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

  it('keeps the AstraQA2 density numbers (card padding 8, gap 6, heading band 31, row cells 5px 6px)', () => {
    // Supersedes the SIL-499 SPEC (padding 12, gap 8, band 36, cells 7px):
    // AstraQA2 staging audit 28/11 — the container table must start ≥150px
    // higher at 1366×768 so one editable row clears the sticky footer.
    expect(CSS).toMatch(/\.csc-workspace \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 8px; \}/);
    expect(CSS).toMatch(/\.csc-section \{ padding: 8px 14px !important; gap: 6px !important; \}/);
    // 5px block padding + ~20px title line + 1px border = the 31px band.
    expect(CSS).toMatch(/\.csc-section__heading \{ margin: -8px -14px 0; padding: 5px 14px; \}/);
    expect(CSS).toMatch(/\.csc-container-table tbody th, \.csc-container-table tbody td \{ padding: 5px 6px; \}/);
  });

  it('AstraQA2: the mode band card carries its own 4px vertical padding (30px row + 8px = 38px card)', () => {
    // The SIL-604 retest pinned 6px (71px card) against the pre-audit AC;
    // the AstraQA2 28/11 above-table compaction supersedes that budget —
    // the inner row, its single line and centering stay.
    expect(CSS).toMatch(/#shipment-section-mode \{ padding: 4px 14px !important; \}/);
  });

  it('separates the topline from the first band by 8px (AstraQA2 28/11; supersedes SIL-509 ≥12px)', () => {
    // SIL-509 (owner 26/10) bought the ≥12px gap when the actions row sat
    // flush on the "Nhận diện lô" band; the audit's section-gap lever moves
    // that separation into the card's own 8px padding + this 8px topline
    // margin. The actions cluster keeps its place at the head.
    expect(CSS).toMatch(/\.csc-topline \{ margin-bottom: 8px; \}/);
  });

  it('AstraQA2: identity fields read label-BESIDE-control (one 30px line per band row)', () => {
    // The 54px label-over-control towers (18px label + 6px gap + 30px
    // control) stacked twice above the cargo sheet; the audit lever
    // "single-column stacks → tighter rows" lays the label beside the
    // control. Validation/info lanes wrap to their own full-width line so
    // they never squeeze the control mid-interaction.
    expect(CSS).toMatch(
      /#shipment-section-identity :is\(\.csc-searchable-field, \.csc-uui-field, \.csc-text-field-with-warning, \.ds-uui-select\) \{[^}]*display: flex;[^}]*flex-direction: row;[^}]*flex-wrap: wrap;[^}]*\}/,
    );
    // Labels never shrink or wrap; controls take the remaining width (the
    // definite-basis contract lives in the SIL-1255 pin below).
    expect(CSS).toMatch(/#shipment-section-identity [^{]*> label,?\s*\{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/);
    // Hint / error / warning wrap BELOW the row (full-width basis).
    expect(CSS).toMatch(
      /#shipment-section-identity :is\(\[slot='description'\], \[slot='errorMessage'\], \.ds-uui-select__hint, \.ds-uui-select__error, \.csc-field-warning\) \{[^}]*flex: 1 1 100%;\s*\}/,
    );
    // SIL-681 trailing actions ride the control line: the 24px label-line
    // offset (SIL-678) is superseded by 0 once the label sits beside.
    expect(CSS).toMatch(/#shipment-section-identity \.csc-trailing-action \{ top: 0; \}/);
    // Scope guard: no BARE (unprefixed) `.csc-uui-field > :not(label)`
    // selector — every occurrence must carry the identity-section prefix.
    expect(CSS).not.toMatch(/^\s*\.csc-uui-field > :not\(label\)/m);
  });

  it('SIL-1255: identity controls take the lane\'s full remaining width — validation lanes never share the control line', () => {
    // QA build 61999831: the 'Khách hàng' input crushed to 67px (the name
    // read 'Lo…') and 'Hãng tàu' to 54px — a `flex: 1 1 auto` basis over the
    // ComboBox's under-reporting w-full chain (the house's "65px sliver"
    // precedent) let the intrinsic sliver set the line, and the hint/error
    // lanes (out-spec'd by `> :not(label)`) could join the row and steal
    // more width. Definite `flex: 1 1 0` gives the control the lane's whole
    // remainder; the :not() exclusion keeps validation lanes on their own
    // full-width line (flex: 1 1 100%).
    expect(CSS).toMatch(
      /#shipment-section-identity \.csc-searchable-field > \.csc-uui-field,\s*\n\s*#shipment-section-identity \.csc-text-field-with-warning > \.csc-uui-field,\s*\n\s*#shipment-section-identity \.ds-uui-select__control \{[^}]*flex: 1 1 0;/,
    );
    expect(CSS).toMatch(
      /#shipment-section-identity \.csc-uui-field > :not\(label, \[slot='description'\], \[slot='errorMessage'\], \.ds-uui-select__hint, \.ds-uui-select__error, \.csc-field-warning\),[^{]*\{[^}]*flex: 1 1 0;/,
    );
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
    // SIL-1133 (KB Chương 3 §3.2.4, QA-Retest4): the LCL datetime moved OUT
    // of the band into the LCL-only "Lịch & Ghi chú" section (the KB bands
    // the hàng-lẻ form with a titled schedule section, "rút gọn còn 1 mục")
    // — the band now carries ONLY the Loại hàng decision in both modes, so
    // no mode gate survives inside the band region at all.
    expect(modeBandRegion, 'the band is mode-only in both modes').not.toMatch(/cargoMode === 'LCL' && \(/);
    // SIL-611 (id 714) wording superseded by SIL-1133: the LCL schedule
    // section EXISTS again (id="schedule", LCL-gated) and the Ghi chú band
    // renders strictly AFTER Thông tin hàng (the apply-all button rides
    // cargo, under the table it fills — SIL-690).
    expect(WORKSPACE).toMatch(/cargoMode === 'LCL' && \(\s*<ShipmentCreateSection id="schedule" title="Lịch & Ghi chú">/);
    expect(WORKSPACE.indexOf('id="notes"')).toBeGreaterThan(WORKSPACE.indexOf('id="cargo"'));
    const cargoRegion = WORKSPACE.slice(
      WORKSPACE.indexOf('id="cargo"'),
      WORKSPACE.indexOf('id="notes"'),
    );
    expect(cargoRegion, 'apply-all button under the container table (SIL-690)').toContain('Copy thời gian');
    // The schedule section carries no bulk-appointment legacy and no
    // placement grid — the 1fr/2fr split (which measured a ~265px dead strip
    // beside the 150px control) stays dead; the field rides .csc-lcl-delivery.
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
