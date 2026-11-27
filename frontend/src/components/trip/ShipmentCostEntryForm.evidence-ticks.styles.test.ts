import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-1132 — the Hóa đơn / Phiếu thu tick pair at the driver's 390px band.
 *
 * The pair is the KB §10.6.2 "Loại chứng từ" choice rendered as two house
 * buttons beside each other (ShipmentCostEntryForm.css's own provision: "hai
 * nút nhà (btn--sm, tối đa 40px) cạnh nhau"). Two laws at phone width:
 *
 * 1. NO-TRUNCATE (§4 doctrine, card 20261004_338 idiom): content wraps and is
 *    never clipped — the pair breaks lines, the labels wrap inside their
 *    buttons; no ellipsis, no overflow-hidden, no nowrap, no title crutch.
 * 2. CONTROL CEILING: the pair rides the house COMPACT button (btn--sm —
 *    `--control-compact-h`, under the `--control-max-h` 40px ordinary
 *    ceiling) and declares no height of its own. The shared touch-floor bump
 *    (SIL-583, `--control-touch-h`) is the house-wide §5 tap-target law pinned
 *    in mobile-touch-floor.styles.test.ts — a page may never inflate past it
 *    nor add its own geometry.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const css = read('src/components/trip/ShipmentCostEntryForm.css');
const tsx = read('src/components/trip/DriverSavedExpenseProofs.tsx');
const tokens = read('src/styles/tokens.css');
const buttonCss = read('src/components/Button.css');

const rule = (source: string, selector: string): string => {
  const found = source.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`))?.[1];
  expect(found, `${selector} rule exists`).toBeTruthy();
  return found!;
};

const CLIP = /text-overflow:\s*ellipsis/;
const CLIP_HIDDEN = /overflow:\s*hidden/;
const CLAMP = /-webkit-line-clamp/;
const NOWRAP = /white-space:\s*nowrap/;

describe('Hóa đơn/Phiếu thu pair at the 390px band (SIL-1132)', () => {
  it('wraps rather than clips: no truncation idiom on the pair or its labels', () => {
    const group = rule(css, '.shipment-cost-entry__evidence-ticks');
    expect(group).toMatch(/flex-wrap:\s*wrap/);
    for (const body of [group, rule(css, '.shipment-cost-entry__evidence-ticks .btn'), rule(css, '.shipment-cost-entry__evidence-ticks-label')]) {
      expect(body).not.toMatch(CLIP);
      expect(body).not.toMatch(CLIP_HIDDEN);
      expect(body).not.toMatch(CLAMP);
      expect(body).not.toMatch(NOWRAP);
    }
    // The button labels wrap inside their own box (the house emergency break),
    // so even an unbroken run never overflows its control at 390px.
    expect(rule(css, '.shipment-cost-entry__evidence-ticks .btn')).toMatch(/white-space:\s*normal/);
    expect(rule(css, '.shipment-cost-entry__evidence-ticks .btn')).toMatch(/overflow-wrap:\s*anywhere/);
    // No title-attribute crutch may substitute for showing the text (§4).
    expect(tsx).not.toMatch(/title=/);
  });

  it('controls ride btn--sm on the ≤40px ordinary ceiling, with no page-local height', () => {
    // The house compact geometry sits under the operator's 40px ceiling.
    const compact = Number(tokens.match(/--control-compact-h:\s*(\d+)px/)?.[1]);
    expect(compact, '--control-compact-h resolves').toBeGreaterThan(0);
    expect(compact, 'compact control is on/below the 40px ordinary ceiling').toBeLessThanOrEqual(40);
    expect(tokens).toMatch(/--control-max-h:\s*40px;/);
    // btn--sm is the compact house button — the pair's only geometry source.
    expect(buttonCss).toMatch(/\.btn--sm\s*\{[^}]*min-height:\s*var\(--control-compact-h\)/);
    expect(tsx).toMatch(/btn btn--sm\$\{value === 'INVOICE'/);
    expect(tsx).toMatch(/btn btn--sm\$\{value === 'RECEIPT'/);
    expect(tsx).not.toMatch(/btn--lg/);
    // Neither the pair nor its label declares a height — no inflation past the
    // ceiling from this surface.
    for (const body of [rule(css, '.shipment-cost-entry__evidence-ticks'), rule(css, '.shipment-cost-entry__evidence-ticks .btn'), rule(css, '.shipment-cost-entry__evidence-ticks-label')]) {
      expect(body).not.toMatch(/(^|;|\s)(min-|max-)?height\s*:/);
    }
  });

  it('the ≤600px phone band adds no clipped variant of the pair', () => {
    const media = css.match(/@media \(max-width: 600px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(media, 'the phone band exists').not.toBe('');
    expect(media).not.toContain('__evidence-ticks');
    // Wrap-not-clip is width-independent: no media-scoped truncation either.
    expect(css).not.toMatch(/__evidence-ticks[^{]*\{[^}]*(text-overflow|ellipsis|overflow:\s*hidden|white-space:\s*nowrap)/);
  });
});
