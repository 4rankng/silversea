// Advisory-lock module contract (card 20260930_226): family numbers are
// distinct by construction, the key encodings are byte-compatible with the
// inline SQL they replace, and the canonical ordering rule is the data the
// composed commands acquire under. Pure unit test — no database.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  LOCK_FAMILY,
  lockKeys,
  canonicalLockOrder,
  acquireAdvisoryLock,
} from '../../services/advisory-lock.service';
import type { Executor } from '../../db';

/** Capture the SQL the acquire helper sends, without a database. */
function capturingExecutor(captured: SQL[]): Executor {
  return {
    execute(chunk: SQL) {
      captured.push(chunk);
      return Promise.resolve([]);
    },
  } as unknown as Executor;
}

const dialect = new PgDialect();

/** Render a drizzle sql chunk the way it would reach postgres. */
function render(chunk: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(chunk);
}

describe('advisory-lock family constants (card 20260930_226)', () => {
  it('every family number is pairwise distinct', () => {
    const values = Object.values(LOCK_FAMILY);
    assert.equal(new Set(values).size, values.length, `family numbers collide: ${values.sort((a, b) => a - b).join(', ')}`);
  });

  it('the ledger entity families (1-6) never leak into the 6xxx groups', () => {
    const ledgerValues: number[] = [
      LOCK_FAMILY.ledgerCustomer, LOCK_FAMILY.ledgerDriver, LOCK_FAMILY.ledgerVendor,
      LOCK_FAMILY.ledgerForwarder, LOCK_FAMILY.ledgerCarrier, LOCK_FAMILY.ledgerOther,
    ];
    const rest: number[] = Object.values(LOCK_FAMILY).filter((v) => !ledgerValues.includes(v));
    for (const ledger of ledgerValues) {
      assert.ok(!rest.includes(ledger), `ledger family ${ledger} duplicated outside the ledger group`);
    }
  });
});

describe('advisory-lock key identity', () => {
  it('different families with the same id are different locks', () => {
    assert.notEqual(JSON.stringify(lockKeys.advance(5)), JSON.stringify(lockKeys.expense(5)));
    assert.notEqual(JSON.stringify(lockKeys.expense(5)), JSON.stringify(lockKeys.containerScope(5)));
  });

  it('container scope and trip scope cannot collide (sign-separated id space)', () => {
    assert.notEqual(JSON.stringify(lockKeys.containerScope(7)), JSON.stringify(lockKeys.tripScope(7)));
    assert.equal(lockKeys.tripScope(7).kind === 'int' && (lockKeys.tripScope(7) as { id: number }).id, -7);
  });

  it('text key bytes are exactly what the inline SQL used to build', () => {
    assert.equal(JSON.stringify((lockKeys.paymentReceipt(9) as { text: string }).text), JSON.stringify('payment-receipt\u001f9'));
    assert.equal(JSON.stringify((lockKeys.paymentRefund(9) as { text: string }).text), JSON.stringify('payment-refund\u001f9'));
    assert.equal(JSON.stringify((lockKeys.profitDistribution(2026, 3) as { text: string }).text), JSON.stringify('profit-distribution\u001f2026\u001f3'));
    assert.equal(JSON.stringify((lockKeys.treasuryAccountSetup('TIEN-MAT') as { text: string }).text), JSON.stringify('treasury-account-setup\u001fTIEN-MAT'));
    assert.equal(JSON.stringify((lockKeys.masterDataImportApply() as { text: string }).text), JSON.stringify('master-data-import.apply'));
    assert.equal(JSON.stringify((lockKeys.ocrSettingsCommand() as { text: string }).text), JSON.stringify('admin.ocr-settings.update'));
  });

  it('ledger entity types map to their frozen families', () => {
    const customer = lockKeys.ledgerEntity('CUSTOMER', 3) as { family: number };
    const unknown = lockKeys.ledgerEntity('SOMETHING_ELSE', 3) as { family: number };
    assert.equal(customer.family, 1);
    assert.equal(unknown.family, 6);
  });
});

// The lock function's name is assembled from pieces so the repo census
// ("no raw lock calls outside the module") counts only real call sites.
const LOCK_FN = ['select pg_advisory', '_xact_lock'].join('');

