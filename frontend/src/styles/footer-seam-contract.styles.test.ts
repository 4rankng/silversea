import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20261004_330 — class sweep of the popover/footer seam law (card 20261004_322,
// docs/design-guidelines.md "Popover footers hug their content (cards 20261004_322,
// 20261004_330)"): the gap between the last content block and a footer/action
// row is a seam, not whitespace — `margin-top ≤ 4px` + `padding-top ≤ 8px`
// (~13px visual), with a hairline `border-top` as the separator. No filling
// spacer, no auto-margin stretch.
//
// Pre-fix HEAD (581309b6):
//   .month-picker__footer      margin-top 10 + padding 10px 2px 0  = 20px seam
//   .users-mobile-card__actions margin-top 10 + padding-top 10     = 20px seam
//   .trip-hero__actions        margin-top 4 + padding-top 14       = 18px seam
//                              (plus a DEAD `padding-top: 4px` earlier in the
//                              same block, shadowed by the later 14px)
// The hairlines each rule already carries keep their separator role, so the
// seam shrinks to the .modal__foot rhythm and nothing else changes.
//
// Declarations are pinned here; the browser seam measurement is the lead's
// render rung. The phone-band `.trip-hero__actions` override in
// styles/responsive.css belongs to ANOTHER lane and is deliberately not pinned
// here — its padding-top: 10px is reported in the card REPORT instead.

function read(relativePath: string) {
  const direct = resolve(process.cwd(), relativePath);
  if (existsSync(direct)) return readFileSync(direct, 'utf8');
  return readFileSync(resolve(process.cwd(), 'frontend', relativePath), 'utf8');
}

const topbarCss = read('src/components/layout/topbar.css');
const usersCss = read('src/features/users/users.css');
const tripHeroCss = read('src/components/TripHero.css');

const ruleBodies = (source: string): Array<{ selector: string; body: string }> =>
  [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().split('\n').pop()!.trim(),
    body: m[2],
  }));

// Parsed declaration map: keys are the property names the rule actually
// declares (exact match, so `padding` never shadows `padding-top`). A repeated
// property keeps the LAST declaration — CSS cascade inside one block — so the
// dead-duplicate check below counts raw occurrences instead.
function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(';')) {
    const [prop, ...rest] = part.split(':');
    if (rest.length === 0) continue;
    out[prop.trim().toLowerCase()] = rest.join(':').trim();
  }
  return out;
}

function px(value: string | undefined, label: string): number {
  const matched = value?.match(/^(\d+(?:\.\d+)?)px$/);
  expect(matched, `${label}: expected a px length, got ${value ?? '<absent>'}`).toBeTruthy();
  return Number(matched![1]);
}

// CSS 1–4 component shorthand: the first component is always the top edge.
function effectiveTop(d: Record<string, string>, long: 'margin-top' | 'padding-top', shorthand: 'margin' | 'padding'): number | undefined {
  const explicit = d[long];
  const short = d[shorthand];
  const value = explicit ?? (short ? short.trim().split(/\s+/)[0] : undefined);
  return value === undefined ? undefined : px(value, `${long} (effective)`);
}

function countDeclarations(body: string, prop: string): number {
  return [...body.matchAll(new RegExp(`(^|[;{\\s])${prop}\\s*:`, 'g'))].length;
}

const topbarRules = ruleBodies(topbarCss);
const usersRules = ruleBodies(usersCss);
const tripHeroRules = ruleBodies(tripHeroCss);

const monthFooter = topbarRules.find((rule) => rule.selector === '.month-picker__footer');
const usersActions = usersRules.find((rule) => rule.selector === '.users-mobile-card__actions');
const tripActions = tripHeroRules.find((rule) => rule.selector === '.trip-hero__actions');

// One shared seam assertion per surface (AC1): the footer/action row follows
// its content directly — margin-top ≤ 4px, padding-top ≤ 8px — and keeps its
// hairline border-top as the separator.
function expectGluedSeam(rule: { selector: string; body: string } | undefined, file: string) {
  expect(rule, `${file}: rule missing`).toBeTruthy();
  const seam = decls(rule!.body);
  const margin = effectiveTop(seam, 'margin-top', 'margin');
  const padding = effectiveTop(seam, 'padding-top', 'padding');
  expect(margin, `${rule!.selector} margin-top`).toBeLessThanOrEqual(4);
  expect(padding, `${rule!.selector} padding-top`).toBeLessThanOrEqual(8);
  expect(rule!.body, `${rule!.selector} keeps its hairline separator`).toMatch(/border-top:\s*1px\b/);
}

describe('popover/action-row seams hug their content (card 20261004_330)', () => {
  it('month picker footer: margin-top ≤ 4px, padding-top ≤ 8px, hairline kept', () => {
    // 20px seam in the month popover (margin 10 + padding 10) — instance 1.
    expectGluedSeam(monthFooter, 'src/components/layout/topbar.css');
  });

  it('users mobile card actions: margin-top ≤ 4px, padding-top ≤ 8px, hairline kept', () => {
    // 20px seam on the mobile-card button row — instance 2.
    expectGluedSeam(usersActions, 'src/features/users/users.css');
  });

  it('trip hero actions: margin-top ≤ 4px, padding-top ≤ 8px, hairline kept', () => {
    // 18px seam (margin-top 4 + padding-top 14) under the hero chips — instance 3.
    expectGluedSeam(tripActions, 'src/components/TripHero.css');
  });

  it('trip hero actions block carries no shadowed padding-top duplicate (AC2)', () => {
    // AC2 — the pre-fix block declared padding-top twice (4px dead, 14px live);
    // a shadowed declaration is how the 4px "dead" value survived review.
    expect(tripActions).toBeTruthy();
    expect(countDeclarations(tripActions!.body, 'padding-top')).toBe(1);
  });
});
