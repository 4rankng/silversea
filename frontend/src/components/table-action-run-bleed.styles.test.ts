import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20261004_331 — fixed-column action-run bleed (class law:
// docs/design-guidelines.md "Fixed-column icon runs never bleed onto
// neighbours (cards 20261004_324, 20261004_331)"). Two co-equal defects:
//
// (1) Shared root cause — components/Table.css `.row-actions` carried
//     `justify-content: flex-end` next to non-shrinking square `.row-action`
//     buttons. In ANY frozen column narrower than the run the overflow escapes
//     the cell's START edge and paints over the left neighbour (the card-324
//     pencil-glued-to-the-pill defect). `safe flex-end` keeps the run's start
//     edge inside its own cell under overflow and is byte-identical in render
//     to `flex-end` whenever the run fits — so every host that fits today
//     renders unchanged.
//
// (2) `.ancillary-fees__table` — table-layout: fixed, Trạng thái col 12% of
//     the 720px floor = 86.4px (74.4px content after 2×6px td padding) hosts
//     the status token AND the row's action ("Sửa" ghost button) in ONE
//     `.fee-decision-cell` (inline-flex, gap 2px, white-space: nowrap) — an
//     ≈161px run that paints over the Chứng từ column. Fix: grant the column
//     its run budget at the table floor (every column keeps ≥ its old width)
//     + a wrap-yield so an over-budget run stacks INSIDE its own cell
//     (no truncation — the table law) instead of bleeding.
//
// Pre-fix HEAD (3c2e1ba7): shared `justify-content: flex-end`;
// ancillary min-width 720px, shares 30/14/14/13/17/12;
// `.fee-decision-cell { white-space: nowrap }`. Geometry below is derived
// from the REAL contracts (tokens.css, Button.css, the live JSX), text widths
// use documented per-character estimates (same estimate class as card
// 20261004_324's status token floor). Declarations are pinned here; the
// browser bleed render is the lead's render rung.

function read(relativePath: string) {
  const direct = resolve(process.cwd(), relativePath);
  if (existsSync(direct)) return readFileSync(direct, 'utf8');
  return readFileSync(resolve(process.cwd(), 'frontend', relativePath), 'utf8');
}

const tokens = read('src/styles/tokens.css');
const tableCss = read('src/components/Table.css');
const buttonCss = read('src/components/Button.css');
const feesSource = read('src/components/trip/AncillaryFeesCard.tsx');

const ruleBodies = (source: string): Array<{ selector: string; body: string }> =>
  [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().split('\n').pop()!.trim(),
    body: m[2],
  }));

function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(';')) {
    const [prop, ...rest] = part.split(':');
    if (rest.length === 0) continue;
    out[prop.trim().toLowerCase()] = rest.join(':').trim();
  }
  return out;
}

function matchNumber(source: string, pattern: RegExp, label: string): number {
  const value = Number(source.match(pattern)?.[1]);
  expect(Number.isFinite(value), `${label}: ${pattern}`).toBe(true);
  return value;
}

function px(value: string | undefined, label: string): number {
  const matched = value?.match(/^(\d+(?:\.\d+)?)px$/);
  expect(matched, `${label}: expected a px length, got ${value ?? '<absent>'}`).toBeTruthy();
  return Number(matched![1]);
}

const rules = ruleBodies(tableCss);
const rowActions = rules.find((rule) => rule.selector === '.row-actions');
const rowAction = rules.find((rule) => rule.selector === '.row-action');
const feeCell = rules.find((rule) => rule.selector === '.fee-decision-cell');
const feeCellKids = rules.find((rule) => rule.selector === '.fee-decision-cell > *');

/* ── run budget derived from the real contracts ──────────────────────────── */

// Per-character advance estimates for Vietnamese mixed-case text (conservative
// high end of measured glyphs incl. 0.02em tracking): ≈0.59em at weight 700,
// ≈0.55em at 400–600. Card 20261004_324 used the same estimate class
// ("9 chars at 12px/500 ≈ 60px").
const perChar = (fontSize: number, bold: boolean): number => fontSize * (bold ? 0.59 : 0.55);

const captionSize = matchNumber(tokens, /--text-caption-size:\s*(\d+)px/, 'caption size');
const compactFontSize = matchNumber(tokens, /--text-control-compact-size:\s*(\d+)px/, 'compact control font');
expect(tokens).toContain('--status-text-font-size: var(--text-caption-size)');
const dotSize = matchNumber(tokens, /--status-text-dot-size:\s*(\d+)px/, 'status dot');
const statusGap = matchNumber(tokens, /--status-text-gap:\s*(\d+)px/, 'status text gap');
const statusBold = /--status-text-weight:\s*700/.test(tokens);

