import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const topbarCss = readFileSync(resolve(process.cwd(), 'src/components/layout/topbar.css'), 'utf8');
const responsiveCss = readFileSync(resolve(process.cwd(), 'src/styles/responsive.css'), 'utf8');
const entranceHook = readFileSync(resolve(process.cwd(), 'src/hooks/useTopbarEntrance.ts'), 'utf8');

describe('topbar visibility contract', () => {
  it('keeps the layout shell visible before optional entrance animation runs', () => {
    expect(topbarCss).toMatch(/\.topbar\s*\{[\s\S]*?opacity:\s*1;/);
    expect(entranceHook).toContain('utils.set(root, { opacity: 1, translateY: 0 });');
    expect(entranceHook).not.toMatch(/animate\(root,/);
  });

  it('does not clip the current-page name on a narrow mobile topbar', () => {
    expect(responsiveCss).toContain('.topbar__context strong {\n    overflow: visible;\n    text-overflow: clip;\n    white-space: normal;');
  });
});
