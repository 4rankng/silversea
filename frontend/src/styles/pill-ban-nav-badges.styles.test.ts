import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const sidebar = read('src/components/layout/sidebar.css');
const pill = read('src/components/Pill.css');
const topbar = read('src/components/layout/topbar.css');

const ruleBody = (css: string, selector: string): string =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('§1 pill ban — nav/count/label badge chips are 4px rectangles (card 20260922_81)', () => {
  it('sidebar .nav-item__badge is a 4px chip; the rail strips keep their sanctioned StatusStrip shape', () => {
    const badge = ruleBody(sidebar, '.nav-item__badge');
    expect(badge).toContain('border-radius: 4px');
    expect(badge).not.toContain('999px');
    // The two `0 999px 999px 0` rail indicators are the sanctioned StatusStrip
    // shape (§10 parity convention), not badges — guard them against overreach.
    expect(sidebar.match(/0 999px 999px 0/g)).toHaveLength(2);
  });

  it('Pill .badge is a 4px chip (.pill itself is out of card _81 scope)', () => {
    const badge = ruleBody(pill, '.badge');
    expect(badge).toContain('border-radius: 4px');
    expect(badge).not.toContain('999px');
  });

  it('topbar .icon-btn .badge is a 4px chip', () => {
    const badge = ruleBody(topbar, '.icon-btn .badge');
    expect(badge).toContain('border-radius: 4px');
    expect(badge).not.toContain('999px');
  });
});
