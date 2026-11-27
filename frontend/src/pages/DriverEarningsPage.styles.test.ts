import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1206 (audit 2026-11-27 P2-17): the two ledger cards under "Tóm tắt kỳ
// này" sit side by side and must be equally tall. The equal height itself is
// a browser measurement; what the stylesheet owns is the track they share —
// the grid must stretch both cards to one row track, and the card (not an
// inner wrapper) must be the grid item that receives that track.
const css = readFileSync(resolve(process.cwd(), 'src/pages/DriverEarningsPage.css'), 'utf8');

function ruleBodies(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]).join('\n');
}

describe('earnings ledger cards share one stretched row track (SIL-1206)', () => {
  it('stretches both ledger cards to the shared track', () => {
    const grid = ruleBodies('.earnings-ledger-grid');
    expect(grid).toMatch(/align-items:\s*stretch/);
    // `start` / `end` / `baseline` would let the shorter card keep its own
    // content height — the 155px vs 207px mismatch the audit measured.
    expect(grid).not.toMatch(/align-items:\s*(?:start|end|baseline)/);
  });

  it('keeps the card itself as the stretched grid item', () => {
    const card = ruleBodies('.earnings-ledger-card');
    // The card must not opt out of the track it is stretched into.
    expect(card).not.toMatch(/align-self:\s*(?:start|end|baseline)/);
    expect(card).not.toMatch(/height:\s*fit-content/);
    // The visible surface (background + border) belongs to the card, so the
    // stretched box is the painted box.
    const shared = ruleBodies('.earnings-equation-card,\n.earnings-ledger-card,\n.earnings-penalties-panel');
    expect(shared).toMatch(/background:\s*var\(--surface\)/);
    expect(shared).toMatch(/border:\s*1px solid var\(--line\)/);
  });
});
