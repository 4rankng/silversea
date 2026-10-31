import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-619 (id 723, owner 31/10) — the /shipments/new page bottom clears the
 * viewport-fixed action bar at EVERY width. The old rule gated the measured
 * clearance to ≤1279px, so the ≥1280 onescreen band zero-padded the tail and
 * the closing Ghi chú section stayed 29px under the bar at scroll end
 * (qa/2026-10-31_sil619-629/before/619-notes-scroll-end-1307.png).
 */
const CSS = readFileSync(
  join(__dirname, '../../../pages/clerk/ClerkShipmentCreatePage.css'),
  'utf8',
);
const ONESCREEN = readFileSync(
  join(__dirname, '../../../pages/clerk/ClerkShipmentCreatePage.onescreen.css'),
  'utf8',
);

const CLEARANCE = '.csc-page { padding-bottom: calc(var(--csc-action-bar-height, 60px) + 12px); }';

describe('SIL-619 fixed action-bar clearance', () => {
  it('publishes the measured-bar clearance unconditionally (no width gate)', () => {
    expect(CSS).toContain(CLEARANCE);
    // The old ≤1279px media gate stays dead — the clearance is never
    // re-nested into a width condition again.
    expect(CSS).not.toContain('@media (max-width: 1279px)');
  });

  it('the ≥1280 onescreen band keeps the clearance in its page shorthand', () => {
    // onescreen.css loads after the base sheet, so its `.csc-page` shorthand
    // must re-state the clearance or it would out-rank it with `4px`.
    expect(ONESCREEN).toMatch(
      /\.csc-page \{ padding: 4px 0 calc\(var\(--csc-action-bar-height, 60px\) \+ 12px\); \}/,
    );
  });

  it('the narrow-width shorthands never zero the bottom lane back', () => {
    // ≤640 keeps its density shorthand (12px 0) — the later unconditional
    // longhand below it owns the bottom; assert the longhand is declared
    // AFTER the last `.csc-page` shorthand so the cascade resolves to it.
    const shorthand = CSS.indexOf('@media (max-width: 640px) { .csc-page { padding: 12px 0; }');
    const longhand = CSS.indexOf(CLEARANCE);
    expect(shorthand).toBeGreaterThan(-1);
    expect(longhand).toBeGreaterThan(shorthand);
  });
});
