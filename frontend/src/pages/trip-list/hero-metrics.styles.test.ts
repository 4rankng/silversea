import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/trip-list/hero-metrics.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('trip hero breakdown bar — segment hues (QA sweep 28/11)', () => {
  it('gives Hoàn thành and Đang chạy distinct hues — never two greens', () => {
    const htth = css.match(/\.trip-list-page \.bb-htth\s*\{\s*background:\s*([^;]+);/)?.[1];
    const dang = css.match(/\.trip-list-page \.bb-dang\s*\{\s*background:\s*([^;]+);/)?.[1];
    expect(htth).toBe('var(--success)');
    // The open/active blue — NOT --brand (#005A2D), which read as a second
    // green beside --success (#177448) in the legend.
    expect(dang).toBe('var(--chip-open-text)');
    expect(dang).not.toBe(htth);
  });

  it('declares one color per legend state — the retired chot rule is gone', () => {
    expect(css).not.toMatch(/\.bb-chot(?![\w-])/);
    for (const state of ['htth', 'dang', 'moi', 'huy']) {
      expect(css, `bb-${state} keeps its segment color`).toMatch(new RegExp(`\\.trip-list-page \\.bb-${state}\\s*\\{\\s*background:`));
    }
  });
});
