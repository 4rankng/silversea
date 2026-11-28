import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// P2-13 retest (QA 28/11, /my-trips Lịch sử, Lái xe role) — the journey
// board's 2-column card grid keeps every card at its NATURAL height.
//
// History: SIL-1203/SIL-1204 (wave a8f059c0) pinned align-items: stretch so
// a short card filled its row. The retest rejects that model: beside a tall
// KẸP pair the stretched single-ĐƠN card read as a ~350px empty void INSIDE
// the card, and QA prescribes align-items: start, accepting the ragged row
// bottom the stretch once tried to remove.
//
// The law, pinned here:
//   1. the list is two columns on desktop and aligns items at their START —
//      no stretch on the list, the group, or the card (the stretch trio must
//      not return);
//   2. the card is a COLUMN of blocks with NO percentage height — its footer
//      keeps the margin-top: auto pin (inert at natural height) so a future
//      stretch model cannot drift the footer into the content;
//   3. the mobile band (<1024px) stays a single column.
const css = readFileSync(resolve(process.cwd(), 'src/pages/DriverTripsPage.css'), 'utf8');

/** Every `@media` block body in the sheet, in source order. */
function mediaBlocks(): string[] {
  const blocks: string[] = [];
  const opener = /@media[^{]*\{/g;
  for (let match = opener.exec(css); match !== null; match = opener.exec(css)) {
    const openerEnd = match.index + match[0].length;
    let depth = 1;
    let index = openerEnd;
    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(openerEnd, index - 1));
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

describe('DriverTripsPage — the journey card grid keeps natural heights (P2-13 retest 28/11)', () => {
  it('lays the board out in two columns and aligns cards at their start', () => {
    const list = ruleBody('.driver-journey__list', desktopBand!);
    expect(list).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    // Each card keeps its natural height: no stretched void inside a short
    // card beside a tall KẸP pair (the retest's ~350px gap).
    expect(list).toMatch(/align-items:\s*start/);
    expect(list).not.toMatch(/align-items:\s*stretch/);
  });

  it('carries no stretch remnants on the group or the card', () => {
    expect(ruleBody('.driver-journey-group', desktopBand!)).not.toMatch(/align-content/);
    expect(css).not.toMatch(/\.driver-journey-card\s*\{[^}]*align-self:\s*stretch/);
    expect(desktopBand!).not.toMatch(/align-self:\s*stretch/);
  });

  it('gives the card no percentage height — it overflowed the row and overlapped the next one', () => {
    expect(css).not.toMatch(/^\s*\.driver-journey-card\s*\{[^}]*height\s*:/m);
  });

  it('makes the card a column so the footer stays pinned to the card bottom edge', () => {
    const card = ruleBody('.driver-journey-card');
    expect(card).toMatch(/display:\s*flex/);
    expect(card).toMatch(/flex-direction:\s*column/);
    // Inert at natural height, but the pin survives any future stretch.
    expect(ruleBody('.driver-journey-card__footer')).toMatch(/margin-top:\s*auto/);
  });

  it('keeps the mobile band a single column', () => {
    const base = ruleBody('.driver-journey__list');
    expect(base).not.toMatch(/grid-template-columns/);
    expect(base).not.toMatch(/align-items/);
    // The card's own rule stays width-agnostic — no height, no align-self.
    const card = ruleBody('.driver-journey-card');
    expect(card).not.toMatch(/height\s*:/);
    expect(card).not.toMatch(/align-self/);
  });
});
