import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrastOnWhite(hex: string): number {
  const l = relativeLuminance(hexToRgb(hex));
  return (1.05) / (l + 0.05);
}

// Card 20260922_25: status badges rendered var(--ok, #16a34a) — the token was
// never declared, so the 3.3:1 light fallback shipped. Both success text
// tokens must exist and clear WCAG AA (>= 4.5:1) on the white surfaces.
describe('semantic status token contrast contract', () => {
  it('declares --ok (aliased to the dark success-text token)', () => {
    expect(css).toMatch(/--ok:\s*var\(--success-text\)/);
  });

  it('keeps the success text tokens at AA contrast on white', () => {
    const dark = css.match(/--success-text:\s*(#[0-9A-Fa-f]{6})/)?.[1];
    expect(dark).toBeTruthy();
    expect(contrastOnWhite(dark!)).toBeGreaterThanOrEqual(4.5);
    const base = css.match(/--success:\s*(#[0-9A-Fa-f]{6})/)?.[1];
    expect(base).toBeTruthy();
    expect(contrastOnWhite(base!)).toBeGreaterThanOrEqual(4.5);
  });
});
