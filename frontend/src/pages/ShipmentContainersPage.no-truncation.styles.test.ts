import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-516 commit 2 — SIL-515 doctrine (owner 26/10: "không truncate, wrap full")
// applied to the Chi tiết lô hàng workboard. Card 20260922_37 (law book §4)
// bans `text-overflow: ellipsis`, clipping `overflow: hidden|clip` and
// `-webkit-line-clamp` on table data cells: values either WRAP
// (`white-space: normal` + word breaks) or EXPAND (single-token cells keep
// `white-space: nowrap` and drop every clip — here the column share is pinned
// to fit the token instead of the column auto-sizing). The only clipped rules
// allowed on this sheet are the screen-reader-only layers and the phone row
// card's rounded-corner mask.

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.css'), 'utf8');
const ledgerSource = readFileSync(resolve(process.cwd(), 'src/features/shipments/detail/ShipmentContainerLedger.tsx'), 'utf8');

const allRules = (source: string): Array<{ selector: string; body: string; raw: string }> =>
  [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2], raw: m[0] }));

const rulesFor = (source: string, selector: RegExp): string[] =>
  allRules(source).filter((r) => selector.test(r.selector)).map((r) => r.raw);

const CLIP = /text-overflow:\s*ellipsis/;
const CLIP_HIDDEN = /(?:^|[^-\w])overflow:\s*hidden/;
const CLIP_VIS = /(?:^|[^-\w])overflow:\s*clip/;
const CLAMP = /-webkit-line-clamp/;

const expectNoClip = (found: string[]) => {
  expect(found.length).toBeGreaterThan(0);
  for (const rule of found) {
    expect(rule).not.toMatch(CLIP);
    expect(rule).not.toMatch(CLIP_HIDDEN);
    expect(rule).not.toMatch(CLIP_VIS);
    expect(rule).not.toMatch(CLAMP);
  }
};

