import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseCss = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');
const shellCss = readFileSync(resolve(process.cwd(), 'src/components/layout/app-shell.css'), 'utf8');

describe('authenticated app shell scrolling', () => {
  it('keeps the authenticated viewport non-scrollable while the app body owns scrolling', () => {
    // Card 20261004_327 rework (device QA failed on the fixed-root build): the
    // shell is a plain 100%-height, overflow-hidden stack — NO position:fixed
    // root (a fixed root sizes to the iOS layout viewport and clips .app's
    // 100dvh when the bottom toolbar collapses) and no :has() gate.
    expect(baseCss).toMatch(/html, body, #root\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/);
    expect(baseCss).not.toMatch(/#root\s*\{[^}]*position:\s*fixed/);
    expect(baseCss).not.toMatch(/:has\(body \.app\)/);
    expect(shellCss).toMatch(/\.app-body,\s*\.content\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
  });

  it('keeps form font inheritance in the base layer so component size utilities can win', () => {
    expect(baseCss).toMatch(/@layer base\s*\{[\s\S]*?button\s*\{\s*font:\s*inherit;[\s\S]*?input, select, textarea\s*\{\s*font:\s*inherit;/);
    expect(baseCss.replace(/@layer base\s*\{[\s\S]*?\n\}/, '')).not.toMatch(/(?:button|input, select, textarea)\s*\{[^}]*font:\s*inherit;/);
  });
});
