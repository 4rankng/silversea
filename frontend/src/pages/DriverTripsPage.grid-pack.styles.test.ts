import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1203 / SIL-1204 (QA wave a8f059c0, /my-trips, 1440px, Lái xe role)
// — the journey board's 2-column card grid.
//
// SIL-1203: the cards of a row had different heights, so their "Xem chi tiết"
// buttons sat up to 30px apart (Lệnh mới / Đã nhận off by 18px, Lịch sử off
// by 30px).
// SIL-1204: a short card floated above a ~354px hole in the Lịch sử tab (a
// KẸP pair stacked in the left column, one LẺ card in the right column).
//
// The law, pinned here:
//   1. the row FILLS — every item of a row takes the row's height
//      (align-items: stretch on the list, align-content: stretch on the
//      group, align-self: stretch on the card), so the short card occupies
//      the row instead of leaving a hole under it;
//   2. the card is a COLUMN of blocks, so the action footer — pinned by
//      margin-top: auto — lands on the card's bottom edge and the footers
//      of a row share ONE line;
//   3. the card carries NO percentage height: it resolved against the row
//      and overflowed it, so the footer overlapped the next row's cards;
//   4. the mobile band (<1024px) stays a single column.
const css = readFileSync(resolve(process.cwd(), 'src/pages/DriverTripsPage.css'), 'utf8');

/** Every `@media` block body in the sheet, in source order. */
function mediaBlocks(): string[] {
  const blocks: string[] = [];
  const opener = /@media[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(css)) !== null) {
    let depth = 1;
    let index = opener.lastIndex;
    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(opener.lastIndex, index - 1));
  }
  return blocks;
}

/** The sheet with its @media blocks stripped — the always-on rules. */
const baseSheet = mediaBlocks().reduce((sheet, block) => sheet.replace(block, ''), css);

/** The body of a rule whose selector sits alone on its line. */
function ruleBody(selector: string, scope: string = baseSheet): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = scope.match(new RegExp(`^\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1]!;
}

const desktopBand = mediaBlocks().find((block) => block.includes('.driver-journey__list'));
expect(desktopBand, 'expected a ≥1024px band that lays the journey list out').toBeTruthy();

describe('DriverTripsPage — the journey card grid fills its row (SIL-1203 / SIL-1204)', () => {
  it('lays the board out in two columns on desktop and stretches every row item', () => {
    const list = ruleBody('.driver-journey__list', desktopBand!);
    expect(list).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    // The row fills: a card takes the row's height, so no card floats above
    // a hole (SIL-1204) and the row's cards share one height (SIL-1203).
    expect(list).toMatch(/align-items:\s*stretch/);
  });

  it('hands the row height down to the card — the group stretches, the card stretches', () => {
    expect(ruleBody('.driver-journey-group', desktopBand!)).toMatch(/align-content:\s*stretch/);
    expect(ruleBody('.driver-journey-card', desktopBand!)).toMatch(/align-self:\s*stretch/);
  });

  it('gives the card no percentage height — it overflowed the row and overlapped the next one', () => {
    expect(css).not.toMatch(/^\s*\.driver-journey-card\s*\{[^}]*height\s*:/m);
  });

  it('makes the card a column so the footer pins to the card bottom edge', () => {
    const card = ruleBody('.driver-journey-card');
    expect(card).toMatch(/display:\s*flex/);
    expect(card).toMatch(/flex-direction:\s*column/);
    // The pin itself: the action footer rides the card's bottom edge, so the
    // footers of a row share one line.
    expect(ruleBody('.driver-journey-card__footer')).toMatch(/margin-top:\s*auto/);
  });

  it('keeps the mobile band a single column', () => {
    const base = ruleBody('.driver-journey__list');
    expect(base).not.toMatch(/grid-template-columns/);
    expect(base).not.toMatch(/align-items/);
    // The card's own rule stays width-agnostic — the desktop band only adds
    // the row-fill (align-self), never a height.
    const card = ruleBody('.driver-journey-card');
    expect(card).not.toMatch(/height\s*:/);
    expect(card).not.toMatch(/align-self/);
  });
});