describe('Chi tiết lô hàng: data cells never truncate (SIL-515 doctrine)', () => {
  it('every ledger value/wrap rule is clip-free', () => {
    const valueSelectors = [
      /\.shipment-container-ledger__multiline > \*/,
      /\.shipment-container-ledger__multiline > strong/,
      /\.shipment-container-ledger__multiline > em/,
      /\.shipment-container-ledger__multiline > small/,
      /^\.shipment-container-ledger__plate$/,
      /\.shipment-container-ledger__plate--missing/,
      /^\.shipment-container-ledger__dispatch-badge$/,
      /\.shipment-container-ledger__row-warning$/,
      /\.shipment-container-ledger__route > span/,
      /^\.shipment-container-ledger__copy$/,
      /^\.shipment-container-ledger__code$/,
      /\.shipment-container-ledger__code--phrase/,
      /^\.shipment-container-ledger__missing$/,
      /^\.shipment-container-ledger__direction$/,
      /\.shipment-container-ledger__editor-grid > small/,
    ];
    for (const sel of valueSelectors) expectNoClip(rulesFor(css, sel));
  });

  it('the only clipped ledger rules are screen-reader layers or the row-card mask', () => {
    // Every rule under a shipment-container-ledger selector that clips at all
    // must be one of the documented non-data layers: caption / edit-purpose
    // (screen-reader text), the card-mode hidden thead, or the phone row
    // card's rounded-corner mask (`tbody > tr` overflow).
    const allowlist = [
      /^\.shipment-container-ledger caption$/,
      /^\.shipment-container-ledger__edit-purpose$/,
      /^\.shipment-container-ledger thead$/,
      /^\.shipment-container-ledger thead tr$/,
      /^\.shipment-container-ledger thead th$/,
      /^\.shipment-container-ledger tbody > tr$/,
    ];
    const offenders: string[] = [];
    for (const rule of allRules(css)) {
      if (!rule.selector.includes('shipment-container-ledger')) continue;
      if (!(CLIP_HIDDEN.test(rule.body) || CLIP_VIS.test(rule.body) || CLAMP.test(rule.body) || CLIP.test(rule.body))) continue;
      if (!allowlist.some((a) => rule.selector.split(',').some((s) => a.test(s.trim())))) {
        offenders.push(rule.selector.slice(0, 100));
      }
    }
    expect(offenders, `unapproved clip rules: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('headers wrap at spaces with an even balance — the sort button may never overflow its th', () => {
    const sortBtn = rulesFor(css, /\.shipment-container-ledger thead \.table-sort-button/);
    expect(sortBtn.length).toBeGreaterThan(0);
    expect(sortBtn[0]).toMatch(/flex-wrap:\s*wrap/);
    expect(sortBtn[0]).toMatch(/white-space:\s*normal/);
    expect(sortBtn[0]).toMatch(/word-break:\s*keep-all/);
    expect(sortBtn[0]).toMatch(/text-wrap:\s*balance/);
    expect(sortBtn[0]).not.toMatch(/white-space:\s*nowrap/);
    // The shared nowrap law lives in table-sort.css and is untouched — this
    // sheet overrides it for the ledger only (its own th contract is pinned
    // to `white-space: normal` by "lets headings wrap …" in the styles test).
    const shared = readFileSync(resolve(process.cwd(), 'src/styles/table-sort.css'), 'utf8');
    expect(shared).toMatch(/\.table-sort-button \{[^}]*white-space:\s*nowrap/);
  });

  it('EXPAND tokens keep whole identifiers and a floor that fits them (SIL-872 ticket ladder)', () => {
    // Measured token widths at the shipped scale (11px Inter Digits codes,
    // 12px cells, +24px cell padding): 12-digit tờ khai "309132985730" = 87px,
    // 11-char ISO "MSNU3128119" = 86px, Bill/Booking "EBKG19248801" = 83px,
    // the date token "30/10/2026" = 72px, the plate pill "29C-123.45" ≈ 85px
    // with chrome. SIL-872's chốt ladder set the original floors; the P2 QA
    // round WIDENED the identifier tracks (billbook/declaration 105 → 128,
    // vehicle 105 → 120) and amended the SIL-756 law: no cell-level
    // overflow-x scrollbar (the tiny scrollbars and clipped runs read as
    // broken) — a token wider than its cell now wraps inside the cell
    // (overflow-wrap: anywhere, the ops-expense SỐ HĐ precedent), so the
    // value is fully visible: no ellipsis, no clip, no scrollbar, no bleed.
    // The in-cell BKS editor keeps the SIL-516 invariant — its tray is
    // width:100% of the cell, nothing spills.
    const floor = (name: string) => Number(css.match(new RegExp(`--led-w-${name}:\\s*(\\d+)px`))?.[1] ?? 0);
    expect(floor('schedule')).toBe(125);
    expect(floor('route')).toBe(120);
    expect(floor('status')).toBe(115);
    expect(floor('container')).toBe(115);
    expect(floor('billbook')).toBe(128);
    expect(floor('direction')).toBe(64);
    expect(floor('declaration')).toBe(128);
    expect(floor('vehicle')).toBe(120);
    expect(floor('customer')).toBe(150);
    expect(floor('shippingline')).toBe(80);
    // P2 QA amendment of SIL-756: identifier cells wrap inside the widened
    // floor — no cell-level scrollbar, no ellipsis, no clip.
    const codeRules = rulesFor(css, /td\[data-label="Thông số container"\] \.shipment-container-ledger__code$/);
    expect(codeRules.length).toBeGreaterThan(0);
    expect(codeRules[0]).toMatch(/white-space:\s*normal/);
    expect(codeRules[0]).not.toMatch(/overflow-x:\s*auto/);
    expect(codeRules[0]).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(codeRules[0]).toMatch(/overflow-wrap:\s*anywhere/);
    expect(codeRules[0]).toMatch(/word-break:\s*normal/);
    expectNoClip(codeRules);

    // SIL-756: declaration numbers and Bill/Booking share the identifier nowrap law
    expect(css).toMatch(/td\[data-label="Số tờ khai"\] \.shipment-container-ledger__code/);
    expect(css).toMatch(/td\[data-label="Bill\/Booking"\] \.shipment-container-ledger__code/);
    // Plate chips are identifiers too.
    const plateRules = rulesFor(css, /^\.shipment-container-ledger__plate$/);
    expect(plateRules[0]).toMatch(/white-space:\s*nowrap/);
    expectNoClip(plateRules);
  });

  it('phrase-like lot copy wraps instead of borrowing the identifier nowrap law', () => {
    const phrase = rulesFor(css, /\.shipment-container-ledger__code--phrase/);
    expect(phrase.length).toBeGreaterThan(0);
    expect(phrase[0]).toMatch(/white-space:\s*normal/);
    expect(phrase[0]).toMatch(/word-break:\s*normal/);
    // The lot row is the branch that carries the phrase modifier.
    expect(ledgerSource).toContain("row.isLotLevel ? 'shipment-container-ledger__code shipment-container-ledger__code--phrase'");
  });

  it('copy label wraps; the plate-editor helper wraps by words, never one character per line', () => {
    const copy = rulesFor(css, /^\.shipment-container-ledger__copy$/);
    expect(copy[0]).toMatch(/white-space:\s*normal/);
    expect(copy[0]).not.toMatch(/white-space:\s*nowrap/);
    const hint = rulesFor(css, /\.shipment-container-ledger__editor-grid > small/);
    expect(hint[0]).toMatch(/word-break:\s*break-word/);
    expect(hint[0]).toMatch(/white-space:\s*normal/);
  });

  it('SIL-863: the NHẬP/XUẤT pill breaks at WORD boundaries — a fixed-vocabulary label never shatters', () => {
    // QA 22/11 (build 061739f9): the pill inherited `overflow-wrap: anywhere`
    // and shattered mid-syllable ("Nhậ"/"p", "Xuấ"/"t") — 11 of 20 pills at
    // 1440×900. The pill is a fixed label ("Nhập" / "Xuất" / "Nhập lẻ" /
    // "Xuất lẻ"), so it wraps at spaces (the SIL-822 route-cell law) and
    // never inside a word.
    const pill = rulesFor(css, /^\.shipment-container-ledger__direction$/);
    expect(pill.length).toBeGreaterThan(0);
    expect(pill[0]).toMatch(/overflow-wrap:\s*break-word/);
    expect(pill[0]).toMatch(/word-break:\s*normal/);
    expect(pill[0]).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(pill[0]).toMatch(/white-space:\s*normal/);
    expectNoClip(pill);
    // The pill's own 4px inline gutter is what makes "Nhập" (32px) fit the
    // 43.7px trigger box; the trigger keeps the sheet's 10px gutter so the
    // pill keeps the row's 10px text inset.
    expect(pill[0]).toMatch(/padding:\s*2px 4px/);
    expect(css).not.toMatch(/td\[data-label='Nhập\/Xuất'\][^{]*\.shipment-container-ledger__cell-trigger\s*\{[^}]*padding-left:/);
  });
});

// SIL-620 (id 724) — Hoàn thành is a pure text button (no pill/box) rendered on
// one line (white-space: nowrap), never wrapped into 2 lines, and never clipped.
const closeActionCss = readFileSync(resolve(process.cwd(), 'src/features/shipments/detail/ExternalTripCompleteAction.css'), 'utf8');

describe('SIL-620 Hoàn thành text button is 1 line, never clips', () => {
  it('the component sheet forces white-space: nowrap, text button styling, and stays clip-free', () => {
    const rules = rulesFor(closeActionCss, /^\.external-trip-complete$/);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0]).toMatch(/white-space:\s*nowrap/);
    expect(rules[0]).not.toMatch(/white-space:\s*normal/);
    expect(rules[0]).toMatch(/background:\s*transparent/);
    expectNoClip(rules);
  });
});
