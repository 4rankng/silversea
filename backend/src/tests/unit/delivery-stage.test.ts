import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readSnapshotDeliverySiteName,
  resolveDeliveryStage,
} from '../../services/delivery-stage';

// The chain order IS the contract: free text (dispatcher override) beats the
// snapshot site beats the container port. The return depot appears only when
// the port names a DIFFERENT place than the resolved delivery point.
test('delivery chain: free text > snapshot site > port', () => {
  const all = resolveDeliveryStage('Kho Snapshot', 'Điểm điều vận', 'Bãi Port');
  assert.deepEqual(all, { deliveryName: 'Điểm điều vận', returnDepotName: 'Bãi Port' });

  const noFreeText = resolveDeliveryStage('Kho Snapshot', null, 'Bãi Port');
  assert.deepEqual(noFreeText, { deliveryName: 'Kho Snapshot', returnDepotName: 'Bãi Port' });

  const portOnly = resolveDeliveryStage(null, null, 'Bãi Port');
  assert.deepEqual(portOnly, { deliveryName: 'Bãi Port', returnDepotName: null }, 'port as last resort is the delivery itself — no second row');
});

test('return depot: null when the port matches the delivery point or is absent', () => {
  assert.deepEqual(
    resolveDeliveryStage(null, 'Bãi Đồng Nhất', 'Bãi Đồng Nhất'),
    { deliveryName: 'Bãi Đồng Nhất', returnDepotName: null },
    'port == free-text delivery → agreement, one row',
  );
  assert.deepEqual(
    resolveDeliveryStage('Kho A', null, 'Kho A'),
    { deliveryName: 'Kho A', returnDepotName: null },
    'port == snapshot delivery → agreement, one row',
  );
  assert.deepEqual(
    resolveDeliveryStage('Kho A', null, null),
    { deliveryName: 'Kho A', returnDepotName: null },
  );
  assert.deepEqual(
    resolveDeliveryStage(null, null, null),
    { deliveryName: null, returnDepotName: null },
  );
});

test('snapshot deliverySite name extraction trusts only an object with a non-blank string name', () => {
  assert.equal(readSnapshotDeliverySiteName({ deliverySite: { name: 'Kho NEWEB-1' } }), 'Kho NEWEB-1');
  assert.equal(readSnapshotDeliverySiteName({ deliverySite: { name: '  Trimmed  ' } }), 'Trimmed');
  assert.equal(readSnapshotDeliverySiteName({ deliverySite: { name: '' } }), null, 'blank name is missing');
  assert.equal(readSnapshotDeliverySiteName({ deliverySite: 'Kho NEWEB-1' }), null, 'string site is not an object');
  assert.equal(readSnapshotDeliverySiteName({}), null);
  assert.equal(readSnapshotDeliverySiteName(null), null);
  assert.equal(readSnapshotDeliverySiteName(undefined), null);
});
