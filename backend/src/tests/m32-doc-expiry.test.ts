/**
 * Wave 2 M3.2 — document expiry + replacement + dispatch block tests.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { createShipment, attachShipmentDocument, checkExpiredDocuments, replaceShipmentDocument } from '../services/shipment.service';
import { ShipmentDocumentType } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdDocIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `M32 customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

after(async () => {
  try {
    if (createdDocIds.length > 0) {
      await db.delete(s.shipmentDocuments).where(inArray(s.shipmentDocuments.id, createdDocIds));
    }
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } catch (err) {
    console.warn('[m32-doc-expiry.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});

describe('M3.2 — checkExpiredDocuments', () => {
  test('returns empty when no DO documents exist', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const expired = await checkExpiredDocuments(shipment.id);
    assert.equal(expired.length, 0);
  });

  test('returns empty when DO has no expiry date', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);
    const doc = await attachShipmentDocument(shipment.id, {
      type: ShipmentDocumentType.DO, storageKey: 'uploads/test/do-no-expiry.pdf',
    });
    createdDocIds.push(doc.id);

    const expired = await checkExpiredDocuments(shipment.id);
    assert.equal(expired.length, 0);
  });

  test('returns empty when DO expiry is in the future', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);
    const doc = await attachShipmentDocument(shipment.id, {
      type: ShipmentDocumentType.DO, storageKey: 'uploads/test/do-future.pdf',
    });
    createdDocIds.push(doc.id);
    // Set expiry to a future date.
    await db.update(s.shipmentDocuments)
      .set({ expiresAt: '2099-12-31' })
      .where(eq(s.shipmentDocuments.id, doc.id));

    const expired = await checkExpiredDocuments(shipment.id);
    assert.equal(expired.length, 0);
  });

  test('returns the expired DO when expiry is in the past', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);
    const doc = await attachShipmentDocument(shipment.id, {
      type: ShipmentDocumentType.DO, storageKey: 'uploads/test/do-past.pdf',
    });
    createdDocIds.push(doc.id);
    await db.update(s.shipmentDocuments)
      .set({ expiresAt: '2020-01-01' })
      .where(eq(s.shipmentDocuments.id, doc.id));

    const expired = await checkExpiredDocuments(shipment.id);
    assert.equal(expired.length, 1);
    assert.equal(expired[0].id, doc.id);
  });

  test('does NOT return expired DO that has been replaced', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);
    const oldDoc = await attachShipmentDocument(shipment.id, {
      type: ShipmentDocumentType.DO, storageKey: 'uploads/test/do-old.pdf',
    });
    createdDocIds.push(oldDoc.id);
    await db.update(s.shipmentDocuments)
      .set({ expiresAt: '2020-01-01' })
      .where(eq(s.shipmentDocuments.id, oldDoc.id));

    // Replace it with a new version.
    const newDoc = await replaceShipmentDocument(oldDoc.id, {
      storageKey: 'uploads/test/do-new.pdf',
      expiresAt: '2099-12-31',
    });
    createdDocIds.push(newDoc.id);

    const expired = await checkExpiredDocuments(shipment.id);
    assert.equal(expired.length, 0, 'replaced doc not counted as expired');
  });
});

describe('M3.2 — replaceShipmentDocument', () => {
  test('creates a new doc and marks old one as replaced', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);
    const oldDoc = await attachShipmentDocument(shipment.id, {
      type: ShipmentDocumentType.DO, storageKey: 'uploads/test/replace-old.pdf',
    });
    createdDocIds.push(oldDoc.id);

    const newDoc = await replaceShipmentDocument(oldDoc.id, {
      storageKey: 'uploads/test/replace-new.pdf',
    });
    createdDocIds.push(newDoc.id);

    assert.ok(newDoc.id !== oldDoc.id, 'new doc is a separate row');
    assert.equal(newDoc.type, oldDoc.type, 'inherits type');
    assert.equal(newDoc.shipmentId, oldDoc.shipmentId, 'inherits shipmentId');

    // Old doc should have replacedBy set.
    const [oldAfter] = await db.select().from(s.shipmentDocuments)
      .where(eq(s.shipmentDocuments.id, oldDoc.id));
    assert.equal(oldAfter.replacedBy, newDoc.id, 'old doc marked as replaced');
  });

  test('throws 404 when old document does not exist', async () => {
    await assert.rejects(
      () => replaceShipmentDocument(99_999_999, { storageKey: 'x' }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404,
    );
  });
});
