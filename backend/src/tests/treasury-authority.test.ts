import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { client } from '../db';
import { ApiError } from '../errors';
import {
  calculateTreasuryBookBalance,
  normalizeTreasuryPhysicalReference,
} from '../services/treasury.service';

after(async () => {
  await client.end();
});

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

  it('current schema keeps canonical source uniqueness while versioning append-only reversals', async () => {
    const indexRows = await client<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'treasury_movements'
        and indexname in (
          'treasury_movements_receipt_posted_uniq',
          'treasury_movements_ledger_posted_uniq',
          'treasury_movements_reversal_uniq'
        )
      order by indexname
    `;
    assert.deepEqual(
      indexRows.map((row) => row.indexname),
      [
        'treasury_movements_ledger_posted_uniq',
        'treasury_movements_receipt_posted_uniq',
        'treasury_movements_reversal_uniq',
      ],
    );
    assert.match(
      indexRows.find((row) => row.indexname === 'treasury_movements_receipt_posted_uniq')!.indexdef,
      /where .*payment_receipt_id.*is not null.*status.*'POSTED'.*reversal_of_id.*is null/i,
    );
    assert.match(
      indexRows.find((row) => row.indexname === 'treasury_movements_ledger_posted_uniq')!.indexdef,
      /where .*ledger_entry_id.*is not null.*status.*'POSTED'.*reversal_of_id.*is null/i,
    );
    assert.match(
      indexRows.find((row) => row.indexname === 'treasury_movements_reversal_uniq')!.indexdef,
      /\(reversal_of_id, source_version\).*where .*reversal_of_id.*is not null/i,
    );

    const constraintRows = await client<{ conname: string }[]>`
      select conname
      from pg_constraint
      where connamespace = 'public'::regnamespace
        and conrelid = 'public.treasury_movements'::regclass
        and conname = 'treasury_movements_reversal_of_id_treasury_movements_id_fk'
    `;
    assert.equal(
      constraintRows.length,
      1,
      'expected treasury reversal rows to stay fenced by the self-referential FK',
    );
  });
});
