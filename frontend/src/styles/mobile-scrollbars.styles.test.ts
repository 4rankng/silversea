import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/responsive.css'), 'utf8');
const scrollbarQuery = '@media (max-width: 640px), (hover: none) and (pointer: coarse) {';
const scrollbarStart = css.indexOf(scrollbarQuery);
const phoneStart = css.indexOf('@media (max-width: 640px) {');
const policyStart = css.indexOf('/* Mobile scrollbar visibility:');
const policy = css.slice(scrollbarStart, phoneStart);

describe('phone scrollbar visibility contract', () => {
  it('MOBILE-SCROLL-01/02/05/06 scopes root and nested rails to phones or coarse touch devices', () => {
    expect(scrollbarStart).toBeGreaterThan(-1);
    expect(policyStart).toBeGreaterThan(scrollbarStart);
    expect(phoneStart).toBeGreaterThan(policyStart);
    expect(policy).toContain(scrollbarQuery);
    expect(policy).toContain('*::-webkit-scrollbar');
    expect(policy).toContain('scrollbar-gutter: auto !important;');
  });

  it('MOBILE-SCROLL-06 does not apply compact phone controls or layout to landscape/tablet touch screens', () => {
    expect(policy).not.toContain('min-height:');
    expect(policy).not.toContain('--app-body-pad');
    expect(css.slice(phoneStart)).toMatch(/^@media \(max-width: 640px\) \{\s*\/\* ── Compact control floor/);
  });

  it('MOBILE-SCROLL-03 hides WebKit vertical width without overriding horizontal height', () => {
    expect(policy).toContain('@supports selector(::-webkit-scrollbar)');
    expect(policy).toContain('scrollbar-width: auto !important;');
    expect(policy).toContain('scrollbar-color: auto !important;');
    expect(policy).toMatch(/\*::-webkit-scrollbar\s*\{\s*width:\s*0 !important;\s*\}/);
    expect(policy).not.toMatch(/(?:height|display)\s*:/);
  });

  it('MOBILE-SCROLL-04 uses the standard fallback only without WebKit scrollbar support', () => {
    expect(policy).toMatch(/@supports not selector\(::-webkit-scrollbar\)\s*\{\s*\*\s*\{\s*scrollbar-width:\s*none !important;/);
  });

  it('MOBILE-SCROLL-01/02 preserves content access and scrolling interactions', () => {
    expect(policy).not.toMatch(/(?:overflow(?:-[xy])?|touch-action|pointer-events|overscroll-behavior|position)\s*:/);
  });
});
