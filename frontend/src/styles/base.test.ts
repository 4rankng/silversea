import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseCss = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');
const shellCss = readFileSync(resolve(process.cwd(), 'src/components/layout/app-shell.css'), 'utf8');

describe('authenticated app shell scrolling', () => {
  it('keeps the authenticated viewport non-scrollable while the app body owns scrolling', () => {
    // Unlike hidden, clip cannot move the viewport when a portalled field gains focus.
    expect(baseCss).toMatch(/html:has\(body \.app\),\s*body:has\(\.app\)\s*\{[^}]*overflow:\s*clip;/);
    expect(baseCss).toMatch(/body:has\(\.app\) #root\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*overflow:\s*clip;/);
    expect(shellCss).toMatch(/\.app-body,\s*\.content\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
    expect(baseCss).not.toMatch(/(?:^|\n)(?:html|body|#root)\s*\{[^}]*overflow:\s*(?:hidden|clip);/);
  });

  it('keeps form font inheritance in the base layer so component size utilities can win', () => {
    expect(baseCss).toMatch(/@layer base\s*\{[\s\S]*?button\s*\{\s*font:\s*inherit;[\s\S]*?input, select, textarea\s*\{\s*font:\s*inherit;/);
    expect(baseCss.replace(/@layer base\s*\{[\s\S]*?\n\}/, '')).not.toMatch(/(?:button|input, select, textarea)\s*\{[^}]*font:\s*inherit;/);
  });
});
