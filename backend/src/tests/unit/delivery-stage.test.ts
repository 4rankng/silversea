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

// An export run collects an empty box at a depot, stuffs it at the factory and
// sets the LADEN container down at the port. The factory is a loading stop, so
// it must never take the "Hạ" label, and an export has no empty-return leg at
// all. Business confirmation 2026-09-17: "hạ ở cảng" + "thừa Trả rỗng".
test('export: the drop is the port and there is no empty-return row', () => {
  assert.deepEqual(
    resolveDeliveryStage('NEWEB-1', null, 'Cảng TIL', 'EXPORT'),
    { deliveryName: 'Cảng TIL', returnDepotName: null },
    'factory snapshot must not outrank the port on an export',
  );
  assert.deepEqual(
    resolveDeliveryStage('NEWEB-1', 'NEWEB-1', 'Cảng TIL', 'EXPORT'),
    { deliveryName: 'Cảng TIL', returnDepotName: null },
    'a factory-shaped free text must not outrank the port either',
  );
  assert.deepEqual(
    resolveDeliveryStage('NEWEB-1', 'Cảng Nam Hải', null, 'EXPORT'),
    { deliveryName: 'Cảng Nam Hải', returnDepotName: null },
    'no structured port → the dispatcher free text still carries the drop',
  );
  assert.deepEqual(
    resolveDeliveryStage('NEWEB-1', null, null, 'EXPORT'),
    { deliveryName: null, returnDepotName: null },
    'no port at all → report missing rather than borrow the factory',
  );
});

test('import keeps the established chain when the direction is known', () => {
  assert.deepEqual(
    resolveDeliveryStage('NEWEB-1', null, 'Bãi JJ LOGISTICS', 'IMPORT'),
    { deliveryName: 'NEWEB-1', returnDepotName: 'Bãi JJ LOGISTICS' },
    'import delivers at the factory and returns the empty to the depot',
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
