import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/layout/sidebar.css'), 'utf8');

describe('sidebar user menu layering', () => {
  it('keeps the profile menu above sticky operational workspace controls', () => {
    expect(css).toMatch(/\.sidebar-footer\s*\{[^}]*z-index:\s*var\(--z-overlay\);/);
  });
});
