/**
 * SIL-676 wiring pins — source-scan lane (unit-only tree: no db, no app boot;
 * same precedent as quote-engine-wiring). Three wires must hold:
 *
 *  1. resolveTablePrice selects through the PURE law (pricing-table-selection)
 *     — the selector-less lane resolves its head row instead of 0, explicit
 *     selectors stay exact-match.
 *  2. The engine prices from the customer's price sheet through the PURE
 *     selection law (exact keyed row → base class → general row → giá đầu
 *     bảng); the vehicle-size-class catalog no longer gates pricing, and
 *     ApiError(404) remains ONLY on the terms lookup, so the lifecycle
 *     fallback's zeroed ids are truthful.
 *  3. GET /api/settlements is a registered alias reading for OPS (self list)
 *     and ADMIN (office list), and the SPA /settlements path routes roles to
 *     real surfaces.
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
  test('base price selects through the pure law; the class catalog no longer gates pricing', () => {
    // Round-3c staging proof: the mirror's vehicle_size_classes lacks plain
    // CONT20/CONT40, and the old `if (!vehicleClass)` gate zeroed every leg
    // although the sheet had the row. The gate must stay dead.
    assert.doesNotMatch(engine, /if \(!vehicleClass\)/);
    assert.match(engine, /import \{ partitionTablePricingLane \} from '\.\/pricing-table-selection'/);
    // ONE lane read + the selection chain: exact class → base class →
    // general row → giá đầu bảng.
    assert.match(engine, /partitionTablePricingLane\(laneRows, null, priceClassCode\)/);
    assert.match(engine, /partitionTablePricingLane\(laneRows, null, vehicleSizeClassCode\)/);
    const chain = engine.match(/let basePriceRow = exactBuckets\.rateKey\[0\][\s\S]*?No base price/)![0];
    assert.match(chain, /baseBuckets\?\.rateKey\[0\]/);
    assert.match(chain, /exactBuckets\.general\[0\]/);
    // SIL-796 r2 (owner law 04/11): a KEYED ask never falls through to the
    // lane-head row — pricing a leg with ANOTHER class's signed row is the
    // exact wrong-case autofill the law bans. The stop must be present and
    // the lane-head stop must be gone.
    assert.match(chain, /SIL-796 r2/);
    assert.doesNotMatch(chain, /laneHeadOrder\[0\]/);
    // The base-price MANUAL still carries the resolved terms id and whatever
    // row id the chain reached (read side rebuilds the hint from trace ids).
    // The chain's stop law: a found row with price 0 is an operator statement
    // — it wins the chain and yields MANUAL; no fallback below it.
    assert.match(engine, /if \(!basePriceRow \|\| Number\(basePriceRow\.price\) === 0\)/);
    const baseMiss = engine.match(/No base price ⇒ MANUAL mode[\s\S]*?\n  \}/)![0];
    assert.match(baseMiss, /source: 'MANUAL'/);
    assert.match(baseMiss, /rateTermsId: terms\.id/);
    assert.match(baseMiss, /pricingTableId: basePriceRow\?\.id \?\? 0/);
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
  test('backend mounts the role-aware alias at /api/settlements', () => {
    assert.match(opsRoutes, /export const settlementsListAliasRoutes = Router\(\)/);
    // Round-3c: the alias must read for OPS AND ADMIN — OPS self-scoped
    // (the /api/ops/settlements policy), ADMIN unscoped (the
    // /api/ops/admin/settlements policy); other roles stay 403.
    assert.match(opsRoutes, /settlementsListAliasRoutes\.get\('\/', requireRoles\(Role\.OPS, Role\.ADMIN\), asyncHandler/);
    // Wave 7: the ADMIN office-wide read now appends the derived completed-
    // pair economics records (source TRIP_PAIR); the batch read policies are
    // unchanged — ADMIN unscoped, OPS self-scoped.
    assert.match(opsRoutes, /const batches = await listOpsSettlements\(\{ status \}\)/);
    assert.match(opsRoutes, /const items = await listOpsSettlements\(\{ opsUserId: user\.userId, status \}\)/);
    assert.match(index, /app\.use\('\/api\/settlements', authMiddleware, settlementsListAliasRoutes\)/);
    // The canonical /api/ops/settlements list keeps its OPS-only policy.
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
