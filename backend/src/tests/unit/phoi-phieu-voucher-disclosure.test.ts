// SIL-1085 (K2.71) — the phơi-phiếu board's per-khoản disclosure.
//
// The RULE (K2.71): lập phiếu chi phải đối chiếu trước — chỉ khoản ĐÃ xác
// nhận mới được lập phiếu; khoản CHƯA xác nhận bị loại phải được GỌI TÊN.
// The rule itself was already right (only a confirmed khoản is issued); what
// was missing is the NAME: the counter said "5 khoản" over eight chi-hộ khoản
// and the three unconfirmed ones disappeared in silence.
//
// These cases pin the DISCLOSURE rule — which khoản the phiếu carries, and
// the reason every other one is left out — plus the invariant that keeps the
// counter and the disclosure from telling two stories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { phoiPhieuVoucherSource } from '../../services/phoi-phieu-control.service';

const candidate = (over: Partial<Parameters<typeof phoiPhieuVoucherSource>[0]> = {}) => ({
  sourceId: 11,
  entryId: 22,
  sourceKind: 'OPS' as const,
  feeName: 'Phí nâng',
  invoiceNumber: 'HD-QA1110-01',
  confirmed: true,
  amount: 500_000,
  customerChargeAmount: 500_000,
  allocatedAdvanceAmount: 0,
  cash: { IN: 0, OUT: 0 },
  ...over,
});

test('an unconfirmed khoản is left out and named "chưa xác nhận" — the case K2.71 names', () => {
  const source = phoiPhieuVoucherSource(candidate({ confirmed: false }), 'OUT');
  assert.equal(source.included, false);
  assert.equal(source.reason, 'UNCONFIRMED');
  assert.equal(source.amount, 0);
  // The display name travels with it — the KB asks for the fee name, never an
  // internal code (OpsVanHanh §9.2 rule 1).
  assert.equal(source.feeName, 'Phí nâng');
  assert.equal(source.invoiceNumber, 'HD-QA1110-01');
});

test('"chưa xác nhận" comes FIRST: an unconfirmed lái-xe khai row is missing its đối chiếu too', () => {
  const source = phoiPhieuVoucherSource(
    candidate({ confirmed: false, sourceKind: 'DRIVER', amount: 0, customerChargeAmount: 0 }),
    'OUT',
  );
  assert.equal(source.reason, 'UNCONFIRMED');
});

test('a confirmed lái-xe khai row is not a chi-hộ khoản — it has its own payment road', () => {
  const source = phoiPhieuVoucherSource(
    candidate({ sourceKind: 'DRIVER', amount: 0, customerChargeAmount: 0 }),
    'OUT',
  );
  assert.equal(source.included, false);
  assert.equal(source.reason, 'NOT_CHI_HO');
});

// SIL-1099 (K2.113 Điểm thêm) — the payment road is the OUT-only law. On the
// phiếu-THU side the row's own thu-khách charge rides like any other
// receivable ('+ Chi phí' creates DRIVER_SHIPMENT khoản; the phiếu thu head
// must accept them — QA 26/11: trip 204's driver-only lot 409'd).
test('a confirmed lái-xe khai khoản IS carried on the phiếu-thu side, with its charge', () => {
  const source = phoiPhieuVoucherSource(
    candidate({ sourceKind: 'DRIVER', amount: 0, customerChargeAmount: 300_000 }),
    'IN',
  );
  assert.equal(source.included, true);
  assert.equal(source.reason, null);
  assert.equal(source.amount, 300_000);
});

test('cash already collected reduces a lái-xe khai khoản on the phiếu-thu side too', () => {
  const partial = phoiPhieuVoucherSource(
    candidate({ sourceKind: 'DRIVER', amount: 0, customerChargeAmount: 300_000, cash: { IN: 100_000, OUT: 0 } }),
    'IN',
  );
  assert.equal(partial.included, true);
  assert.equal(partial.amount, 200_000);
  const settled = phoiPhieuVoucherSource(
    candidate({ sourceKind: 'DRIVER', amount: 0, customerChargeAmount: 300_000, cash: { IN: 300_000, OUT: 0 } }),
    'IN',
  );
  assert.equal(settled.included, false);
  assert.equal(settled.reason, 'SETTLED');
});

test('a lái-xe khai row with no thu-khách charge is left out of the phiếu thu by name', () => {
  const source = phoiPhieuVoucherSource(
    candidate({ sourceKind: 'DRIVER', amount: 0, customerChargeAmount: 0 }),
    'IN',
  );
  assert.equal(source.included, false);
  assert.equal(source.reason, 'NO_RECEIVABLE');
});

test('a confirmed khoản that still carries money IS carried, with the remaining amount', () => {
  const source = phoiPhieuVoucherSource(candidate(), 'OUT');
  assert.equal(source.included, true);
  assert.equal(source.reason, null);
  assert.equal(source.amount, 500_000);
});

test('the advance and the cash already paid reduce the carried amount', () => {
  const advanced = phoiPhieuVoucherSource(candidate({ allocatedAdvanceAmount: 200_000 }), 'OUT');
  assert.equal(advanced.amount, 300_000);
  assert.equal(advanced.included, true);
  const paid = phoiPhieuVoucherSource(candidate({ cash: { IN: 0, OUT: 500_000 } }), 'OUT');
  assert.equal(paid.included, false);
  assert.equal(paid.reason, 'SETTLED');
});

test('a khoản with no money on this side is left out, each side naming its own reason', () => {
  const noCost = phoiPhieuVoucherSource(candidate({ amount: 0 }), 'OUT');
  assert.equal(noCost.included, false);
  assert.equal(noCost.reason, 'NO_PAYABLE');
  const noCharge = phoiPhieuVoucherSource(candidate({ customerChargeAmount: 0 }), 'IN');
  assert.equal(noCharge.included, false);
  assert.equal(noCharge.reason, 'NO_RECEIVABLE');
});

test('the phiếu-thu direction carries the khoản that has a customer charge left', () => {
  const source = phoiPhieuVoucherSource(
    candidate({ customerChargeAmount: 300_000, cash: { IN: 100_000, OUT: 0 } }),
    'IN',
  );
  assert.equal(source.included, true);
  assert.equal(source.amount, 200_000);
});

// The counter (`eligibleIn`/`eligibleOut`) and the disclosure are ONE rule —
// the board's "Lập phiếu chi (5 khoản)" and the preview's "Sẽ được lập phiếu
// (5 khoản)" must never disagree. Source-scan pin: the board row computes the
// counter and the disposition from the same confirmed ∧ còn khoản mở walk.
test('the board row carries the disposition beside the counter it must agree with', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/services/phoi-phieu-control.service.ts'),
    'utf8',
  );
  assert.match(source, /voucherSources: \{ IN: PhoiPhieuVoucherSource\[\]; OUT: PhoiPhieuVoucherSource\[\] \}/,
    'the board row type carries the per-direction disposition');
  assert.match(source, /voucherSources,\n\s*\}\);/, 'the row payload ships it');
  assert.match(source, /phoiPhieuVoucherSource\(candidate, 'OUT'\)/, 'the OUT disposition rides the same rule');
  assert.match(source, /phoiPhieuVoucherSource\(candidate, 'IN'\)/, 'the IN disposition rides the same rule');
});
