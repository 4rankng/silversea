import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/trip-list/responsive.css'), 'utf8');

describe('Trip List mobile status-filter layout', () => {
  it('leaves the status group shape to the shared Tabs primitive on a 390px phone', () => {
    // The group is the shared `Tabs variant="boxed"` (operator ruling
    // 2026-09-27): its phone wrap + 44px floor live in design-system/Tabs.css,
    // so this page sheet must not re-declare a group shape.
    expect(css).not.toContain('.status-tabs');
    expect(css).not.toContain('.stab-pill');
    expect(css).toContain('.trip-list-page .metrics { display: none; }');
  });
});