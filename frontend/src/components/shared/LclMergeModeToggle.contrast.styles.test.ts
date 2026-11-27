// SIL-1212 (audit 2026-11-27) — the "Thoát gộp hàng" exit button on
// /shipments-detail measured 3.24:1: white text on the emerald accent fill
// (rgb(74,158,125) = --accent). The 27/11 remediation (7a2e50e3) moved the
// active face to a solid ink fill; this test is the PROOF that the face the
// button actually paints today clears WCAG AA (>= 4.5:1) — computed from the
// house tokens, never from a raw colour.
//
// The invariant this pins: the merge-mode exit button NEVER paints a fill
// that white text cannot sit on. The accent fill is graphic-only (the
// accent-as-text ban, surface-ladder.test.ts); it must never become a
// button background under a white label.
//
// Cascade note: the toggle's own sheet is loaded with the (lazy) route chunk,
// after index.css's `.btn` shell, so these declarations are the ones that
// paint the button.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/shared/LclMergeModeToggle.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two opaque colours. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The house token value behind a custom property. */
function tokenHex(name: string): string {
  const hit = tokens.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{3,6})`))?.[1];
  if (!hit) throw new Error(`token --${name} missing from tokens.css`);
  return hit;
}

/** Resolve a CSS colour value (token reference, fallback or literal) to a hex. */
function resolveColor(value: string): string {
  const reference = value.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/);
  if (!reference) return value.trim();
  const [, token, fallback] = reference;
  const hit = tokens.match(new RegExp(`--${token.slice(2)}:\\s*(#[0-9A-Fa-f]{3,6})`))?.[1];
  if (hit) return hit;
  if (fallback) return resolveColor(fallback);
  throw new Error(`cannot resolve ${token}`);
}

/** The declaration body of the rule whose selector list mentions `selector`. */
function ruleBody(selector: string): string {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)];
  const found = rules.find((m) => m[1].split(',').some((s) => s.trim().split(/\s+/).includes(selector)));
  if (!found) throw new Error(`rule for ${selector} missing`);
  return found[2];
}

const declaration = (body: string, property: string): string => {
  const hit = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  if (!hit) throw new Error(`declaration ${property} missing`);
  return hit[1].trim();
};

describe('SIL-1212 — the merge-mode exit button clears WCAG AA', () => {
  it('the ACTIVE face (Thoát gộp hàng) paints white on a fill that measures >= 4.5:1', () => {
    const body = ruleBody('.lcl-merge-toggle--active');
    const background = resolveColor(declaration(body, 'background'));
    const color = resolveColor(declaration(body, 'color'));
    const ratio = contrast(color, background);
    expect(ratio, `${color} on ${background}`).toBeGreaterThanOrEqual(4.5);
    // House tokens only — the pair is resolved from tokens.css, never raw hex.
    expect(declaration(body, 'background')).toMatch(/^var\(--/);
    expect(declaration(body, 'color')).toMatch(/^var\(--/);
  });

  it('the ACTIVE face never paints the emerald accent fill under the white label', () => {
    const body = ruleBody('.lcl-merge-toggle--active');
    const background = resolveColor(declaration(body, 'background'));
    // The audited face: white on --accent measured 3.24:1 — the regression this
    // ticket closes. The accent stays graphic-only.
    const accent = tokenHex('accent');
    expect(contrast('#FFFFFF', accent)).toBeLessThan(4.5);
    expect(background).not.toBe(accent);
  });

  it('the OFF face (Gộp hàng) and its hover face also clear 4.5:1', () => {
    const base = ruleBody('.lcl-merge-toggle');
    const background = resolveColor(declaration(base, 'background'));
    const color = resolveColor(declaration(base, 'color'));
    expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);

    // Hover repaints the label in --accent-2 on the same surface.
    const hover = ruleBody('.lcl-merge-toggle:hover');
    const hoverColor = resolveColor(declaration(hover, 'color'));
    expect(contrast(hoverColor, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('the ACTIVE face keeps its fill on hover too', () => {
    const hoverActive = ruleBody('.lcl-merge-toggle--active:hover');
    const background = resolveColor(declaration(hoverActive, 'background'));
    const color = resolveColor(declaration(hoverActive, 'color'));
    expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
  });
});
