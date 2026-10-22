import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// QA R32 (BaoGia.md + QA R32 "không engine") — wiring pins, source-scan
// lane (unit-only tree: no db connection, no app boot — same precedent as
// lcl-rev-perlot-money-wiring). The engine (resolveFreightRate +
// persistFreightRateSnapshot) must stay wired into every lot create/update
// surface, and the new preview-rate probe must resolve through the SAME
// engine — QA verifies "có engine" without creating a lot.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const lifecycle = read('../../services/freight-rate-snapshot-lifecycle.service.ts');
const engine = read('../../services/freight-pricing-engine.service.ts');
const quotationService = read('../../services/quotation.service.ts');
const quotationRoutes = read('../../routes/config/quotations.routes.ts');
const createSvc = read('../../services/shipment-create.service.ts');
const updateSvc = read('../../services/shipment-update.service.ts');
const containersSvc = read('../../services/shipment-containers.service.ts');
const dispatchSvc = read('../../services/dispatch-planning-commands.service.ts');
const cusWrites = read('../../services/cus-shipment-workspace-writes.service.ts');

test('lot lifecycle resolves through the pricing engine then persists a snapshot', () => {
  assert.match(lifecycle, /resolveFreightRateWithManualFallback\(\{/);
  assert.match(lifecycle, /from '\.\/freight-pricing-engine\.service'/);
  assert.match(lifecycle, /await persistFreightRateSnapshot\(resolved,/);
  // Thiếu căn cứ → SKIP qua classifier thuần, không bịa số (QA R32).
  assert.match(lifecycle, /classifyLotPricingBasis\(\{/);
  assert.match(lifecycle, /import \{ classifyLotPricingBasis \} from '\.\/freight-lot-basis'/);
});

test('every lot create/update surface locks the rate (FCL intake, reconcile, CUS edits, EDD change, dispatch)', () => {
  assert.match(createSvc, /await lockShipmentFreightRate\(tx, \{ shipmentId: shipment\.id \}\)/);
  assert.match(containersSvc, /await lockShipmentFreightRate\(tx,/);
  assert.match(updateSvc, /await lockShipmentFreightRate\(tx, \{ shipmentId: id \}\)/);
  assert.match(dispatchSvc, /await lockShipmentFreightRate\(tx, \{/);
  const calls = cusWrites.match(/await lockShipmentFreightRate\(tx,/g) ?? [];
  assert.ok(calls.length >= 4, `CUS workspace writes must keep their lock calls (found ${calls.length})`);
});

test('dispatch is the definitive lock with the dispatcher rate key + loud weight gate', () => {
  const lockStart = dispatchSvc.indexOf('await lockShipmentFreightRate(tx, {');
  const lockEnd = dispatchSvc.indexOf('requirePrice: true') + 'requirePrice: true'.length;
  const lock = dispatchSvc.slice(lockStart, lockEnd);
  assert.match(lock, /rateKeyOverride: input\.pricingRateKey/);
  assert.match(lock, /requirePrice: true/);
});

test('engine prices per the effective quotation frame: Hệ số + rounding + fuel lag', () => {
  // Frame lookup keys on customerId + effectiveDate ≤ transport date.
  assert.match(engine, /lte\(s\.quotations\.effectiveDate, transportDate\)/);
  // QA R32: frame lag wins; terms lag stays the fallback (BaoGia.md §2).
  assert.match(engine, /effectiveFuelLagDays\(quotationFrame\?\.fuelPriceLagDays, terms\.fuelLagDays\)/);
  assert.match(engine, /from '\.\/freight-lot-basis'/);
  // Giá dầu áp dụng = giá dầu kỳ (ngày vận chuyển − lag).
  assert.match(engine, /const targetDate = subtractDays\(transportDate, lagDays\)/);
  // Công thức mapping comment trỏ về CuocPhiPhuPhiDau.md §2.
  assert.match(engine, /C \(km khứ hồi\)|billedKmOneWay × billingKmMultiplier/);
  assert.match(engine, /H \(phụ phí dầu\) = max\(0, \(G − F\) × E\)/);
});

test('preview-rate probe rides the SAME engine fallback (không tạo lô, không bịa số)', () => {
  assert.match(quotationRoutes, /router\.post\('\/preview-rate'/);
  assert.match(quotationRoutes, /previewQuotationRate\(parsed\.data\)/);
  assert.match(quotationService, /export async function previewQuotationRate/);
  assert.match(quotationService, /await resolveFreightRateWithManualFallback\(\{/);
  // Nhà máy = operational_sites FACTORY → tuyến canonical.
  assert.match(quotationService, /s\.operationalSites/);
  assert.match(quotationService, /site\.siteType !== 'FACTORY'/);
});

test('preview-rate stays read-only and finance-gated like the xlsx import preview', () => {
  const route = quotationRoutes.slice(
    quotationRoutes.indexOf("router.post('/preview-rate'"),
    quotationRoutes.indexOf('res.json(await previewQuotationRate'),
  );
  assert.match(route, /declareNonMaterialWrite/);
  assert.match(route, /requireRoles\(Role\.ACCOUNTANT, Role\.ADMIN\)/);
});

test('quotation frames carry the lag end to end (schema → create/update → views)', () => {
  const schema = read('../../db/schema/quotation.ts');
  assert.match(schema, /fuelPriceLagDays: integer\('fuel_price_lag_days'\)\.notNull\(\)\.default\(1\)/);
  assert.match(quotationService, /fuelPriceLagDays: input\.fuelPriceLagDays \?\? 1/);
  assert.ok((quotationService.match(/fuelPriceLagDays: s\.quotations\.fuelPriceLagDays/g) ?? []).length >= 2,
    'both getQuotation and listQuotations must expose the frame lag');
  // Import commit ghi lag khung từ ô "Lag Day n" (carry-forward khi thiếu).
  assert.match(read('../../services/quotation-import.service.ts'), /resolveImportedFuelLag\(enriched\.fuelLagDays, firstRouteTerms\)/);
});
