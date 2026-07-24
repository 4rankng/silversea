/**
 * A0 / GAP 8a — revenue-persistence contract (feedback202606 A3 §9).
 *
 * Symptom: "đã nhập dữ liệu về doanh thu và lưu lại, refresh nhưng hệ thống
 * vẫn không ghi nhận" — entered revenue saved, but on refresh it was gone.
 *
 * Root cause: revenue is split-based in the UI (empty-return leg +
 * combined-load leg); `revenue` is derived. The figures-update payload used to
 * send untouched splits as `0` (a defined value) and a derived `revenue` copy,
 * so `updateTripFigures` resolved `revenue = 0 + 0` on every save of a trip
 * whose splits were blank — silently overwriting stored revenue.
 *
 * Fix contract (load-bearing): `undefined` = "not provided / leave stored
 * alone"; `0` = "explicit zero". The frontend now sends `undefined` for blank
 * splits and omits the derived `revenue`. These tests pin the server-side
 * resolution (`resolveRevenue`) and override decision (`shouldMarkRevenueOverride`)
 * as pure functions so the contract cannot silently regress.
 *
 * Pure data-driven tests (no DB), mirroring b3-committed-legacy-fuel-freeze.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveRevenue, shouldMarkRevenueOverride } from '../services/trip-mutations.service';

describe('resolveRevenue — undefined = not-provided, 0 = explicit-zero', () => {
  const stored = { revenue: '1000', revenueEmptyReturn: '600', revenueCombine: '400' };

  test('(a) nothing provided ⇒ preserve stored revenue', () => {
    assert.strictEqual(
      resolveRevenue({ revenue: undefined, revenueEmptyReturn: undefined, revenueCombine: undefined }, stored),
      1000,
    );
  });

  test('(a.2) empty object ⇒ preserve stored revenue', () => {
    assert.strictEqual(resolveRevenue({}, stored), 1000);
  });

  test('(b) both splits provided ⇒ sum', () => {
    assert.strictEqual(resolveRevenue({ revenueEmptyReturn: 400, revenueCombine: 600 }, stored), 1000);
  });

  test('(c) direct revenue, no splits ⇒ use it (non-UI callers)', () => {
    assert.strictEqual(resolveRevenue({ revenue: 1500 }, stored), 1500);
  });

  test('(d) only one split provided ⇒ unprovided split uses stored value', () => {
    // emptyReturn provided as 4.2M, combine untouched ⇒ combine uses stored 400.
    assert.strictEqual(resolveRevenue({ revenueEmptyReturn: 4_200_000 }, stored), 4_200_400);
    // combine provided, emptyReturn untouched ⇒ emptyReturn uses stored 600.
    assert.strictEqual(resolveRevenue({ revenueCombine: 1_000_000 }, stored), 1_000_600);
  });

  test('explicit zero splits ⇒ revenue is zero (NOT stored)', () => {
    // The user typed 0 in both fields — this must zero revenue, distinct from
    // "untouched" (undefined). This is why the frontend must send `undefined`,
    // not `0`, for blank fields.
    assert.strictEqual(resolveRevenue({ revenueEmptyReturn: 0, revenueCombine: 0 }, stored), 0);
  });

  test('explicit zero in one split + undefined other ⇒ 0 + stored', () => {
    assert.strictEqual(resolveRevenue({ revenueEmptyReturn: 0 }, stored), 0 + 400);
  });

  test('direct revenue is ignored when a split is also provided (split model wins)', () => {
    // revenue is derived from splits; a stray direct value must not override.
    assert.strictEqual(resolveRevenue({ revenue: 9_999, revenueEmptyReturn: 100, revenueCombine: 200 }, stored), 300);
  });

  test('null-ish stored fields coerce to 0, not NaN', () => {
    const emptyStored = { revenue: null, revenueEmptyReturn: null, revenueCombine: null };
    assert.strictEqual(resolveRevenue({}, emptyStored), 0);
    assert.strictEqual(resolveRevenue({ revenueEmptyReturn: 5 }, emptyStored), 5);
  });

  test('blank combine (undefined) preserves stored revenue even when stored combine is NULL (legacy-row guard)', () => {
    // Pins the useTripFormDispatch populate fix: a legacy trip with a NULL
    // revenueCombine must seed the combine field blank (→ undefined on save),
    // NOT '0' (explicit-zero). With combine undefined, resolveRevenue falls
    // through to stored.revenue — preserving it. The old '0' seeding would
    // have sent combine:0 and, with a blank emptyReturn, zeroed the revenue.
    const legacyStored = { revenue: '1000', revenueEmptyReturn: null, revenueCombine: null };
    assert.strictEqual(resolveRevenue({ revenueCombine: undefined }, legacyStored), 1000);
    assert.strictEqual(resolveRevenue({ revenueEmptyReturn: undefined, revenueCombine: undefined }, legacyStored), 1000);
  });

  test('(d.2) idempotent: re-applying the same not-provided payload preserves revenue', () => {
    // Models the 409 silent-retry path — re-submitting the same payload must
    // not drift the resolved value.
    const once = resolveRevenue({ revenueEmptyReturn: undefined, revenueCombine: undefined }, stored);
    const twice = resolveRevenue({ revenueEmptyReturn: undefined, revenueCombine: undefined }, { revenue: String(once) });
    assert.strictEqual(twice, once);
  });
});

describe('shouldMarkRevenueOverride — fires only on a real change', () => {
  const stored = { revenue: '1000', revenueEmptyReturn: '600', revenueCombine: '400' };

  test('(e) nothing provided ⇒ no override (the critical guard)', () => {
    // An untouched save must NOT stamp revenueOverriddenBy/At. The override
    // block keys off `!== undefined`, so sending `undefined` for untouched
    // splits must not fire (the Architect-flagged mis-fire risk).
    assert.strictEqual(
      shouldMarkRevenueOverride({ revenue: undefined, revenueEmptyReturn: undefined, revenueCombine: undefined }, stored),
      false,
    );
  });

  test('direct revenue change ⇒ override', () => {
    assert.strictEqual(shouldMarkRevenueOverride({ revenue: 1500 }, stored), true);
  });

  test('split change ⇒ override', () => {
    assert.strictEqual(shouldMarkRevenueOverride({ revenueEmptyReturn: 700 }, stored), true);
    assert.strictEqual(shouldMarkRevenueOverride({ revenueCombine: 500 }, stored), true);
  });

  test('split equal to stored ⇒ no override', () => {
    assert.strictEqual(shouldMarkRevenueOverride({ revenueEmptyReturn: 600, revenueCombine: 400 }, stored), false);
  });

  test('explicit zero where stored is non-zero ⇒ override (0 is intentional)', () => {
    assert.strictEqual(shouldMarkRevenueOverride({ revenueEmptyReturn: 0 }, stored), true);
  });
});
