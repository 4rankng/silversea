import { beforeEach, describe, expect, it, vi } from 'vitest';

// The preview request builder goes through the shared api facade — pin it so
// the URL assertions read the exact string the wire would carry.
const getMock = vi.fn();
vi.mock('../../lib/api', () => ({
  api: { get: (...args: Array<unknown>) => getMock(...args) },
}));

import { toQuery } from './query';
import { pricingClient } from '../../api/pricingClient';

describe('toQuery', () => {
  it('stringifies finite numbers, booleans and strings; skips null/undefined/empty', () => {
    expect(toQuery({ page: 1, active: true, search: 'foo', status: '', q: undefined, id: null }))
      .toBe('?page=1&active=true&search=foo');
    expect(toQuery()).toBe('');
    expect(toQuery({})).toBe('');
  });

  // SIL-1147 — a numeric param computed from a missing value must never ride
  // the wire as the literal string 'NaN' (that was the preview 400 for every
  // lot). The builder drops non-finite numbers like any absent value.
  it('drops non-finite numbers (NaN/±Infinity) instead of serializing them', () => {
    expect(toQuery({ customerId: NaN, routeId: 2 })).toBe('?routeId=2');
    expect(toQuery({ a: Number.POSITIVE_INFINITY, b: 1 })).toBe('?b=1');
    expect(toQuery({ a: Number.NEGATIVE_INFINITY })).toBe('');
    expect(toQuery({ v: 0 })).toBe('?v=0');
    // A search term that literally reads "NaN" is a string — it stays.
    expect(toQuery({ q: 'NaN' })).toBe('?q=NaN');
  });
});

describe('pricingClient.previewFreight — request builder (no NaN ever)', () => {
  beforeEach(() => {
    getMock.mockClear();
  });

  it('serializes every finite input key into the query', () => {
    pricingClient.previewFreight({
      customerId: 5, routeId: 6, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10',
    });
    const url = getMock.mock.calls[0]![0] as string;
    expect(url.startsWith('/pricing/freight-preview?')).toBe(true);
    expect(url).toContain('customerId=5');
    expect(url).toContain('routeId=6');
    expect(url).toContain('vehicleSizeClassCode=CONT40');
    expect(url).toContain('transportDate=2026-09-10');
  });

  it('a not-yet-computable numeric input never fires a NaN query param', () => {
    pricingClient.previewFreight({
      customerId: Number(undefined), routeId: 6, vehicleSizeClassCode: 'CONT20', transportDate: '2026-09-10',
    });
    const url = getMock.mock.calls[0]![0] as string;
    expect(url).not.toContain('NaN');
    expect(url).toContain('routeId=6');
    // The dropped param hands the backend a missing-input validation instead
    // of the old NaN 400.
    expect(url).not.toContain('customerId');
  });
});
