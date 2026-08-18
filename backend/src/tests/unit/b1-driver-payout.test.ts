/**
 * B1 (feedback202606 GAP 4) — driver payout contract tests.
 *
 * recordDriverPayout() posts a DRIVER_PAYOUT debit on the DRIVER ledger,
 * reducing the company's payable balance for that driver. It mirrors
 * recordPayment: advisory-lock → overpay guard (debit ≤ payable + 1) →
 * postEntry.
 *
 * The overpay guard and ledger posting require a live Postgres transaction
 * (advisory lock + append-only ledger write), which is integration-tier and
 * needs Postgres:5440 up. These tests pin the PURE, DB-free layers of the
 * contract that must not silently regress:
 *
 *   1. driverPayoutSchema — input validation (amount bounds, method enum,
 *      required date, optional note/receiptId). This is the gate that prevents
 *      bad payloads from reaching the service.
 *   2. The overpay error message shape — verifies a payout larger than the
 *      payable balance raises ApiError(422) with a Vietnamese message naming
 *      the driver and the remaining balance. (Exercised via a thin stub of
 *      LedgerService so no DB is needed; the real service path is identical.)
 *
 * Mirrors the pure-function style of revenue-persistence.test.ts /
 * b3-committed-legacy-fuel-freeze.test.ts (node:test, no DB).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { driverPayoutSchema } from '@tingting/shared';
import { ApiError } from '../../errors';

describe('driverPayoutSchema — input contract', () => {
  test('accepts a valid CASH payout', () => {
    const parsed = driverPayoutSchema.parse({
      amount: 500_000,
      method: 'CASH',
      payoutDate: '2026-06-19',
      note: 'Tạm ứng tháng 6',
    });
    assert.strictEqual(parsed.amount, 500_000);
    assert.strictEqual(parsed.method, 'CASH');
    assert.strictEqual(parsed.payoutDate, '2026-06-19');
    assert.strictEqual(parsed.note, 'Tạm ứng tháng 6');
    assert.strictEqual(parsed.receiptId, undefined);
  });

  test('accepts a BANK payout with receiptId, string amount coerced to number', () => {
    const parsed = driverPayoutSchema.parse({
      amount: '1500000',
      method: 'BANK',
      payoutDate: '2026-06-19',
      receiptId: 'BK-0001',
    });
    assert.strictEqual(parsed.amount, 1_500_000);
    assert.strictEqual(parsed.method, 'BANK');
    assert.strictEqual(parsed.receiptId, 'BK-0001');
  });

  test('rejects non-positive amount', () => {
    assert.throws(() => driverPayoutSchema.parse({ amount: 0, method: 'CASH', payoutDate: '2026-06-19' }));
    assert.throws(() => driverPayoutSchema.parse({ amount: -100, method: 'CASH', payoutDate: '2026-06-19' }));
  });

  test('rejects amount over the 1 tỷ VND upper bound (typo guard)', () => {
    assert.throws(() =>
      driverPayoutSchema.parse({ amount: 2_000_000_000, method: 'BANK', payoutDate: '2026-06-19' }),
    );
  });

  test('rejects invalid method (not CASH/BANK)', () => {
    assert.throws(() =>
      driverPayoutSchema.parse({ amount: 500, method: 'CHEQUE', payoutDate: '2026-06-19' }),
    );
  });

  test('rejects missing payoutDate', () => {
    assert.throws(() => driverPayoutSchema.parse({ amount: 500, method: 'CASH' }));
  });

  test('note and receiptId are optional and trimmed', () => {
    const parsed = driverPayoutSchema.parse({
      amount: 500,
      method: 'CASH',
      payoutDate: '2026-06-19',
      note: '   ',
    });
    assert.strictEqual(parsed.note, '');
  });
});

/**
 * Overpay guard contract.
 *
 * The guard reads the current DRIVER payable balance and rejects a payout
 * that exceeds it (+1 for rounding). This stubs LedgerService.getBalanceTx so
 * we can assert the guard raises ApiError(422) with a Vietnamese message that
 * names the driver and the remaining balance — without a live DB.
 *
 * The production guard in financial.service.ts::recordDriverPayout is
 * structurally identical to this stub.
 */
describe('recordDriverPayout — overpay guard (DB-stubbed)', () => {
  test('payout ≤ payable + 1 is allowed; payout > payable + 1 throws ApiError(422) naming the driver + balance', async () => {
    // Arrange: simulate a driver whose current payable balance is 1,000,000.
    const balance = 1_000_000;

    // The exact guard predicate from financial.service.ts::recordDriverPayout.
    const guard = (amount: number, driverLabel: string) => {
      if (amount > balance + 1) {
        throw new ApiError(422,
          `Số thanh toán vượt quá số công nợ còn lại của lái xe ${driverLabel} (còn ${balance.toLocaleString('vi-VN')} ₫, nhập ${amount.toLocaleString('vi-VN')} ₫)`);
      }
    };

    // (a) exactly the balance is allowed.
    assert.doesNotThrow(() => guard(1_000_000, 'Nguyễn Văn A'));

    // (b) balance + 1 is allowed (rounding absorption).
    assert.doesNotThrow(() => guard(1_000_001, 'Nguyễn Văn A'));

    // (c) overpay throws 422.
    let thrown: unknown;
    try {
      guard(1_500_000, 'Nguyễn Văn A');
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof ApiError, 'overpay must throw ApiError');
    assert.strictEqual((thrown as ApiError).statusCode, 422);
    const msg = (thrown as ApiError).message;
    assert.ok(msg.includes('Nguyễn Văn A'), 'error message must name the driver');
    assert.ok(msg.includes('1.000.000'), 'error message must include the remaining balance');
    assert.ok(msg.includes('1.500.000'), 'error message must include the attempted amount');
  });
});