// Worst status token at HEAD is "Cần hoàn thiện" (the neutral pending state —
// the only one that also carries the Sửa button). Derived from the live JSX so
// a label change re-derives the budget instead of drifting.
const pillLabels = [...feesSource.matchAll(/<StatusPill\b[^>]*>([^<{]+)<\/StatusPill>/g)].map((match) => match[1].trim());
expect(pillLabels.length, 'StatusPill labels found in AncillaryFeesCard.tsx').toBeGreaterThan(0);
const worstPillChars = Math.max(...pillLabels.map((label) => label.length));

// The decision-cell action button: btn--sm ghost (padding 4px 8px beats the
// .btn--ghost 10px 12px — Button.css order), icon + label.
const btnPadX = matchNumber(buttonCss, /\.btn--sm \{[^}]*padding: \d+px (\d+)px/, 'btn--sm pad-x');
const btnGap = matchNumber(buttonCss, /\.btn \{[^}]*gap: (\d+)px/, 'btn gap');
const editMatch = feesSource.match(/className="btn btn--sm btn--ghost"[\s\S]*?<Edit2 size=\{(\d+)\} \/>\s*([^<]+?)<\/button>/);
expect(editMatch, 'decision-cell Sửa button found in AncillaryFeesCard.tsx').toBeTruthy();
const editIcon = Number(editMatch![1]);
const editChars = editMatch![2].trim().length;

const pillRun = dotSize + statusGap + worstPillChars * perChar(captionSize, statusBold);
const editRun = 2 * btnPadX + btnGap + editIcon + editChars * perChar(compactFontSize, false);
expect(feeCell, '.fee-decision-cell rule').toBeTruthy();
const cellGap = px(decls(feeCell!.body)['gap'], '.fee-decision-cell gap');
const decisionRun = pillRun + cellGap + editRun;
const moneyRun = '1.350.000 ₫'.length * perChar(compactFontSize, false);

/* ── ancillary table budgets ─────────────────────────────────────────────── */

const ancillaryTable = rules.find((rule) => rule.selector === '.ancillary-fees__table' && /table-layout/.test(rule.body));
expect(ancillaryTable, '.ancillary-fees__table rule').toBeTruthy();
const floor = px(decls(ancillaryTable!.body)['min-width'], 'ancillary floor');
const cellPadX = matchNumber(tableCss, /\.ancillary-fees__table tbody td \{ padding: \d+px (\d+)px/, 'ancillary td pad-x');

const shareOf = (column: number): number =>
  matchNumber(tableCss, new RegExp(`\\.ancillary-fees__table thead th:nth-child\\(${column}\\) \\{ width: (\\d+)%`), `col ${column} share`);

const colBudget = (column: number): number => (shareOf(column) / 100) * floor - 2 * cellPadX;

describe('fixed-column action runs stay inside their cell (card 20261004_331)', () => {
  describe('AC1 — shared .row-actions never paints leftward', () => {
    it('anchors the run with safe flex-end (falls back to start only under overflow)', () => {
      // `safe` is render-identical to `flex-end` when the run fits its column —
      // every fitting host keeps today's render ("not covered — render
      // unchanged by safe" hosts in the REPORT inventory).
      expect(rowActions).toBeTruthy();
      expect(decls(rowActions!.body)['justify-content']).toBe('safe flex-end');
    });

    it('never leaves an unsafe flex-end on a row-actions rule', () => {
      const unsafe = rules.filter(
        (rule) => /row-actions/.test(rule.selector) && /justify-content:\s*flex-end\s*(;|$)/.test(rule.body)
      );
      expect(unsafe.map((rule) => rule.selector)).toEqual([]);
    });

    it('keeps the .row-action square from shrinking below its control floor', () => {
      // The "ô vuông .row-action không co" half of the mechanism: min-width
      // pinned to the same token as width, so the run's width is predictable.
      expect(rowAction).toBeTruthy();
      const square = decls(rowAction!.body);
      expect(square['width']).toBe('var(--control-compact-h)');
      expect(square['min-width']).toBe('var(--control-compact-h)');
      expect(square['height']).toBe('var(--control-compact-h)');
      expect(square['min-height']).toBe('var(--control-compact-h)');
    });
  });

  describe('AC2 — ancillary Trạng thái cell holds its whole run at the table floor', () => {
    it('grants the status column the full decision run (pill + action)', () => {
      expect(worstPillChars).toBeGreaterThanOrEqual(10);
      expect(colBudget(6)).toBeGreaterThanOrEqual(decisionRun);
    });

    it('keeps the money columns wide enough for the money token', () => {
      for (const column of [2, 3, 4]) {
        expect(colBudget(column), `col ${column} money budget`).toBeGreaterThanOrEqual(moneyRun);
      }
    });

    it('width shares fill the frozen table (sum 100)', () => {
      const shares = [1, 2, 3, 4, 5, 6].map(shareOf);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it('yields by wrapping instead of bleeding — never truncates', () => {
      // Belt on the mechanism: if real fonts exceed the derived budget the run
      // stacks inside its own cell (pill over the Sửa button) instead of
      // painting over Chứng từ. Items keep intrinsic width (flex-shrink: 0),
      // and the block never ellipsizes or clips (table law).
      expect(feeCell).toBeTruthy();
      const cell = decls(feeCell!.body);
      expect(cell['flex-wrap']).toBe('wrap');
      expect(cell['white-space'], 'nowrap forces the horizontal bleed').toBeUndefined();
      expect(feeCellKids, '.fee-decision-cell > * rule').toBeTruthy();
      expect(decls(feeCellKids!.body)['flex-shrink']).toBe('0');
      for (const rule of rules.filter((r) => /ancillary-fees__table|fee-decision-cell|ancillary-fee-card/.test(r.selector))) {
        expect(rule.body, rule.selector).not.toMatch(/text-overflow:\s*ellipsis|overflow:\s*hidden/);
      }
    });
  });
});
