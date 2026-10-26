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

  it('EXPAND tokens keep whole identifiers and a share that fits them (QA-090)', () => {
    // Measured floors at the 1440 workboard (data/caption scale): the date
    // token "30/10/2026" is 74px, container codes ≤72px, "Bill/Booking" 75px,
    // "Nhập/Xuất" 62px — each plus the 24px cell padding.
    const width = (cls: string) => Number(css.match(new RegExp(`\\.shipment-container-ledger__col--${cls}\\s*\\{[^}]*?width:\\s*([\\d.]+)%`))?.[1] ?? 0);
    expect(width('schedule')).toBeGreaterThanOrEqual(9);
    expect(width('container')).toBeGreaterThanOrEqual(9);
    expect(width('billbook')).toBeGreaterThanOrEqual(9);
    expect(width('direction')).toBeGreaterThanOrEqual(9);
    // The in-cell BKS editor needs its share too (SIL-516's headline).
    expect(width('vehicle')).toBeGreaterThanOrEqual(18);
    // Container numbers wrap nowhere — whole-token nowrap, zero clip.
    const codeRules = rulesFor(css, /td\[data-label="Thông số container"\] \.shipment-container-ledger__code$/);
    expect(codeRules.length).toBeGreaterThan(0);
    expect(codeRules[0]).toMatch(/white-space:\s*nowrap/);
    expectNoClip(codeRules);
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
});
