/**
 * SIL-676 wiring pins — source-scan lane (unit-only tree: no db, no app boot;
 * same precedent as quote-engine-wiring). Three wires must hold:
 *
 *  1. resolveTablePrice selects through the PURE law (pricing-table-selection)
 *     — the selector-less lane resolves its head row instead of 0, explicit
 *     selectors stay exact-match.
 *  2. The engine's vehicle-class miss returns MANUAL carrying the resolved
 *     terms id — ApiError(404) remains ONLY on the terms lookup, so the
 *     lifecycle fallback's zeroed ids are truthful.
 *  3. GET /api/settlements is a registered alias of the ops self list, and
 *     the SPA /settlements path routes roles to real surfaces.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const pricingService = read('../../services/pricing.service.ts');
const engine = read('../../services/freight-pricing-engine.service.ts');
const lifecycle = read('../../services/freight-rate-snapshot-lifecycle.service.ts');
const index = read('../../index.ts');
const opsRoutes = read('../../routes/ops.ts');
const app = read('../../../../frontend/src/App.tsx');

describe('SIL-676 wiring — pricing lookup resolves keyed lanes', () => {
  test('resolveTablePrice partitions + selects through the pure law', () => {
    assert.match(pricingService, /import \{ partitionTablePricingLane, pickTablePricingRow \} from '\.\/pricing-table-selection'/);
    assert.match(pricingService, /partitionTablePricingLane\(laneRows, input\.containerTypeId \?\? null, requestedRateKey\)/);
    assert.match(pricingService, /pickTablePricingRow\(buckets, \{/);
    // The both-null-only general query is gone — its absence is the regression.
    assert.doesNotMatch(pricingService, /isNull\(s\.pricingTables\.containerTypeId\), isNull\(s\.pricingTables\.rateKey\)/);
  });

  test('trip creation snapshots the route tolls stations (dispatch linkage)', () => {
    const createSvc = read('../../services/trip-create.service.ts');
    assert.match(createSvc, /tollsStations: route\?\.tollsStations \?\? 0/);
  });

  test('figures update preserves the stored tolls snapshot when the caller omits it', () => {
    const figures = read('../../services/trip-figure-updates.service.ts');
    assert.match(figures, /tollsStations: data\.tollsStations \?\? trip\.tollsStations \?\? 0/);
    assert.match(figures, /tollsStations: data\.tollsStations \?\? Number\(trip\.tollsStations \?\? 0\)/);
  });
});

describe('SIL-676 wiring — engine trace ids stay truthful', () => {
  test('vehicle-class miss degrades to MANUAL with the resolved terms id', () => {
    // The MANUAL return sits INSIDE the !vehicleClass block, before the
    // missing-base-price MANUAL — both carry the real terms id.
    const classMiss = engine.match(/if \(!vehicleClass\) \{[\s\S]*?\n  \}/)![0];
    assert.match(classMiss, /source: 'MANUAL'/);
    assert.match(classMiss, /rateTermsId: terms\.id/);
    assert.match(classMiss, /Không tìm thấy loại xe/);
  });

  test('ApiError(404) survives ONLY on the freight_rate_terms lookup', () => {
    const throws = engine.match(/ApiError\(\s*404/g) ?? [];
    assert.equal(throws.length, 1, `engine must keep exactly one 404 throw (terms), found ${throws.length}`);
    const termsThrow: string | null = engine.match(/if \(!terms\) \{[\s\S]*?Không tìm thấy điều khoản cước/)?.[0] ?? null;
    assert.ok(termsThrow, 'the single 404 throw must sit on the terms lookup');
    assert.match(termsThrow, /Không tìm thấy điều khoản cước/);
  });

  test('lifecycle fallback comment documents the truthful-zero invariant', () => {
    assert.match(lifecycle, /rateTermsId 0 ⟺ the terms lookup itself missed/);
  });
});

describe('SIL-676 wiring — /settlements registered on both sides', () => {
  test('backend mounts the ops-list alias at /api/settlements', () => {
    assert.match(opsRoutes, /export const settlementsListAliasRoutes = Router\(\)/);
    assert.match(opsRoutes, /settlementsListAliasRoutes\.get\('\/', OPS_ONLY, asyncHandler\(listOpsSettlementsHandler\)\)/);
    assert.match(index, /app\.use\('\/api\/settlements', authMiddleware, settlementsListAliasRoutes\)/);
    // Same gate as the canonical /api/ops/settlements list.
    assert.match(opsRoutes, /router\.get\('\/settlements', OPS_ONLY, asyncHandler\(listOpsSettlementsHandler\)\)/);
  });

  test('SPA /settlements is a role redirect, not a 404', () => {
    assert.match(app, /export function settlementsRedirectTarget\(role: string\): string/);
    assert.match(app, /<Route path="\/settlements" element=\{page\(<SettlementsRedirect role=\{currentRole\} \/>\)} \/>/);
    for (const surface of ['routes.opsWallet', 'routes.shipmentDebit', 'routes.myPayslips', 'routes.dispatch', 'routes.portalShipments']) {
      assert.match(app, new RegExp(surface.replace(/\./g, '\\.')));
    }
  });
});
