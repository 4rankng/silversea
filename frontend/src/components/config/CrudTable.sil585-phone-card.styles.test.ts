import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-585 (owner ticket 29/10): /config/customers at 390 must not serve a
// 978px horizontal-scroll board. The CrudTable tabular-frame exemption
// (card 061026221226) is scoped to ≥768px — the phone band falls through to
// the generic record-table card mode, which is the data-dense label/value
// card the owner approved for config catalogues (2026-09-28). The 06/10
// rejection stands for the band it was ruled on: 768–1100 keeps the
// tabular frame with labels in the thead alone.
const css = readFileSync(resolve(process.cwd(), 'src/components/config/crud-table.css'), 'utf8');
const generic = readFileSync(resolve(process.cwd(), 'src/styles/record-table.css'), 'utf8');

describe('CrudTable phone card band (SIL-585)', () => {
  it('scopes the tabular-frame exemption to ≥640px (the customers verdict boundary)', () => {
    expect(css).toMatch(/@container \(min-width: 640px\) and \(max-width: 1100px\)/);
    // No unscoped ≤1100 exemption may remain — <768 must reach the generic card.
    expect(css).not.toMatch(/@container \(max-width: 1100px\)/);
  });

  it('the generic dense card owns the phone band: label caption rides the value', () => {
    // The generic ≤1100 block carries the card the phone inherits: block
    // table, no thead, inline label caption from the cell's data-label.
    const band = generic.slice(generic.indexOf('@container (max-width: 1100px)'));
    expect(band).toMatch(/\.record-table\s*\{[^}]*display:\s*block;/);
    expect(band).toMatch(/\.record-table thead\s*\{[^}]*display:\s*none;/);
    expect(band).toMatch(/\.record-table tbody td::before\s*\{[^}]*content:\s*attr\(data-label\)/);
  });
});
