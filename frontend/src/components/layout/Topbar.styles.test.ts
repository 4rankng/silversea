import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const topbarCss = readFileSync(resolve(process.cwd(), 'src/components/layout/topbar.css'), 'utf8');
const responsiveCss = readFileSync(resolve(process.cwd(), 'src/styles/responsive.css'), 'utf8');
const entranceHook = readFileSync(resolve(process.cwd(), 'src/hooks/useTopbarEntrance.ts'), 'utf8');

describe('topbar visibility contract', () => {
  it('keeps current-page context on every non-driver route', () => {
    const shell = readFileSync(resolve(process.cwd(), 'src/components/Layout.tsx'), 'utf8');
    const source = readFileSync(resolve(process.cwd(), 'src/components/layout/Topbar.tsx'), 'utf8');
    expect(shell).not.toContain('hideContext');
    expect(source).not.toContain('hideContext');
    expect(source).toContain('aria-label="Trang hiện tại"');
  });
  it('lets a long driver identity shrink without overlapping the month control', () => {
    expect(topbarCss).toMatch(/\.topbar__left-driver\s*\{[^}]*flex:\s*1 1 auto;/);
    expect(topbarCss).toMatch(/\.topbar__welcome \.name\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/);
    const source = readFileSync(resolve(process.cwd(), 'src/components/layout/Topbar.tsx'), 'utf8');
    expect(source).toContain('className="name" title={name ?? undefined}');
  });

  it('keeps the layout shell visible before optional entrance animation runs', () => {
    expect(topbarCss).toMatch(/\.topbar\s*\{[\s\S]*?opacity:\s*1;/);
    expect(entranceHook).toContain('utils.set(root, { opacity: 1, translateY: 0 });');
    expect(entranceHook).not.toMatch(/animate\(root,/);
  });

  it('does not clip the current-page name on a narrow mobile topbar', () => {
    expect(responsiveCss).toContain('.topbar__context strong {\n    overflow: visible;\n    text-overflow: clip;\n    white-space: normal;');
  });

  it('expands the global search on focus while keeping the 360px rest cap (case 2026-10-11-R14-07)', () => {
    // Owner ruling 2026-10-11 (FB-057): the 360px cap is a rest-state clamp —
    // it must relax while the field is in use and return on blur, without
    // jumping the topbar height.
    expect(topbarCss).toMatch(/\.topbar__search\s*\{[^}]*max-width:\s*360px;/);
    expect(topbarCss).toMatch(/\.topbar__search:focus-within\s*\{[^}]*max-width:\s*(min\(560px|560px)/);
  });

  it('gives the global search a 360px floor and fluid growth from 1280px — no hard cap (FB-057, owner ruling 2026-10-14)', () => {
    // The re-report ruling supersedes every fixed ceiling at wide viewports:
    // the desktop floor is 360px (never the old 200px shrink), and from the
    // 1280px tier up the field grows with the free topbar space instead of
    // stopping at 360/560px.
    expect(topbarCss).toMatch(/\.topbar__search\s*\{[^}]*min-width:\s*360px;/);
    expect(topbarCss).not.toMatch(/\.topbar__search\s*\{[^}]*min-width:\s*200px;/);
    expect(topbarCss).toMatch(/@media\s*\(min-width:\s*1280px\)\s*\{\s*\.topbar__search\s*\{[^}]*max-width:\s*none;/);
    // Mobile tiers keep their smaller minimum — a 390px phone cannot hold a
    // 360px search beside the context and actions.
    expect(responsiveCss).toMatch(/\.topbar__search\s*\{[^}]*min-width:\s*120px;/);
  });
});
