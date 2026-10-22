import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// iOS standalone bottom-gap (consult Gemini+DeepSeek 23/10): the canvas
// chain paints one page token, the shell grows to 100lvh / --app-height ONLY
// inside a standalone launch, and a fixed app-toned strip backs the bottom
// nav. Normal browsers must be untouched — every standalone rule is scoped
// to the hybrid `pwa-standalone` class (lib/pwa-standalone.ts; iOS WebKit
// evaluates the display-mode media query false even when launched
// standalone) or the display-mode media query as belt-and-braces.

const cwd = process.cwd();

function read(relativePath: string): string {
  return readFileSync(resolve(cwd, relativePath), 'utf8');
}

const baseCss = read('src/styles/base.css');
const shellCss = read('src/components/layout/app-shell.css');
const navCss = read('src/components/layout/bottom-nav.css');
const mainTsx = read('src/main.tsx');

describe('iOS standalone bottom-gap contract', () => {
  it('unifies the canvas: html, body AND #root paint the same page token', () => {
    expect(baseCss).toMatch(/html,\s*body,\s*#root\s*\{\s*background:\s*var\(--bg\);\s*\}/);
    // The driver-mode :has() mirrors keep #root in the same tone family.
    expect(navCss).toMatch(/#root:has\(\.app\.is-driver\)\s*\{\s*background:\s*var\(--surface\);\s*\}/);
    expect(navCss).toMatch(/#root:has\(\.app\.is-driver \.driver-task-screen\)\s*\{\s*background:\s*var\(--surface-2\);\s*\}/);
  });

  it('grows the shell through the lvh chain to --app-height, standalone only', () => {
    expect(shellCss).toMatch(/html\.pwa-standalone \.app,\s*\n\s*html\.pwa-standalone \.app\.is-driver\s*\{/);
    expect(shellCss).toMatch(/min-height:\s*100lvh;/);
    expect(shellCss).toMatch(/min-height:\s*var\(--app-height,\s*100lvh\);/);
    expect(shellCss).toMatch(/grid-template-rows:\s*var\(--app-height,\s*100lvh\);/);
    // The main column stretches to the track instead of re-imposing dvh.
    expect(shellCss).toMatch(/html\.pwa-standalone \.app-main\s*\{\s*height:\s*auto;\s*\}/);
    // Belt-and-braces form for engines that honor the media query.
    expect(shellCss).toMatch(/@media all and \(display-mode: standalone\)\s*\{\s*\.app,\s*\n\s*\.app\.is-driver\s*\{/);
  });

  it('never leaks the lvh/--app-height shell growth into normal browsers', () => {
    // Every 100lvh / --app-height occurrence must sit inside a
    // .pwa-standalone-scoped rule or the display-mode media query block.
    const classBlock = shellCss.match(/html\.pwa-standalone \.app[^{]*\{[^}]*\}/g) ?? [];
    const mediaStart = shellCss.indexOf('@media all and (display-mode: standalone)');
    const mediaEnd = mediaStart === -1 ? -1 : shellCss.indexOf('\n}', mediaStart);
    expect(classBlock.length).toBeGreaterThanOrEqual(2);
    expect(mediaStart).toBeGreaterThan(-1);
    expect(mediaEnd).toBeGreaterThan(mediaStart);

    const occurrences = shellCss.matchAll(/(?:min-height|grid-template-rows):\s*(?:var\(--app-height[^;]*|100lvh)/g);
    for (const occurrence of occurrences) {
      const index = occurrence.index ?? 0;
      const inClassBlock = classBlock.some((block) => {
        const start = shellCss.indexOf(block);
        return start !== -1 && index >= start && index <= start + block.length;
      });
      const inMediaBlock = index > mediaStart && index < mediaEnd;
      expect(inClassBlock || inMediaBlock, `unscoped standalone rule at ${index}`).toBe(true);
    }
  });

  it('ships a standalone-only, app-toned fallback strip under the bottom nav', () => {
    expect(baseCss).toMatch(/html\.pwa-standalone body::after\s*\{[\s\S]*?height:\s*env\(safe-area-inset-bottom,\s*0px\);/);
    expect(baseCss).toMatch(/html\.pwa-standalone body::after\s*\{[\s\S]*?background:\s*inherit;/);
    expect(baseCss).toMatch(/html\.pwa-standalone body::after\s*\{[\s\S]*?z-index:\s*calc\(var\(--z-sticky,\s*100\) - 1\);/);
    expect(baseCss).toMatch(/html\.pwa-standalone body::after\s*\{[\s\S]*?pointer-events:\s*none;/);
    // Belt-and-braces form, standalone-only.
    expect(baseCss).toMatch(/@media all and \(display-mode: standalone\)\s*\{\s*body::after\s*\{/);
  });

  it('publishes --app-height at load from the visualViewport (main.tsx wiring)', () => {
    expect(mainTsx).toContain('installStandaloneViewportHeight()');
  });
});
