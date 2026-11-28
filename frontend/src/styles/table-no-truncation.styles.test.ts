import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260922_37 (no-truncation doctrine, law book §4): table data cells never
// clip a value. The banned patterns are `text-overflow: ellipsis`, clipping
// `overflow: hidden`, and `-webkit-line-clamp` — same defect class. Values either
// WRAP (`white-space: normal` + `overflow-wrap: anywhere`) or EXPAND (single-token
// cells keep `white-space: nowrap` and drop every clip, so the column sizes to
// content — card 20260922_22's auto layout; also QA-090's "identifiers stay
// whole" contract). Truncation-justifying comments are an anti-pattern in their
// own right (law book §11) and die with the clip.
//
// Assertions are rule-local (every rule whose selector matches): controls —
// selects, filter triggers, pickers, nav — keep their legal ellipsis untouched.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const rules = (css: string, selector: RegExp): string[] =>
  [...css.matchAll(new RegExp(selector.source + String.raw`[\s\S]*?\{([^}]*)\}`, 'g'))].map((m) => m[0]);

const CLIP = /text-overflow:\s*ellipsis/;
const CLIP_HIDDEN = /overflow:\s*hidden/;
const CLAMP = /-webkit-line-clamp/;
const CLIP_INLINE = /textOverflow:\s*'ellipsis'/;

const expectNoClip = (found: string[]) => {
  expect(found.length).toBeGreaterThan(0);
  for (const rule of found) {
    expect(rule).not.toMatch(CLIP);
    expect(rule).not.toMatch(CLIP_HIDDEN);
    expect(rule).not.toMatch(CLAMP);
  }
};

