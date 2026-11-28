// SIL-1243 (KB §2.2.7/§2.2.9) — "chi phí khách không trả (thu khách 0 đồng)
// không được cộng vào tổng phải thu; phí lấy hóa đơn là chi phí của lô, không
// phải khoản phải thu của khách". Hai đường tiền feeds Tổng thu / Tổng phải
// thu khách, cả hai đều đọc theo khoản thu khách lúc đọc (read-side law):
//   1. dòng trip_expenses (derivedTripReceivable) — khoản thu khách đã ghi
//      (kể cả 0) thắng luật recharge theo giá vốn;
//   2. dòng ops (opsChargeReceivableContribution) — chỉ nhóm GN/PS không hóa
//      đơn (và dòng legacy không cost group) giữ sentinel round 11:
//      0 = chưa thỏa thuận → tính theo tiền chi.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { derivedTripReceivable, opsChargeReceivableContribution } from '../../services/debit-receivable-arming';

const here = dirname(fileURLToPath(import.meta.url));

describe('derivedTripReceivable — khoản thu khách 0 không cộng vào tổng phải thu', () => {
  it('thu khách 0 (explicit) contributes 0 — đúng 2 dòng QA của lô 1563', () => {
    assert.equal(derivedTripReceivable({ sell: '0', buy: '50000' }), 0);
    assert.equal(derivedTripReceivable({ sell: '0', buy: '200000' }), 0);
  });

  it('khoản thu khách đã ghi luôn thắng giá vốn', () => {
    assert.equal(derivedTripReceivable({ sell: '120000', buy: '200000' }), 120000);
    assert.equal(derivedTripReceivable({ sell: '30000', buy: '200000' }), 30000);
  });

  it('dòng không ghi khoản thu khách giữ luật recharge theo giá vốn', () => {
    assert.equal(derivedTripReceivable({ sell: null, buy: '450000' }), 450000);
    assert.equal(derivedTripReceivable({ sell: null, buy: '0' }), 0);
  });

  it('dòng giá vốn âm vắng mặt trong tổng (card 20260928_181)', () => {
    assert.equal(derivedTripReceivable({ sell: null, buy: '-50000' }), 0);
    assert.equal(derivedTripReceivable({ sell: null, buy: null }), 0);
  });
});

describe('opsChargeReceivableContribution — 0 nghĩa gì tùy nhóm', () => {
  it('explicit 0 ngoài nhóm GN/PS contributes nothing — chi phí của lô, không phải phải thu', () => {
    assert.equal(opsChargeReceivableContribution({ expenseTypeCode: 'OTHER', charge: '0', amount: '50000', costGroup: 'DRIVER_SHIPMENT' }), null);
    assert.equal(opsChargeReceivableContribution({ expenseTypeCode: 'INVOICE_SERVICE', charge: '0', amount: '200000', costGroup: 'INVOICE_SERVICE' }), null);
    assert.equal(opsChargeReceivableContribution({ expenseTypeCode: 'OTHER', charge: '0', amount: '100000', costGroup: 'DRIVER_ROAD' }), null);
  });

  it('GN/PS + dòng legacy không cost group giữ round 11: 0 = chưa thỏa thuận → tính theo tiền chi', () => {
    assert.equal(opsChargeReceivableContribution({ expenseTypeCode: 'HAI_QUAN_LUONG_XANH', charge: '0', amount: '450000', costGroup: 'OPS_REGULAR' }), 450000);
    assert.equal(opsChargeReceivableContribution({ expenseTypeCode: 'CHON_VO', charge: '0', amount: '50000', costGroup: 'OPS_INCIDENTAL' }), 50000);
    assert.equal(opsChargeReceivableContribution({ expenseTypeCode: 'CHON_VO', charge: '0', amount: '50000' }), 50000);
    assert.equal(opsChargeReceivableContribution({ expenseTypeCode: 'CHON_VO', charge: null, amount: '50000' }), 50000);
  });

  it('khoản thu đã thỏa thuận vào nguyên giá trị mọi nhóm; Lạch Huyện không bao giờ tính theo giá vốn', () => {
    assert.equal(opsChargeReceivableContribution({ expenseTypeCode: 'OTHER', charge: '120000', amount: '50000', costGroup: 'DRIVER_SHIPMENT' }), 120000);
    assert.equal(opsChargeReceivableContribution({ expenseTypeCode: 'ZONE_SURCHARGE', charge: '0', amount: '900000' }), null);
    assert.equal(opsChargeReceivableContribution({ expenseTypeCode: 'ZONE_SURCHARGE', charge: '300000', amount: '900000' }), 300000);
  });
});

test('cả 3 bề mặt đọc dùng chung luật derivedTripReceivable (không lệch luật)', () => {
  for (const file of ['accounting-debit-close.service.ts', 'debit-merge.service.ts', 'shipment-debit-summary.service.ts']) {
    const source = readFileSync(join(here, '..', '..', 'services', file), 'utf8');
    assert.ok(source.includes('derivedTripReceivable(row)'), `${file} must route its derived limb through the shared law`);
  }
});
