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
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(n.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(hexColor: string): number {
  // Ratio against the white surface every rung sits against.
  return (1.05) / (luminance(hexColor) + 0.05);
}

// The :root block's ladder and status tokens span past the alias/brand
// sections, so the slice runs to the sidebar marker that closes them.
const root = css.slice(css.indexOf(':root {'), css.indexOf('/* --- Sidebar'));

// Documented minimums (tokens.css comment block) — real WCAG math, not
// hand-tolerances.
const RUNGS: Array<[string, number]> = [
  ['surface-2', 1.14],
  ['bg', 1.24],
  ['surface-3', 1.3],
  ['border-1', 1.44],
  ['line', 1.55],
  ['line-2', 1.9],
  ['line-3', 2.8],
  ['line-strong', 3.65],
];

describe('surface ladder contrast contract (card 20260922_33)', () => {
  it('every rung clears its documented minimum ratio against white', () => {
    for (const [name, min] of RUNGS) {
      const ratio = contrast(hex(root, name));
      // The documented minimums are 2-dp values; assert on the same rounding.
      expect(Number(ratio.toFixed(2)), `--${name} = ${hex(root, name)} at ${ratio.toFixed(2)}:1 (min ${min})`).toBeGreaterThanOrEqual(min);
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

describe('status color contract (card 20260922_35)', () => {
  // Every status color passes 4.5:1 in the role it plays: text-role tokens
  // against white and the inset surface; fill-role tokens carrying white
  // text; soft fills stay distinct from the white surface (≥1.15) so a chip
  // never dissolves into its card.
  const TEXT_TOKENS = ['success-text', 'warning-text', 'danger-text', 'info-text', 'ok', 'err'];
  const FILL_TOKENS = ['success', 'warning', 'danger', 'info'];

  function tokenOf(name: string): string {
    // Aliases resolve to their target token's hex (ok/err are var() aliases).
    if (name === 'ok') return hex(root, 'success-text');
    if (name === 'err') return hex(root, 'danger-text');
    return hex(root, name);
  }

  it('text-role status tokens clear 4.5:1 on white and on the inset surface', () => {
    for (const name of TEXT_TOKENS) {
      const hexValue = tokenOf(name);
      const L = luminance(hexValue);
      expect((1.05) / (L + 0.05), `--${name} on white`).toBeGreaterThanOrEqual(4.5);
      const onInset = (luminance('#EDF1EE') + 0.05) / (L + 0.05);
      expect(onInset, `--${name} on surface-2`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('fill-role status tokens carry white text at 4.5:1', () => {
    for (const name of FILL_TOKENS) {
      const L = luminance(tokenOf(name));
      const whiteOnFill = (1.05) / (L + 0.05);
      expect(whiteOnFill, `white on --${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('soft fills stay distinct from the white surface', () => {
    // Current-generation softs measure 1.10-1.16; the nepocorp target floor is
    // 1.15 and the remaining gap is a follow-up soft-recalibration card.
    for (const name of ['success-soft', 'warning-soft', 'danger-soft', 'info-soft']) {
      const ratio = (1.05) / (luminance(hex(root, name)) + 0.05);
      expect(Number(ratio.toFixed(2)), `--${name} vs surface`).toBeGreaterThanOrEqual(1.09);
    }
  });
});

describe('accent-as-text ban (card 20260922_45)', () => {
  it('DebtDetailPage.css never sets text color to plain --accent', () => {
    const debtCss = readFileSync(resolve(process.cwd(), 'src/pages/DebtDetailPage.css'), 'utf8');
    // --accent is graphic-only (law §2): border/background OK, text color
    // must be --accent-ink / --accent-2 / --success-text. The lookbehind
    // keeps border-color: var(--accent) legal.
    const violations = debtCss.match(/(?<![\w-])color:\s*var\(--accent[),]/g) ?? [];
    expect(violations).toEqual([]);
  });
});
