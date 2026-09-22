import { describe, expect, it } from 'vitest';
import { EMPTY_ILLUSTRATIONS, resolveEmptyIllustration, type EmptyContext } from './emptyIllustrations';

const BASE = '/assets/illustrations';

/**
 * The complete context -> art mapping contract (card 20260922_40, docs §6).
 * Every `EmptyContext` appears exactly once: this table is the parity record
 * proving each surface keeps the art it renders today. `Record<EmptyContext,
 * string>` in the module makes the union complete at compile time; this test
 * pins the values, the legacy normalization, and the passthrough contract.
 */
const EXPECTED: Array<[EmptyContext, string]> = [
  // shared set — trips (empty-1.png)
  ['trips', `${BASE}/empty-1.png`],
  ['forwarder', `${BASE}/empty-1.png`],
  ['routes', `${BASE}/empty-1.png`],
  ['matching', `${BASE}/empty-1.png`],
  // shared set — fleet (empty-2.png)
  ['fleet', `${BASE}/empty-2.png`],
  ['trucks', `${BASE}/empty-2.png`],
  ['clients', `${BASE}/empty-2.png`],
  // shared set — ops (empty-3.png)
  ['ops', `${BASE}/empty-3.png`],
  ['dispatch', `${BASE}/empty-3.png`],
  ['search', `${BASE}/empty-3.png`],
  ['users', `${BASE}/empty-3.png`],
  ['config', `${BASE}/empty-3.png`],
  ['notifications', `${BASE}/empty-3.png`],
  ['welcome', `${BASE}/empty-3.png`],
  ['error', `${BASE}/empty-3.png`],
  // shared set — finance (empty-4.png)
  ['finance', `${BASE}/empty-4.png`],
  ['advances', `${BASE}/empty-4.png`],
  ['audit', `${BASE}/empty-4.png`],
  ['debts', `${BASE}/empty-4.png`],
  ['earnings', `${BASE}/empty-4.png`],
  ['expenses', `${BASE}/empty-4.png`],
  ['payables', `${BASE}/empty-4.png`],
  ['penalties', `${BASE}/empty-4.png`],
  ['penalty-reasons', `${BASE}/empty-4.png`],
  ['salary', `${BASE}/empty-4.png`],
  ['pie', `${BASE}/empty-4.png`],
  ['pricing', `${BASE}/empty-4.png`],
  // pre-existing bespoke art slots (byte-identical for visual parity)
  ['revenue-period', `${BASE}/empty-revenue-period.webp`],
  ['cost-composition', `${BASE}/empty-cost-composition.webp`],
  ['vehicle-profit', `${BASE}/empty-vehicle-profit.webp`],
  ['profitable-routes', `${BASE}/empty-profitable-routes.webp`],
  ['forwarder-advance', `${BASE}/forwarder-approved-advance-v1.png`],
  ['forwarder-expense', `${BASE}/forwarder-unmatched-expense-v1.png`],
  ['debit-note-template', `${BASE}/empty-debit-note-template.png`],
];

describe('resolveEmptyIllustration', () => {
  it('maps all 34 typed context keys to their expected art, deterministically', () => {
    expect(EXPECTED).toHaveLength(34);
    const keys = EXPECTED.map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [context, art] of EXPECTED) {
      expect(resolveEmptyIllustration(context), `context=${context}`).toBe(art);
      expect(resolveEmptyIllustration(context)).toBe(art);
    }
  });

  it('resolves the four category keys to the shared set', () => {
    expect(resolveEmptyIllustration('trips')).toBe(EMPTY_ILLUSTRATIONS.trips);
    expect(resolveEmptyIllustration('fleet')).toBe(EMPTY_ILLUSTRATIONS.fleet);
    expect(resolveEmptyIllustration('ops')).toBe(EMPTY_ILLUSTRATIONS.ops);
    expect(resolveEmptyIllustration('finance')).toBe(EMPTY_ILLUSTRATIONS.finance);
  });

  it('normalizes legacy names, paths, and extensions to their context', () => {
    expect(resolveEmptyIllustration('empty-debts')).toBe(`${BASE}/empty-4.png`);
    expect(resolveEmptyIllustration('empty-trips')).toBe(`${BASE}/empty-1.png`);
    expect(resolveEmptyIllustration('empty-penalties')).toBe(`${BASE}/empty-4.png`);
    expect(resolveEmptyIllustration('empty-clients')).toBe(`${BASE}/empty-2.png`);
    expect(resolveEmptyIllustration('empty-config.svg')).toBe(`${BASE}/empty-3.png`);
    expect(resolveEmptyIllustration('/assets/illustrations/empty-clients.svg')).toBe(`${BASE}/empty-2.png`);
    expect(resolveEmptyIllustration('assets/illustrations/empty-clients.svg')).toBe(`${BASE}/empty-2.png`);
    expect(resolveEmptyIllustration('/assets/illustrations/empty-debts.png')).toBe(`${BASE}/empty-4.png`);
  });

  it('returns unknown inputs unchanged (non-empty illustration paths pass through)', () => {
    // Pinned by ShipmentContainersPage.test.tsx — must never start resolving.
    expect(resolveEmptyIllustration('/assets/illustrations/empty-container-search-v1.png')).toBe('/assets/illustrations/empty-container-search-v1.png');
    expect(resolveEmptyIllustration('empty-container-search-v1.png')).toBe('empty-container-search-v1.png');
    expect(resolveEmptyIllustration('/assets/illustrations/forwarder-approved-advance-v1.png')).toBe('/assets/illustrations/forwarder-approved-advance-v1.png');
    expect(resolveEmptyIllustration('/assets/illustrations/login-business-control-v3.webp')).toBe('/assets/illustrations/login-business-control-v3.webp');
    expect(resolveEmptyIllustration('custom-art.png')).toBe('custom-art.png');
  });

  it('falls back to the general ("ops") art when no input is given', () => {
    expect(resolveEmptyIllustration()).toBe(EMPTY_ILLUSTRATIONS.ops);
    expect(resolveEmptyIllustration('')).toBe(EMPTY_ILLUSTRATIONS.ops);
    expect(resolveEmptyIllustration(undefined)).toBe(EMPTY_ILLUSTRATIONS.ops);
  });
});
