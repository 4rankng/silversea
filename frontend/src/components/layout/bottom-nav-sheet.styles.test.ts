import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Mobile user-sheet entrance guard. The sheet's buttons (Đăng xuất above
 * all) must occupy their final position from the first frame: an entrance
 * that transforms the sheet (translateY slide-up) keeps the buttons
 * off-screen or moving while a real finger taps their resting spot, and the
 * tap fires on nothing — the mobile "Đăng xuất silently does nothing" bug
 * (20261109_4 BUG 1 reopen, 2026-09-13). Opacity-only entrances are always
 * safe: hit-testing ignores opacity.
 */
const css = readFileSync(resolve(process.cwd(), 'src/components/layout/bottom-nav.css'), 'utf8');

function keyframeBody(name: string): string {
  const match = css.match(new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  return match?.[1] ?? '';
}

describe('mobile user-sheet entrance keeps tap targets static', () => {
  it('sheetUp animates opacity only — no transform on the sheet container', () => {
    const body = keyframeBody('sheetUp');
    expect(body).toContain('opacity');
    expect(body).not.toMatch(/transform/i);
  });

  it('sheetItemIn animates opacity only — items do not drift under a finger', () => {
    const body = keyframeBody('sheetItemIn');
    expect(body).toContain('opacity');
    expect(body).not.toMatch(/transform/i);
  });

  it('the sheet element itself declares no entrance transform', () => {
    const sheetBlock = css.match(/\.mobile-user-sheet\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(sheetBlock).not.toMatch(/translate/);
  });
});
