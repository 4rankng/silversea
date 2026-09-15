import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/trip-list/responsive.css'), 'utf8');

describe('Trip List mobile status-filter layout', () => {
  it('shows every status choice in two rows without horizontal scrolling on a390px phone', () => {
    expect(css).toContain('.trip-list-page .status-tabs {\n    display: grid;\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n    overflow: visible;');
    expect(css).toContain('min-height: 44px;');
    expect(css).toContain('.trip-list-page .metrics { display: none; }');
  });
});
