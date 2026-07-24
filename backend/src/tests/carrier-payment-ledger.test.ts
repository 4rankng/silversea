import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { recordCarrierPayment } from '../services/financial.service';
import {
  getCarrierPayableStatement,
  getStatementData,
} from '../services/statement.service';

const createdCarrierIds: number[] = [];

after(async () => {
  if (createdCarrierIds.length > 0) {
    await db.delete(s.ledger).where(and(
      inArray(s.ledger.entityType, ['CUSTOMER', 'CARRIER']),
      inArray(s.ledger.entityId, createdCarrierIds),
    ));
    await db.delete(s.customers).where(inArray(s.customers.id, createdCarrierIds));
  }
  await client.end();
});

describe('carrier payment ledger isolation', () => {
  test('rejects a normal customer as a carrier payment counterparty', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [customer] = await db.insert(s.customers)
      .values({ name: `Not a carrier ${suffix}`, isCarrier: false })
      .returning();
    createdCarrierIds.push(customer.id);

    await assert.rejects(
      recordCarrierPayment({
        supplierId: customer.id,
        amount: '100000',
        date: '2026-07-24',
        confirmOverpay: true,
      }),
      (error: unknown) =>
        error instanceof Error
        && 'statusCode' in error
        && error.statusCode === 404,
    );
  });

  test('keeps carrier AP out of customer AR and uses the entered payment date', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [carrier] = await db.insert(s.customers)
      .values({ name: `Carrier payment ${suffix}`, isCarrier: true })
      .returning();
    createdCarrierIds.push(carrier.id);

    // Historical carrier costs were stored on CUSTOMER before the payable
    // projection received its own isolated entity type.
    await db.insert(s.ledger).values({
      txnType: TxnType.EXTERNAL_CARRIER_COST,
      entityType: 'CUSTOMER',
      entityId: carrier.id,
      debit: '0',
      credit: '1000000',
      balance: '-1000000',
      note: 'Cước thuê ngoài chuyến lịch sử',
      timestamp: new Date('2026-07-20T00:00:00+07:00'),
    });

    const payment = await recordCarrierPayment({
      supplierId: carrier.id,
      amount: '400000',
      date: '2026-07-24',
      note: 'Thanh toán cước thử nghiệm',
    });

    assert.equal(payment.entityType, 'CARRIER');
    assert.equal(payment.txnType, TxnType.VENDOR_PAYMENT);
    assert.equal(new Date(payment.timestamp).toISOString(), '2026-07-23T17:00:00.000Z');

    const customerStatement = await getStatementData(carrier.id);
    assert.equal(customerStatement?.ledgerRows.length, 0);
    assert.equal(customerStatement?.totalOutstanding, 0);

    const carrierStatement = await getCarrierPayableStatement(carrier.id);
    assert.equal(carrierStatement.ledgerRows.length, 2);
    assert.equal(carrierStatement.totalOutstanding, 600000);
    assert.equal(carrierStatement.ledgerRows[0].balance, '600000');

    const [storedPayment] = await db.select().from(s.ledger).where(and(
      eq(s.ledger.entityType, 'CARRIER'),
      eq(s.ledger.entityId, carrier.id),
      eq(s.ledger.txnType, TxnType.VENDOR_PAYMENT),
    )).limit(1);
    assert.equal(storedPayment.timestamp.toISOString(), '2026-07-23T17:00:00.000Z');
  });
});
