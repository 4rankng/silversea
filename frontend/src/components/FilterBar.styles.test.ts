import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/FilterBar.css'), 'utf8');

describe('shared filter bar styling', () => {
  it('keeps validation outside toolbar flow without changing sibling alignment', () => {
    const normal = css.match(/\.filter-bar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(normal).toContain('align-items: flex-end');
    const feedback = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(rule => rule[1].includes('.filter-bar .uui-date-hint--error'));
    expect(feedback?.[1]).toContain('.filter-bar__search-error');
    expect(feedback?.[2]).toContain('position: absolute');
    expect(feedback?.[2]).toContain('background: var(--surface)');
    expect(feedback?.[2]).not.toMatch(/overflow:\s*(?:hidden|clip)/);
    expect(css).not.toMatch(/\.filter-bar:has\([^{}]+\{[^}]*align-items:/);
  });

  it('keeps standalone date labels and controls in one hosted row with feedback below', () => {
    const dateCss = readFileSync(resolve(process.cwd(), 'src/design-system/forms/BufferedUuiDateInput.css'), 'utf8');
    const selector = '.filter-bar > [data-input-wrapper]:not([data-has-prefix]):has(> .date-seg-group)';
    const field = dateCss.split(`${selector} {`)[1]?.split('}')[0] ?? '';
    expect(field).toContain('flex-direction: row');
    expect(field).toContain('flex-wrap: wrap');
    expect(field).toContain('align-items: center');
    const label = dateCss.split(`${selector} > label {`)[1]?.split('}')[0] ?? '';
    expect(label).toContain('flex: 0 0 auto');
    expect(label).toContain('white-space: nowrap');
    expect(label).toContain('margin: 0');
    const helper = dateCss.split(`${selector} > .uui-date-hint {`)[1]?.split('}')[0] ?? '';
    expect(helper).toContain('flex-basis: 100%');
    const segments = dateCss.split(`${selector} > .date-seg-group {`)[1]?.split('}')[0] ?? '';
    expect(segments).toContain('min-width: max-content');
    expect(segments).toContain('width: auto');
    expect([field, label, helper].join(';')).not.toMatch(/(?:^|;)\s*(?:position:\s*absolute|(?:min-|max-)?height:|overflow:\s*(?:hidden|clip))/);
  });

  it('stays flat chrome — no card, no divider bands (case QA-2026-09-22-02)', () => {
    // Operator 2026-09-22: the border-block bands + 12px padding + 20px margin
    // read as unfinished scaffolding around the search field. The nepocorp
    // reference bar is borderless (gap rhythm + 16px margin carry separation).
    // Still not a card: no radius, no border.
    const filterBar = css.match(/\.filter-bar\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(filterBar).toMatch(/background:\s*transparent;/);
    expect(filterBar).toMatch(/border:\s*0;/);
    expect(filterBar).not.toMatch(/border-block/);
    expect(filterBar).not.toMatch(/border-radius\s*:/);
    expect(filterBar).not.toMatch(/border:\s*1px/);
  });

  it('the toolbar card band totals 44-48px at every width (fix-to-spec 101026043050)', () => {
    // The /dispatch-detail toolbar IS the shared band (the page declares no
    // strip layout of its own — pinned in
    // features/dispatch/detailed-plan/DetailedPlanGrid.date-pair.verify.styles.test.ts),
    // so the band-height contract lives here with the card's padding terms.
    // Arithmetic probe from the CSS values themselves, never by eye:
    //   band = tallest pinned control (--filter-control-h → --control-compact-h)
    //        + 2 x padding-block + 2 x border-block
    // Spec: 44-48px at desktop AND phone, with the controls staying at their
    // 28-32px compact contract — so the window must hold for EVERY control
    // height in that range, at BOTH padding tiers. That invariant is what
    // pins the vertical padding term (7px/side is the only value that keeps
    // 28px through 32px controls inside 44-48px).
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    const compact = Number(tokens.match(/--control-compact-h:\s*(\d+)px/)?.[1]);
    expect(compact, '--control-compact-h resolves').toBeGreaterThanOrEqual(28);
    expect(compact, '--control-compact-h resolves').toBeLessThanOrEqual(32);

    const card = css.match(/\.filter-bar--card\s*\{([^}]*)\}/)?.[1] ?? '';
    const desktopPadBlock = Number(card.match(/padding:\s*(\d+)px/)?.[1]);
    const borderBlock = Number(card.match(/border:\s*(\d+)px/)?.[1]);
    const phoneCard = css.match(/@media \(max-width: 640px\)\s*\{[\s\S]*?\.filter-bar--card\s*\{([^}]*)\}/)?.[1] ?? '';
    const phonePadBlock = Number(phoneCard.match(/padding:\s*(\d+)px/)?.[1]);

    for (const [tier, padBlock] of [['desktop', desktopPadBlock], ['phone ≤640px', phonePadBlock]] as const) {
      expect(padBlock, `${tier} tier declares a padding term`).toBeGreaterThan(0);
      for (const control of [28, 29, 30, 31, 32]) {
        const band = control + 2 * padBlock + 2 * borderBlock;
        expect(band, `${tier} band with a ${control}px control`).toBeGreaterThanOrEqual(44);
        expect(band, `${tier} band with a ${control}px control`).toBeLessThanOrEqual(48);
      }
    }
  });

  it('keeps count badges rectangular — the §1 pill ban pins this file (card _48)', () => {
    // Review round 20260922_38 nit T2: the quick-filter count badge was a
    // 999px pill. The fix (0d51e334) made it a small-radius rectangle; this
    // pin keeps it that way.
    expect(css).not.toContain('999px');
    const count = css.match(/\.filter-chip__count\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(count).toContain('border-radius: 4px');
  });
});
