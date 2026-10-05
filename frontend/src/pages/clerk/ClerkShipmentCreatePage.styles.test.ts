import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 051026230627 (VISUAL/UX) — "Ngày giờ đóng trả" on /shipments/new
 * rendered as five tiny spinbox-sized segments (hh 20px, dd 20px, 28px tall on
 * a 175x30 cluster). The expectation allows the spacious-cluster alternative
 * to a picker redesign: the create form's appointment cluster must carry
 * comfortable tap geometry — touch-height group, readable segment font — and
 * must claim full row width on phones so nothing squeezes it.
 *
 * Scope guard: these rules live under `.csc-container-row > …` (the create
 * page's own wrapper), so the shared segment geometry in
 * design-system/forms/DateTimeSegments.css (pinned by its own styles test) is
 * untouched — filter bars keep their compact clusters by design.
 */

const css = readFileSync(resolve(process.cwd(), 'src/pages/clerk/ClerkShipmentCreatePage.css'), 'utf8');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('CUS "Ngày giờ đóng trả" cluster geometry (card 051026230627)', () => {
  it('gives the appointment segments touch height and a readable font', () => {
    // The base UUI geometry derives inner heights from --uui-control-h and the
    // segments' font from --text-control-compact-size; the fix overrides those
    // variables on the cluster's control boundaries (per-element height rules
    // lose to the base sheet's ID-level min-height resets).
    expect(rules).toMatch(
      /\.csc-container-cell--appointment [\s\S]{0,160}?--uui-control-h:\s*var\(--control-touch-h/,
    );
    expect(rules).toMatch(
      /\.csc-container-cell--appointment [\s\S]{0,200}?--text-control-compact-size:\s*1[5-9]px/,
    );
  });

  it('claims full row width on phones so the cluster is never squeezed', () => {
    const mobile = rules.slice(rules.indexOf('@media (max-width: 640px)'));
    expect(mobile).toMatch(
      /\.csc-container-row > \.csc-container-cell--appointment\s*\{\s*grid-column:\s*1 \/ -1/,
    );
  });

  it('widens the desktop table column to the larger cluster floor', () => {
    // 176px was the floor for the 12px-font cluster; at 16px the pair needs
    // ~220px or the table scroll box shears the date half off again.
    expect(rules).toMatch(/\.csc-container-col__appointment\s*\{\s*width:\s*2[2-9]\dpx/);
  });
});
