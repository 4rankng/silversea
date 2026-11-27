import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Audit 2026-11-27 (AUI-10/P2-11) — /ops/fleet-tracking: the scroll pane is
// the scrollport (overflow: auto + max-height) so the sticky header band and
// the sticky plate column pin INSIDE the pane instead of tearing against the
// app-body scrollport, and the header surface stays opaque so rows never
// bleed through a pinned header.
const css = readFileSync(resolve(process.cwd(), 'src/pages/OpsFleetTrackingPage.css'), 'utf8');

function ruleBody(selector: string, source = css): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = source.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

describe('OpsFleetTrackingPage — the table pane owns its scrollport (audit 2026-11-27)', () => {
  it('scrolls both axes and caps the pane height', () => {
    const scroll = ruleBody('.ops-fleet__scroll');
    expect(scroll).toMatch(/overflow:\s*auto/);
    expect(scroll).toMatch(/max-height:\s*calc\(100dvh - var\(--topbar-h\) - 120px\)/);
    expect(scroll).toMatch(/container-type:\s*inline-size/);
  });

  it('pins an opaque header band inside the wide-container band', () => {
    const band = css.slice(css.indexOf('@container (min-width: 701px)'));
    expect(band).toMatch(/\.ops-fleet \.ops-fleet__table thead th\s*\{\s*position:\s*sticky;\s*top:\s*0;\s*z-index:\s*3;\s*background:\s*var\(--surface-2\);\s*border-bottom:\s*1px solid var\(--line-strong\);\s*\}/);
  });

  it('sticks the first column with an opaque surface and a border seam', () => {
    const band = css.slice(css.indexOf('@container (min-width: 701px)'));
    expect(band).toMatch(/\.ops-fleet \.ops-fleet__table thead th:first-child,\s*\.ops-fleet \.ops-fleet__table tbody td:first-child\s*\{\s*position:\s*sticky;\s*left:\s*0;\s*\}/);
    expect(band).toMatch(/\.ops-fleet \.ops-fleet__table tbody td:first-child\s*\{\s*z-index:\s*2;\s*background:\s*var\(--surface\);\s*border-right:\s*1px solid var\(--border-1\);\s*\}/);
  });

  it('never uses a box-shadow seam — the global flat-surface reset nulls them', () => {
    const band = css.slice(css.indexOf('@container (min-width: 701px)'));
    expect(band).not.toMatch(/box-shadow/);
  });
});
