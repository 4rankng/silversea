import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Card 20260924_10 — date-segment padding asymmetry. The slash separators
 * sat equidistant to nothing: 'DD' glyphs (17.47px @12px) left ~2.07px slack
 * per side inside the shared 1.8em box while 'MM' (20.47px) left 0.57px, so
 * the rendered field read "DD /MM/ YYYY" — the slash hugging MM. The boxes
 * now carry per-segment widths (placeholder glyphs + equal slack each side,
 * 0.125em at the 12px base) and the separators carry symmetric margins, so
 * every slash sits centered between its neighbors' glyphs. */
describe('date segments read DD/MM/YYYY with even slash gaps (card 20260924_10)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/design-system/forms/DateTimeSegments.css'), 'utf8');

  it('sizes each segment box to its own glyphs plus equal slack', () => {
    const base = css.match(/\.date-seg-group \.date-seg-wrapper \.date-seg\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(base).toContain('text-align: center');
    expect(css).toContain(".date-seg[data-seg='dd'] { width: 1.706em; }");
    expect(css).toContain(".date-seg[data-seg='mm2'] { width: 1.956em; }");
    expect(css).toContain(".date-seg[data-seg='yyyy'] { width: 2.91em; }");
  });

  it('centers the separators with symmetric margins', () => {
    const sep = css.match(/\.date-sep\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(sep).toContain('margin-inline: 2px');
  });
});
