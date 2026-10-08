import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const tokens = read('src/styles/tokens.css');
const SURFACES = [
  'src/design-system/Modal.css',
  'src/components/Drawer.css',
  'src/components/ConfirmDialog.css',
  'src/pages/TruckTiresPage.css',
] as const;

/**
 * Dialog scrim contract — PM ruling 2026-10-03 (card 20261002_277): the
 * backdrop behind a dialog is DARKER than the previous rgba(10,10,10,0.56),
 * and it is one shared value rather than a copy per surface.
 *
 * The old 0.56 was hard-coded in five places that drifted independently. The
 * pin holds two things: the token exists and is at least as opaque as the
 * value it replaced, and no surface carries its own raw rgba again. Pins the
 * declarations, not the pixels — the browser state matrix is the render rung.
 */
describe('dialog scrim dim (card 20261002_277)', () => {
  it('defines one scrim token, darker than the 0.56 it replaces', () => {
    const token = tokens.match(/--scrim-modal:\s*([^;]+);/)?.[1]?.trim();
    expect(token, '--scrim-modal must be defined in tokens.css').toBeTruthy();

    const alpha = Number(token!.match(/([\d.]+)\s*\)$/)?.[1]);
    expect(Number.isFinite(alpha), `could not read an alpha out of "${token}"`).toBe(true);
    expect(alpha, 'the PM asked for a DARKER scrim than 0.56').toBeGreaterThan(0.56);
  });

  it('routes every dialog surface through the token instead of its own rgba', () => {
    for (const file of SURFACES) {
      const css = read(file);
      expect(css, `${file} must dim via the shared scrim token`)
        .toContain('background: var(--scrim-modal);');
      // A raw backdrop value here is exactly the drift this pin exists to stop.
      expect(css, `${file} must not hard-code a scrim rgba again`)
        .not.toMatch(/background:\s*rgba\(\s*10,\s*10,\s*10,\s*0?\.\d+\s*\)/);
    }
  });

  it('keeps the phone-band confirm-overlay on the token too (sweep 03/10 — the missed site)', () => {
    // responsive.css re-declares .confirm-overlay in the phone band with its
    // own blur — the scrim half drifted back to a raw rgba(10,10,10,0.45)
    // after the token migration and was caught by the 277 state matrix.
    const css = read('src/styles/responsive.css');
    expect(css).toMatch(/\.confirm-overlay\s*\{[^}]*background:\s*var\(--scrim-modal\)/);
    expect(css).not.toContain('rgba(10, 10, 10, 0.45)');
  });
});
