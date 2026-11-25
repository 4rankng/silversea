import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-1004 (id 1165) — the filter date pair's calendar icon must never paint
 * over the year glyphs.
 *
 * Owner repro (build 65756d6b, 390×844): the `Bộ lọc` dialog on /dispatch and
 * the Từ/Đến fields on /accounting/ghep-bo-debit + /shipments-debit showed the
 * calendar icon ON the year characters ("Từ DD/MM/YY[📅]Y"). Two earlier fix
 * families were disproven and must not come back:
 * - hiding the prefix (commit 415bdbd1's claim) — the icon still overlapped;
 * - retyping the SEARCH inputs (commit 82e7c741) — it never reached these
 *   fields because they render outside a `.filter-bar.list-filter-bar`
 *   subtree (portalled dialog bodies, standalone debit toolbars).
 *
 * Contract (one sheet — the shared BufferedUuiDateInput boundary):
 * 1. The boundary is the icon's positioning context (position: relative).
 * 2. The icon trails ABSOLUTELY (right: 8px, vertically centered) — it never
 *    competes with the DD/MM/YYYY run for the flex line.
 * 3. The segment group cannot be squeezed below its glyphs (min-width:
 *    max-content) and reserves the icon strip (margin-right: 20px) — the
 *    overlap mechanism was exactly this squeeze: min-width: 0 let the year
 *    glyphs overflow their box under the icon.
 * 4. The prefixed pair reads --filter-control-font-size (12px at every width,
 *    ticket 6770b9cb) on its digits AND separators. The `#root` prefix plus
 *    the two attribute selectors outrank responsive.css's `#root input`
 *    SIL-558 guard at (1,2,1) — without it the band computed 16px, the run
 *    grew past the cell, and no amount of icon spacing could save the year.
 *    Unprefixed form fields keep the zoom-safe floor.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const dateCss = read('src/design-system/forms/BufferedUuiDateInput.css');

const block = (source: string, selector: string): string =>
  source.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('SIL-1004 date pair icon clearance (shared boundary)', () => {
  it('the boundary is the icon positioning context', () => {
    const boundary = block(dateCss, '[data-date-boundary]');
    expect(boundary).toContain('position: relative');
  });

  it('the calendar icon trails absolutely, outside the text run', () => {
    const icon = block(dateCss, '.uui-date-icon-btn');
    expect(icon).toContain('position: absolute');
    expect(icon).toContain('right: 8px');
    expect(icon).toContain('top: 50%');
    expect(icon).toContain('transform: translateY(-50%)');
    // The disproven in-flow layout must not return.
    expect(icon).not.toContain('margin-left');
    expect(icon).not.toMatch(/^\s*flex:/m);
  });

  it('the segment group is unsqueezable and reserves the icon strip', () => {
    const group = block(dateCss, '[data-date-boundary] .date-seg-group');
    expect(group).toContain('min-width: max-content');
    expect(group).toContain('margin-right: 20px');
    // min-width: 0 here was the overlap mechanism (SIL-1004 repro).
    expect(group).not.toContain('min-width: 0');
  });

  it('prefixed pairs read the filter scale at every width and host', () => {
    expect(dateCss).toContain(
      ':is(#root, body) [data-input-wrapper][data-has-prefix] :is(input.date-seg, .date-sep)'
    );
    const pin = block(
      dateCss,
      ':is(#root, body) [data-input-wrapper][data-has-prefix] :is(input.date-seg, .date-sep)'
    );
    expect(pin).toContain('font-size: var(--filter-control-font-size)');
    // The `body` alternative is load-bearing: the Bộ lọc dialog portals to
    // document.body, outside #root — a #root-only selector misses the exact
    // host the QA repro named.
    expect(pin).not.toContain('#root [data-input-wrapper]');
  });

  it('the coarse 44px touch floor cannot widen the calendar buttons over the text', () => {
    // SIL-583 grows every button to 44px wide on (pointer: coarse); on the
    // absolute trailing icon that box extends LEFT over the year glyphs.
    // The picker's real target is the segments group / boundary cell, so the
    // redundant icon suppresses the horizontal floor only.
    const suppression = dateCss.match(
      /:is\(#root, body\) :is\(\.uui-date-icon-btn, \.date-input-calendar-btn, \.datetime-field-calendar-btn\)\s*\{([^}]*)\}/
    )?.[1] ?? '';
    expect(suppression).toContain('min-width: 0');
    expect(suppression).not.toContain('min-height');
  });
});
