import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/trip-list/responsive.css'), 'utf8');

describe('Trip List mobile status-filter layout', () => {
  it('shows every status choice in a two-column grid instead of horizontal scrolling', () => {
    expect(css).toContain('.trip-list-page .status-tabs {\n    display: grid;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n    overflow: visible;');
  });
});
