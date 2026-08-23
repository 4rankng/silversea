import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/table-sort.css'), 'utf8');

describe('shared sort-header button styling', () => {
  it('inherits the th typography contract instead of carrying its own font sizing', () => {
    const button = css.match(/\.table-sort-button\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(button).toMatch(/font:\s*inherit;/);
    expect(button).toMatch(/color:\s*inherit;/);
    expect(button).not.toMatch(/font-size/);
  });

  it('keeps hover a neutral ink lift, never an accent wash', () => {
    const hover = css.match(/\.table-sort-button:hover\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(hover).toMatch(/color:\s*var\(--ink\);/);
    expect(css).not.toMatch(/accent-soft|brand-primary/);
  });

  it('quiets the idle direction icon until the column is the active sort', () => {
    const idle = css.match(/\.table-sort-button__icon--idle\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(idle).toMatch(/opacity:\s*0\.4;/);
  });
});
