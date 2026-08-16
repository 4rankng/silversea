import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseCss = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');

describe('authenticated app shell scrolling', () => {
  it('contains document scrolling at the root while preserving unscoped login-page flow', () => {
    expect(baseCss).toMatch(/html:has\(body \.app\),\s*body:has\(\.app\)\s*\{[^}]*overflow:\s*hidden;/);
    expect(baseCss).toMatch(/body:has\(\.app\) #root\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*overflow:\s*hidden;/);
  });

  it('keeps form font inheritance in the base layer so component size utilities can win', () => {
    expect(baseCss).toMatch(/@layer base\s*\{[\s\S]*?button\s*\{\s*font:\s*inherit;[\s\S]*?input, select, textarea\s*\{\s*font:\s*inherit;/);
    expect(baseCss.replace(/@layer base\s*\{[\s\S]*?\n\}/, '')).not.toMatch(/(?:button|input, select, textarea)\s*\{[^}]*font:\s*inherit;/);
  });
});
