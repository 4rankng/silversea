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
  // SIL-693: classifier chạy trên grounds từ ONE shared derivation
  // (`deriveLotPricingGrounds`, dùng chung với cost-lock freeze).
  assert.match(lifecycle, /classifyLotPricingBasis\(grounds\)/);
  assert.match(lifecycle, /deriveLotPricingGrounds\(tx, args\.shipmentId, args\)/);
  assert.match(lifecycle, /import \{ bookingFamilyRoot, classifyLotPricingBasis, positiveWeightKg, type LotPricingGrounds \} from '\.\/freight-lot-basis'/);
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

test('SIL-1039 (K5.18): heavy cell without own price inherits the light twin + nhãn — never "Thiếu giá"', () => {
  // Split columns price-select their own class first (engine card-_58 chain).
  assert.match(quotationService, /priceVehicleSizeClassCode: code/);
  // Own-price probe runs the SIL-676 pure law (exact bucket only).
  assert.match(quotationService, /hasOwnPrice = \(code: string\)/);
  assert.match(quotationService, /pickTablePricingRow\(partitionTablePricingLane\(laneRows, null, code\)/);
  // The inheritance stamps the flag + the K5.18 label ground truth.
  assert.match(quotationService, /giaCosInherited: inherited != null/);
  assert.match(quotationService, /'kế thừa hạng nhẹ \/ giá tạm' \(K5\.18\)/);
  // Ruling-2's force-null of heavy Giá cos is gone.
  assert.doesNotMatch(quotationService, /missingPrice: split \|\| missing/);
});

test('SIL-1040 (K5.24/K5.48): Đồng ý = giá mới + đúng một phiên bản báo giá mới; Không/Để sau = giữ giá cũ', () => {
  // K5.48 — mỗi báo giá bị ảnh hưởng sinh đúng MỘT phiên bản khi Đồng ý.
  assert.match(quotationRoutes, /releaseQuotationVersion\(view, \{ triggerKind: 'FUEL_APPROVED'/);
  // 'Để sau' = không gọi decide (dòng ở lại PENDING); decide chỉ AGREED/DECLINED.
  assert.match(quotationRoutes, /decision: z\.enum\(\['AGREED', 'DECLINED'\]\)/);
  // 'Không' = giữ nguyên — period của khách chưa đồng ý (PENDING/DECLINED)
  // bị engine chặn, không tự áp giá mới.
  assert.match(engine, /inArray\(s\.quotationFuelApprovals\.status, \['PENDING', 'DECLINED'\]\)/);
});

test('SIL-958: unconfirmed surcharge grounds price H per KB §5.2.5 — pending note rides formulaText, never a 0 substitution', () => {
  // The pending early-return (surcharge 0, fuelPricePeriodId 0, no period
  // consumed) must stay dead: pending grounds only annotate the formula.
  assert.match(engine, /const pendingGrounds: string\[\] = \[\]/);
  assert.match(engine, /— phụ phí dầu chờ xác nhận \(\$\{pendingGrounds\.join\('; '\)\}\)/);
  assert.match(engine, /formulaText: pendingGrounds\.length > 0 \? formula : undefined/);
  assert.doesNotMatch(engine, /phụ phí dầu chờ xác nhận[\s\S]*fuelPricePeriodId: 0/);
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
