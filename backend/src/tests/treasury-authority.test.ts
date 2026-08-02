import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { ApiError } from '../errors';
import {
  calculateTreasuryBookBalance,
  normalizeTreasuryPhysicalReference,
} from '../services/treasury.service';

describe('treasury authority invariants', () => {
  it('normalizes an account-scoped physical identity deterministically', () => {
    assert.equal(
      normalizeTreasuryPhysicalReference('  vcB   001  abc-42  '),
      'VCB 001 ABC-42',
    );
    assert.equal(normalizeTreasuryPhysicalReference('   '), null);
  });

  it('rejects a physical identity that cannot fit the persisted authority', () => {
    assert.throws(
      () => normalizeTreasuryPhysicalReference('x'.repeat(161)),
      (error: unknown) => error instanceof ApiError && error.statusCode === 400,
    );
  });

  it('computes only opening balance plus posted inflows minus outflows', () => {
    assert.equal(calculateTreasuryBookBalance(10_000_000, 2_500_000, 800_000), 11_700_000);
    assert.equal(calculateTreasuryBookBalance(0, 0, 400_000), -400_000);
  });

  it('rejects non-integer book inputs instead of silently rounding money', () => {
    assert.throws(
      () => calculateTreasuryBookBalance(0, 10.5, 0),
      (error: unknown) => error instanceof ApiError && error.statusCode === 409,
    );
  });

  it('migration keeps canonical source uniqueness while versioning append-only reversals', async () => {
    const migration = await readFile(
      new URL('../../drizzle/0000_third_wrecking_crew.sql', import.meta.url),
      'utf8',
    );
    assert.match(
      migration,
      /treasury_movements_receipt_posted_uniq[\s\S]+reversal_of_id" is null/i,
    );
    assert.match(
      migration,
      /treasury_movements_ledger_posted_uniq[\s\S]+reversal_of_id" is null/i,
    );
    assert.match(
      migration,
      /treasury_movements_reversal_uniq[\s\S]+\("reversal_of_id","source_version"\)/i,
    );
    assert.match(
      migration,
      /ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_reversal_of_id_treasury_movements_id_fk" FOREIGN KEY \("reversal_of_id"\) REFERENCES "public"\."treasury_movements"\("id"\)/i,
    );
  });
});
