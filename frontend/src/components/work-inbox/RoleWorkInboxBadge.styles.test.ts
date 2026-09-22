import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/work-inbox/RoleWorkInbox.css'), 'utf8');

// Card 20260922_27: status labels use the house text+dot convention — no
// pill background, no full rounding; the dot carries the semantic color.
describe('work inbox status badge styling contract', () => {
  it('renders status as text plus a color dot, not a pill', () => {
    const block = css.match(/\.role-work-inbox__badge \{([^}]*)\}/)?.[1] ?? '';
    expect(block).not.toMatch(/border-radius\s*:\s*999/);
    expect(block).not.toMatch(/background:\s*var\(--bg-3\)/);
    expect(css).toMatch(/\.role-work-inbox__badge::before \{[^}]*background:\s*currentColor/);
  });

  it('keeps semantic colors: action=red, waiting=amber, done=green', () => {
    expect(css).toMatch(/\.role-work-inbox__badge\.is-action \{[^}]*var\(--danger\)/);
    expect(css).toMatch(/\.role-work-inbox__badge\.is-waiting \{[^}]*var\(--warning-text/);
    expect(css).toMatch(/\.role-work-inbox__badge\.is-done \{[^}]*var\(--success\)/);
  });
});
