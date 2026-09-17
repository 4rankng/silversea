/**
 * Unit tests for the qk.* key factory and `invalidateAllCatalogs`.
 *
 * Verifies:
 *  - Key identity: the same accessor called with the same args returns a
 *    deeply-equal key (so TanStack's structural cache lookup works).
 *  - Parameterized accessors embed their arguments in order.
 *  - `invalidateAllCatalogs` calls `invalidateQueries` exactly once for each
 *    catalog key, with a single-element `queryKey` matching the catalog root.
 */
import { describe, it, expect, vi } from 'vitest';
import { qk, invalidateAllCatalogs } from './keys';

describe('qk.* factory — key identity', () => {
  it('static keys are referentially equal across calls', () => {
    expect(qk.catalogs.all).toEqual(['catalogs']);
    expect(qk.catalogs.all).toBe(qk.catalogs.all);
  });

  it('trips.all matches any trips-prefixed query (TanStack prefix matching)', () => {
    // TanStack uses structural prefix matching, so qk.trips.all should be a
    // tuple that begins with 'trips'.
    expect(qk.trips.all[0]).toBe('trips');
    expect(qk.trips.list('CREATED', 1)).toEqual(['trips', 'CREATED', 1]);
  });

  it('parameterized accessors embed their args in order', () => {
    expect(qk.salary.list(2026, 6)).toEqual(['salary-list', 2026, 6]);
    expect(qk.trips.detail(42)).toEqual(['trip', '42']);
    expect(qk.trips.tripDetail(99)).toEqual(['trip-detail', '99']);
    // Regression: a numeric id (API response) and a string id (URL param) MUST
    // produce the same key, or post-save cache writes / the 409 retry silently
    // miss the real detail query and keep a stale `version`. See keys.ts.
    expect(qk.trips.detail(42)).toEqual(qk.trips.detail('42'));
  });

  it('different args produce different keys', () => {
    expect(qk.salary.list(2026, 5)).not.toEqual(qk.salary.list(2026, 6));
    expect(qk.trips.detail(1)).not.toEqual(qk.trips.detail(2));
  });

  it('shipmentsCus keys separate workboard pages (all-prefix invalidation)', () => {
    expect(qk.shipmentsCus.all[0]).toBe('shipments-cus');
    expect(qk.shipmentsCus.list({ page: 1 })[0]).toBe('shipments-cus');
    expect(qk.shipmentsCus.list({ page: 1, searchSuffix: 'AB12' }))
      .not.toEqual(qk.shipmentsCus.list({ page: 2, searchSuffix: 'AB12' }));
    expect(qk.shipmentsCus.list({ page: 1, bucket: 'RUNNING' as never }))
      .not.toEqual(qk.shipmentsCus.list({ page: 1, bucket: 'LOCKED' as never }));
  });

  it('does not register a retired credit-approval queue', () => {
    expect(qk).not.toHaveProperty('creditOverrides');
  });

  it('allCatalogKeys is a readonly tuple of strings', () => {
    expect(qk.allCatalogKeys.length).toBeGreaterThan(10);
    for (const k of qk.allCatalogKeys) {
      expect(typeof k).toBe('string');
    }
  });
});

describe('invalidateAllCatalogs', () => {
  it('calls invalidateQueries once per catalog key', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const qc = { invalidateQueries } as unknown as Parameters<
      typeof invalidateAllCatalogs
    >[0];

    await invalidateAllCatalogs(qc);

    expect(invalidateQueries).toHaveBeenCalledTimes(qk.allCatalogKeys.length);
  });

  it('each call uses a single-element query key matching the catalog root', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const qc = { invalidateQueries } as unknown as Parameters<
      typeof invalidateAllCatalogs
    >[0];

    await invalidateAllCatalogs(qc);

    for (const key of qk.allCatalogKeys) {
      // eslint-disable-next-line @tingting/no-bare-query-key -- test assertion verifying invalidateAllCatalogs wraps each catalog prefix in [key]
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });

  it('returns a promise that resolves after all invalidations', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const qc = { invalidateQueries } as unknown as Parameters<
      typeof invalidateAllCatalogs
    >[0];

    const result = invalidateAllCatalogs(qc);
    expect(result).toBeInstanceOf(Promise);

    const resolved = await result;
    expect(Array.isArray(resolved)).toBe(true);
    expect(resolved).toHaveLength(qk.allCatalogKeys.length);
  });
});

describe('qk.* — type guard at compile time', () => {
  // This is a runtime no-op; it exists so the test file imports qk and
  // fails if there is a circular import or runtime error.
  it('module loads without side effects', () => {
    expect(typeof qk).toBe('object');
    expect(typeof invalidateAllCatalogs).toBe('function');
  });
});
