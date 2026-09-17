import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { LedgerService } from '../services/ledger.service';
import { insertTripComposite } from '../services/trip-composite.service';

after(async () => { await client.end(); });

for (const status of ['RECORDED', 'APPROVED', 'DRAFT', 'PENDING', 'VOIDED', 'REJECTED']) {
  test(`NO-APP-18B ${status} expense posting and reversal retain the correct customer/vendor net`, async () => {
    const rollback = Symbol('rollback');
    try {
      await db.transaction(async tx => {
        const key = crypto.randomUUID();
        const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
        const [supplier] = await tx.insert(s.suppliers).values({ name: key }).returning();
        const [route] = await tx.insert(s.routes).values({ name: key }).returning();
        const [cargoType] = await tx.insert(s.cargoTypes).values({ name: key }).returning();
        const trip = await insertTripComposite(tx, { tripCode: key, customerId: customer.id, routeId: route.id,
          cargoTypeId: cargoType.id, departureDate: '2026-09-17', status: 'COMPLETED', carrierType: 'OWN', revenue: '0' });
        const [expense] = await tx.insert(s.tripExpenses).values({ tripId: trip.id, expenseType: 'OTHER',
          buyAmount: '500000', sellAmount: '300000', supplierId: supplier.id,
          settlementMethod: 'COMPANY_DIRECT', approvalStatus: status }).returning();
        const params = { id: trip.id, tripCode: trip.tripCode, customerId: customer.id, driverId: null,
          revenue: '0', driverSalary: '0', carrierType: 'OWN', ancillaryFees: [expense] };
        await LedgerService.postTripCompletion(tx, params);
        const posted = await tx.select().from(s.ledger).where(eq(s.ledger.txnId, expense.id));
        const recorded = status === 'RECORDED' || status === 'APPROVED';
        const customerEntries = posted.filter(row => row.txnType === TxnType.SERVICE_FEE && row.entityType === 'CUSTOMER' && row.entityId === customer.id);
        const vendorEntries = posted.filter(row => row.txnType === TxnType.VENDOR_EXPENSE && row.entityType === 'VENDOR' && row.entityId === supplier.id);
        assert.equal(customerEntries.length, recorded ? 1 : 0);
        assert.equal(vendorEntries.length, recorded ? 1 : 0);
        if (recorded) {
          assert.equal(customerEntries[0].debit, '300000');
          assert.equal(vendorEntries[0].credit, '500000');
        }
        await LedgerService.postTripCompletionReverse(tx, params);
        for (const [entityType, entityId] of [['CUSTOMER', customer.id], ['VENDOR', supplier.id]] as const) {
          const entries = await tx.select().from(s.ledger).where(and(eq(s.ledger.txnId, expense.id), eq(s.ledger.entityType, entityType), eq(s.ledger.entityId, entityId)));
          assert.equal(entries.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0), 0);
          assert.equal(entries.length, recorded ? 2 : 0);
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
}