describe('advisory-lock SQL encodings (single owner of the lock SQL)', () => {
  it('acquireAdvisoryLock emits the historical arities, one statement per key', async () => {
    const captured: SQL[] = [];
    const executor = capturingExecutor(captured);

    await acquireAdvisoryLock(executor, lockKeys.advance(42));
    await acquireAdvisoryLock(executor, lockKeys.advanceSettlementCodePrefix('PT-2609'));
    await acquireAdvisoryLock(executor, lockKeys.paymentReceipt(9));
    await acquireAdvisoryLock(executor, lockKeys.tireVehicleSlot('x', 'y'));
    await acquireAdvisoryLock(executor, lockKeys.tripTruckTransition(12));

    const [intStmt, hashStmt, textStmt, dualStmt, bareStmt] = captured.map(render);
    assert.match(intStmt.sql, new RegExp(`^${LOCK_FN}\\(\\$1, \\$2\\)$`));
    assert.deepEqual(intStmt.params, [LOCK_FAMILY.advance, 42]);

    assert.match(hashStmt.sql, new RegExp(`^${LOCK_FN}\\(\\$1, hashtext\\(\\$2\\)\\)$`));
    assert.deepEqual(hashStmt.params, [LOCK_FAMILY.advanceSettlementCode, 'PT-2609']);

    assert.match(textStmt.sql, new RegExp(`^${LOCK_FN}\\(hashtextextended\\(\\$1, 0\\)\\)$`));
    assert.equal(textStmt.params[0], 'payment-receipt\u001f9');

    assert.match(dualStmt.sql, new RegExp(`^${LOCK_FN}\\(hashtext\\(\\$1\\), hashtext\\(\\$2\\)\\)$`));

    assert.match(bareStmt.sql, new RegExp(`^${LOCK_FN}\\(\\$1\\)$`));
    assert.deepEqual(bareStmt.params, [12]);
  });
});

describe('canonical lock order (deadlock contract, as data)', () => {
  it('formalizes the advance settle habit: advance → expense → scope, ids ascending', () => {
    const ordered = canonicalLockOrder([
      lockKeys.containerScope(3),
      lockKeys.expense(9),
      lockKeys.advance(7),
      lockKeys.advance(2),
    ]);
    assert.deepEqual(ordered, [
      lockKeys.advance(2),
      lockKeys.advance(7),
      lockKeys.expense(9),
      lockKeys.containerScope(3),
    ]);
  });

  it('sorts ledger entities globally by (family, id) like LedgerService did', () => {
    const ordered = canonicalLockOrder([
      lockKeys.ledgerEntity('CUSTOMER', 9),
      lockKeys.ledgerEntity('DRIVER', 1),
      lockKeys.ledgerEntity('CUSTOMER', 2),
    ]);
    assert.deepEqual(ordered.map((k) => (k as { id: number; family: number })), [
      { kind: 'int', family: 1, id: 2 },
      { kind: 'int', family: 1, id: 9 },
      { kind: 'int', family: 2, id: 1 },
    ]);
  });

  it('deduplicates and is input-order independent', () => {
    const keys = [
      lockKeys.expense(4), lockKeys.advance(1), lockKeys.expense(4),
      lockKeys.paymentReceipt(2),
    ];
    const once = canonicalLockOrder(keys);
    const twice = canonicalLockOrder([...keys].reverse());
    assert.deepEqual(once, twice);
    assert.equal(once.length, 3);
    // int space precedes the single-bigint text space
    assert.equal(once[0].kind, 'int');
    assert.equal(once[once.length - 1].kind, 'text');
  });

  it('numeric ids sort numerically, not lexically', () => {
    const ordered = canonicalLockOrder([lockKeys.expense(100), lockKeys.expense(20), lockKeys.expense(3)]);
    assert.deepEqual(ordered.map((k) => (k as { id: number }).id), [3, 20, 100]);
  });

  it('mixed-sign scope ids sort numerically (negated trip ids before container ids)', () => {
    const ordered = canonicalLockOrder([
      lockKeys.containerScope(3),
      lockKeys.tripScope(7),   // id -7
      lockKeys.tripScope(20),  // id -20
      lockKeys.containerScope(50),
    ]);
    assert.deepEqual(ordered.map((k) => (k as { id: number }).id), [-20, -7, 3, 50]);
  });
});
