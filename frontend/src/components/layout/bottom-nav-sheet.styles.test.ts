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

  it('actions are visible immediately without a staggered entrance', () => {
    const buttonBlock = css.match(/\.mobile-user-sheet-btn\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(buttonBlock).toContain('opacity: 1;');
    expect(buttonBlock).not.toMatch(/animation(?:-delay)?:/);
    expect(css).not.toContain('sheetItemIn');
  });

  it('the sheet element itself declares no entrance transform', () => {
    const sheetBlock = css.match(/\.mobile-user-sheet\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(sheetBlock).not.toMatch(/translate/);
  });

  it('keeps account controls reachable in a short viewport and honors reduced motion', () => {
    expect(css).toMatch(/\.mobile-user-sheet\s*\{[^}]*max-height:\s*calc\(100dvh/);
    expect(css).toMatch(/\.mobile-user-sheet-scroll\s*\{[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/);
    expect(css).toMatch(/\.mobile-user-sheet-close\s*\{[^}]*min-height:\s*44px;/);
    expect(css).toMatch(/\.mobile-user-sheet-btn\s*\{[^}]*min-height:\s*48px;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none;/);
    expect(css).not.toContain('profile-bento');
  });
});