describe('table data cells never truncate (card 20260922_37)', () => {
  it('a header label wraps at spaces, never inside a word (card 20260922_54)', () => {
    // The other half of the doctrine: a cell EXPANDS, and a header's min-content
    // must not be one character. `overflow-wrap: anywhere` on a header let a
    // narrow column shatter "CONTAINER" into CONTAINE + R; both the shared base
    // and the global head rule now refuse the emergency break.
    const base = read('src/styles/record-table.css').match(/\.record-table thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(base, 'record-table thead th exists').not.toBe('');
    expect(base).toContain('overflow-wrap: normal');
    expect(base).toContain('word-break: keep-all');
    expect(base).not.toContain('overflow-wrap: anywhere');

    const globalHead = read('src/styles/operational-table-typography.css').match(/:where\(table thead th\)\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(globalHead, 'global thead rule exists').not.toBe('');
    expect(globalHead).toContain('overflow-wrap: normal');
    expect(globalHead).toContain('word-break: keep-all');
  });

  it('ancillary-fees invoice cell wraps instead of ellipsizing at maxWidth 110', () => {
    const src = read('src/components/trip/AncillaryFeesCard.tsx');
    expect(src).not.toMatch(CLIP_INLINE);
    expect(src).not.toContain("whiteSpace: 'nowrap', maxWidth: 110");
    expect(src).toContain("overflowWrap: 'anywhere'");
  });

  it('catalogs bank-name cell wraps; its truncation-justifying comment is gone', () => {
    const css = read('src/features/dispatch/catalogs/catalogs.css');
    expectNoClip(rules(css, /td\[data-label="Ngân hàng nhận tiền"\]/));
    expect(rules(css, /td\[data-label="Ngân hàng nhận tiền"\]/)[0]).toMatch(
      /overflow-wrap:\s*anywhere|white-space:\s*normal/,
    );
    expect(css).not.toContain('truncate with an ellipsis');
  });

  it('create-form container cell display wraps; container codes are never clipped mid-token', () => {
    const css = read('src/features/shipments/create/ShipmentContainerCell.css');
    expectNoClip(rules(css, /\.csc-container-cell__display/));
    expect(css).toMatch(/\.csc-container-cell__display[^}]*overflow-wrap:\s*anywhere/);
  });

  it('config identifier cells expand whole (QA-090) without clipping (card 20260922_37)', () => {
    const css = read('src/pages/config/config-list.css');
    const found = rules(css, /\.cfg-customer-table td\[data-label="Mã KH"\]/);
    expectNoClip(found);
    expect(found[0]).toMatch(/white-space:\s*nowrap/);
    expect(found[0]).not.toMatch(/max-width:\s*170px/);
  });

  it('trip-list plate token wraps instead of ellipsizing', () => {
    const css = read('src/pages/trip-list/table.css');
    expectNoClip(rules(css, /\.trip-list-page \.plate/));
    expect(rules(css, /\.trip-list-page \.plate/)[0]).toMatch(
      /overflow-wrap:\s*anywhere|white-space:\s*normal/,
    );
  });

  it('customers record cells wrap; the 2-line clamp and sub-line ellipsis are gone', () => {
    const css = read('src/pages/CustomersPage.css');
    expect(css).not.toContain('customers-clamp-2');
    expectNoClip(rules(css, /\.customers-cell-wrap/));
    expectNoClip(rules(css, /\.customers-cell-sub/));
    expect(css).not.toMatch(CLAMP);
  });

  it('work-inbox table cells wrap: subtitle and facts never ellipsize', () => {
    const css = read('src/components/work-inbox/RoleWorkInbox.css');
    expectNoClip(rules(css, /\.role-work-inbox__subtitle/));
    expectNoClip(rules(css, /\.role-work-inbox__facts dd/));
    expect(css).not.toMatch(CLAMP);
    expect(css).not.toContain('td:nth-child(3) { overflow: hidden; }');
  });

  it('the customers column popover rides the --surface token (hunk carried for card 20260922_36)', () => {
    const css = read('src/pages/CustomersPage.css');
    const popover = rules(css, /\.customers-cols-popover/)[0];
    expect(popover).toContain('background: var(--surface)');
    expect(popover).not.toContain('background: #fff');
  });

  it('ops-bill identity values wrap in both the table and the mobile-card render', () => {
    const css = read('src/pages/ForwarderTripsPage.css');
    expectNoClip(rules(css, /\.ops-bill-table td button/));
    expectNoClip(rules(css, /\.ops-bill-mobile-list__identity strong/));
  });

  it('debit board values hold ONE baseline and never clip (ticket 18/11 supersedes the 23/10 ellipsis law on the rebuilt grid)', () => {    // The flat /shipments-debit board retired with ticket 18/11 (Task 2.2):
    // the page renders the shared DebitMergeGrid now, and the ticket spec
    // (Chương 4 §4.1.3 cấm cắt chữ) supersedes the 23/10 one-line-ellipsis +
    // tooltip treatment on its data cells: values keep ONE baseline (nowrap)
    // but the grid NEVER clips a value — no ellipsis or overflow-hidden rule
    // may return on its cells; the pane scrolls horizontally instead, and
    // the money columns keep a content floor (96px since SIL-1180 R5: the
    // old 110px floor blew the 1440 viewport; 96px still fits the tabular
    // 13px "12.345.678" baseline and the floor is a minimum — auto layout
    // grows the column for longer amounts and never clips) instead of the
    // old fixed 220px caps.
    const css = read('src/features/accounting/DebitMergeGrid.css');
    const cell = rules(css, /\.debit-merge__table th,\s*\.debit-merge__table td/)[0];
    expect(cell).toMatch(/white-space:\s*nowrap/);
    expect(cell).not.toMatch(CLIP);
    expect(cell).not.toMatch(CLIP_HIDDEN);
    for (const oneLine of [
      // Fee/expense lines and the status cell: one baseline each, whole.
      /\.debit-merge-cell__line small,\s*\.debit-merge-cell__line/,
      /\.debit-merge-cell--status/,
    ]) {
      const found = rules(css, oneLine);
      expect(found.length).toBeGreaterThan(0);
      for (const rule of found) {
        expect(rule).toMatch(/white-space:\s*nowrap/);
        expect(rule).not.toMatch(CLIP);
        expect(rule).not.toMatch(CLIP_HIDDEN);
      }
    }
    // Every money column keeps its content floor (the ticket's replacement
    // for the old REV2 fixed widths) with right-aligned figures.
    const moneyTh = rules(css, /\.debit-merge__table th\.debit-merge-col--cuoc/)[0];
    expect(moneyTh).toMatch(/min-width:\s*96px/);
    expect(moneyTh).toMatch(/text-align:\s*right/);
  });

  it('fuel-period note truncates on ONE baseline with a tooltip (SIL-466 owner review 24/10 supersedes the wrap doctrine here)', () => {
    // Same owner-directive class as the debit board above: the fuel-periods
    // catalogue keeps its rows at 40–48px by truncating the note to one line
    // (ellipsis, max-width 260px) and carrying the FULL text in the cell's
    // title tooltip — pinned by FuelPricePeriodsConfigPage.table.test.tsx.
    const css = read('src/pages/config/fuel-price-periods-config.css');
    const rule = rules(css, /\.fp-note\s*\{/)[0];
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).toMatch(/max-width:\s*260px/);
  });

  it('freight route fact clips on ONE line with a tooltip in the phone card band only (P2 QA sweep 28/11)', () => {
    // Same owner-directive class as SIL-466/467: the 18/11 expand law keeps
    // the Tuyến column on one nowrap line at the table; unscoped it rode into
    // the ≤639px card band where the ~185px 2-up card track clipped the
    // 205px 'KCN Đồng Văn, Ninh Bình' past the card edge with no scroll to
    // reach it. The card band releases the cap to a one-line ellipsis and
    // the full name rides the cell's title tooltip; table mode keeps the
    // expand law untouched (page tests pin the tooltip).
    const css = read('src/pages/config/FreightRateTermsConfigPage.css');
    const band = css.match(/@container \(max-width: 639px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(band, 'the card-band exception exists').not.toBe('');
    expect(band).toMatch(/td\[data-label='Tuyến'\]/);
    expect(band).toMatch(/overflow:\s*hidden/);
    expect(band).toMatch(/text-overflow:\s*ellipsis/);
    const src = read('src/pages/config/FreightRateTermsConfigPage.tsx');
    expect(src, 'the clipped fact exposes its full text').toMatch(/title=\{route\}/);
  });

  it('factories identity and address truncate on ONE baseline with tooltips (SIL-467 owner directive 24/10 supersedes the wrap doctrine here)', () => {
    // Same owner-directive class as the debit board and SIL-466: the factories
    // board keeps rows ≤56px by running the merged "Mã · Tên" identity and the
    // "Địa chỉ · Liên hệ" cell on one baseline each — ellipsis + title tooltip
    // carries the FULL name / address + every contact (page tests pin the
    // tooltips; the ≤1100px card band releases the cap where the card owns the
    // width).
    const css = read('src/pages/config/config-page.css');
    for (const oneLine of [/\.factory-name\s*\{/, /\.factory-addr\s*\{/]) {
      const rule = rules(css, oneLine)[0];
      expect(rule).toMatch(/white-space:\s*nowrap/);
      expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    }
    expect(rules(css, /\.factory-name\s*\{/)[0]).toMatch(/max-width:\s*300px/);
  });

  it('detailed-plan grid cells wrap full — ellipsis/nowrap/clips banned table-wide (SIL-515 owner 26/10)', () => {
    // The owner's ticket revokes the surface's own 23/10 "one nowrap
    // ellipsized line per value" law: every cell wraps its full text and
    // the wrapper's horizontal rail carries the width. The nowrap line was
    // also the overlap mechanism ("Ngày giao đè Trả hàng"): in a
    // fixed-layout column a nowrap line refuses to shrink below its
    // one-line width and paints over the next cell.
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    const editorCss = read('src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css');
    // Every value line wraps (the table-mode shared line law)…
    const lineRule = css.match(/\.detailed-plan-grid__line,\s*\n\s*\.detailed-plan-grid \.ops-schedule__datetime\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(lineRule, 'the value-line rule must exist').not.toBe('');
    expect(lineRule).toContain('white-space: normal');
    expect(lineRule).toContain('overflow-wrap: anywhere');
    expectNoClip([lineRule]);
    // …the header label wraps without a clamp…
    expectNoClip(rules(css, /\.detailed-plan-grid__sort\s*\{/));
    expect(rules(css, /\.detailed-plan-grid__sort\s*\{/)[0]).not.toMatch(/white-space:\s*nowrap/);
    // …and the table-surface one-line pins are gone (rule-local: the phone
    // dpcard surface in the same file keeps its own owner laws). The loop
    // patterns must NOT end in `\s*\{`: rules() closes each match at the
    // rule's OWN opening brace, and a trailing `\{` made the capture swallow
    // the NEXT rule — falsely failing on the SIL-756 Round-3
    // `.ops-container-line` identifier carve-out, which keeps its own
    // owner-acked nowrap law (ISO container codes never break mid-string).
    for (const tableRule of [
      /\.detailed-plan-grid__cell--container \.detailed-plan-grid__line--strong/,
      /\.detailed-plan-grid__combined-note/,
      /\.detailed-plan-grid__lcl-group-tag/,
    ]) {
      expectNoClip(rules(css, tableRule));
      for (const rule of rules(css, tableRule)) expect(rule).not.toMatch(/white-space:\s*nowrap/);
    }
    // Multi-line prose note previews clamp to 2 lines with a "Chi tiết" trigger opening the full modal.
    expect(css).toMatch(/\.detailed-plan-grid__note-preview\s*\{[^}]*-webkit-line-clamp:\s*2/);
    // The Điều phối facts wrap under the same table-wide ban.
    const band = editorCss.match(/\.dispatch-assignment-cell \.dispatch-assignment-cell__carrier,[\s\S]*?\{([^}]*)\}/)?.[1] ?? '';
    expect(band, 'the fact band must exist').not.toBe('');
    expect(band).toContain('white-space: normal');
    expectNoClip([band]);
    // The compact driver note preview clamps to 2 lines; full text opens in modal.
    const noteCss = read('src/features/dispatch/detailed-plan/DispatchDriverNote.css');
    expect(noteCss).toMatch(/\.dispatch-driver-note--compact \.dispatch-driver-note__text\s*\{[^}]*-webkit-line-clamp:\s*2/);
  });

  it('master-plan phone card wraps full — the mpcard scope carries no clip (SIL-507 retry under SIL-515)', () => {
    // The card's first 26/10 pass ran the truncate pattern; the owner's
    // SIL-515 no-truncate law (landed the same day) supersedes it on the
    // phone card too. Every value line wraps; the only nowrap left in the
    // scope is the allocate button's own label.
    const css = read('src/features/dispatch/master-plan/MasterPlanGrid.css');
    const cardCss = css.slice(css.indexOf('.mpcard-list'));
    expect(cardCss, 'the mpcard section must exist').not.toBe('');
    expect(cardCss).not.toMatch(CLIP);
    expect(cardCss).not.toMatch(CLIP_HIDDEN);
    expect(cardCss).not.toMatch(CLAMP);
    for (const wrapLine of [
      /\.mpcard__customer\s*\{/,
      /\.mpcard__bill\s*\{/,
      /\.mpcard__time\s*\{/,
      /\.mpcard__route\s*\{/,
      /\.mpcard__cargo,\s*\n\.mpcard__measures,\s*\n\.mpcard__fleet\s*\{/,
      /\.mpcard__status\s*\{/,
      /\.mpcard__line\s*\{/,
      /\.mpcard__note\s*\{/,
    ]) {
      const found = rules(cardCss, wrapLine);
      expect(found.length, `wrap rule for ${wrapLine}`).toBeGreaterThan(0);
      for (const rule of found) {
        expect(rule).toMatch(/white-space:\s*normal/);
        expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
      }
    }
  });

  it('config customer full names wrap in the compact-card render', () => {
    const css = read('src/pages/config/customer-config-density.css');
    expectNoClip(rules(css, /\.cfg-customer-full-name/));
  });

  it('debit Bảng 2.2 fee names wrap in the narrow Phí khác column (card 20260924_1, image7)', () => {
    // The fee-name value carried white-space: nowrap inside an auto-layout
    // column narrower than the name, so long names clipped at the cell edge
    // ("111.000 HỘP ĐỊNH ĐIỆN"). Names wrap; the other-fee row wraps its
    // controls beside them — law book §4 no-truncation.
    const css = read('src/features/shipments/debit/ShipmentDebitWorkspace.css');
    expect(css).toMatch(/\.csc-debit-item__name\s*\{[^}]*white-space:\s*normal/);
    expect(css).not.toMatch(/\.csc-debit-item__name\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.csc-debit-otherfee\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
