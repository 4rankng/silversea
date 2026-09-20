import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tableCss = readFileSync(resolve(process.cwd(), 'src/pages/trip-list/table.css'), 'utf8');

describe('trips table width contract (card _23)', () => {
  it('sizes the grid to its intrinsic floor so ≥1440 viewports never scroll', () => {
    // Content floor = fixed columns (124+116+116+112+112+100+100 = 780px)
    // + minmax floors (200+250+104 = 554px) + nine 10px gaps (90px) = 1424px.
    // The 1438px card frame at ≥1440 viewports must stay larger than this or
    // the TRẠNG THÁI column edge clips behind a pointless 22px scrollbar.
    expect(tableCss).not.toContain('min-width: 1460px');
    expect(tableCss.match(/min-width: 1424px/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the ten-column template with its minmax floors so the floor math holds', () => {
    const template = 'grid-template-columns: minmax(200px, 1.3fr) 124px minmax(250px, 1.45fr) minmax(104px, 0.6fr) 116px 116px 112px 112px 100px 100px;';
    expect(tableCss.match(new RegExp(template.replaceAll('(', '\\(').replaceAll(')', '\\)'), 'g'))?.length).toBeGreaterThanOrEqual(2);
  });
});
