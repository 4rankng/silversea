import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260922_33 — the surface ladder is a measured contract, not a mood.
// Every rung carries a minimum contrast ratio against #FFFFFF (the nepocorp
// sibling-project contract, adopted verbatim), and the ramp must stay
// monotonic: surface < surface-2 < surface-3 < border-1 < line < line-2 <
// line-3 < line-strong. A rung can no longer lighten silently; lightening
// any rung now requires updating its documented minimum AND re-measuring.
const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function hex(block: string, name: string): string {
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`token --${name} missing from :root block`);
  return m[1];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hexColor: string): number {
  const n = hexColor.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)).map(channel);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(hexColor: string): number {
  // Ratio against the white surface every rung sits against.
  return (1.05) / (luminance(hexColor) + 0.05);
}

// The :root block's ladder tokens span past the alias/brand sections, so the
// slice runs to the semantic-status marker that closes the surface section.
const root = css.slice(css.indexOf(':root {'), css.indexOf('/* --- Semantic status'));

const RUNGS: Array<[string, number]> = [
  ['surface-2', 1.14],
  ['bg', 1.2],
  ['surface-3', 1.28],
  ['border-1', 1.3],
  ['line', 1.45],
  ['line-2', 1.8],
  ['line-3', 2.6],
  ['line-strong', 3.5],
];

describe('surface ladder contrast contract (card 20260922_33)', () => {
  it('every rung clears its documented minimum ratio against white', () => {
    for (const [name, min] of RUNGS) {
      const ratio = contrast(hex(root, name));
      expect(ratio, `--${name} = ${hex(root, name)} at ${ratio.toFixed(2)}:1 (min ${min})`).toBeGreaterThanOrEqual(min);
    }
    // WCAG 1.4.11 non-text: the control boundary clears 3:1.
    expect(contrast(hex(root, 'control-border'))).toBeGreaterThanOrEqual(3);
    // Placeholders stay readable (nepocorp: 4.85).
    expect(contrast(hex(root, 'ink-4'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the ramp is strictly monotonic from the surface to the strongest line', () => {
    const ratios = ['surface', 'surface-2', 'surface-3', 'border-1', 'line', 'line-2', 'line-3', 'line-strong']
      .map((name) => contrast(hex(root, name)));
    for (let i = 0; i < ratios.length - 1; i += 1) {
      expect(ratios[i + 1]).toBeGreaterThan(ratios[i]);
    }
  });
});
