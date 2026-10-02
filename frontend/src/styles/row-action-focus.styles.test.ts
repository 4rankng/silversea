import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const table = readFileSync(resolve(process.cwd(), 'src/components/Table.css'), 'utf8');

describe('bounded row-action keyboard focus (UI79)', () => {
  it('keeps every outline edge inside the existing target without shrinking or hiding it', () => {
    const focus = table.match(/\.row-action:focus-visible\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(focus).toContain('outline: 2px solid var(--accent-2)');
    expect(focus).toContain('outline-offset: -2px');
    expect(focus).not.toMatch(/outline:\s*(?:0|none)|overflow:\s*(?:hidden|clip)|(?:min-)?(?:width|height):/);
    const target = table.match(/\.row-action\s*\{([^}]+)\}/)?.[1] ?? '';
    for (const property of ['width', 'min-width', 'height', 'min-height']) expect(target).toContain(`${property}: var(--control-compact-h)`);
  });
});
