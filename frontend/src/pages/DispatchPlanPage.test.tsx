import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageStyles = readFileSync(resolve(process.cwd(), 'src/pages/DispatchPlanPage.css'), 'utf8');

// Card 20260921_22: the dispatch plan pager floats mid-list when position is
// sticky — 13-14 of 20 rows sit beneath it at rest. The pager must stay in
// flow after the table so no row is ever covered.
describe('DispatchPlanPage pager contract (card 20260921_22)', () => {
  it('keeps the pagination in flow, never sticky over the rows', () => {
    const pagerBlock = pageStyles.match(/__workspace > \.ds-pagination\s*\{[^}]*\}/)?.[0] ?? '';
    expect(pagerBlock, 'the workspace pager block must exist').not.toBe('');
    expect(pagerBlock).toMatch(/position:\s*static/);
    expect(pagerBlock).not.toMatch(/position:\s*sticky/);
    // The sticky variant sealed the app frame with a negative margin; in flow
    // it would only tug the pager up over the frame's padding.
    expect(pagerBlock).not.toMatch(/margin-bottom:\s*-32px/);
  });
});
