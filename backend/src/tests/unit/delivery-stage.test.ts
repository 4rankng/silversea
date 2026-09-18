import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readSnapshotDeliverySiteName,
  resolveDeliveryStage,
} from '../../services/delivery-stage';

// Ruling 2026-09-18 (MasterDataNhaMay §2.2): the HẠ label on a driver card is
// ALWAYS a port/drop point — the factory has its own card block and never
// takes this label, in ANY direction. The site snapshot carries the factory,
// so it is excluded from the chain everywhere; the dispatcher's free-text
// drop override still carries when no port is recorded. Port and free text
// agree → single row; the distinct-place Trả-rỗng row is dead (when HẠ is
// the port, a second row naming the same place is the redundancy the user
// already rejected).
test('import: the drop label is the port, never the snapshot factory', () => {
  assert.deepEqual(
    resolveDeliveryStage('NEWEB-1', null, 'Bãi JJ LOGISTICS', 'IMPORT'),
    { deliveryName: 'Bãi JJ LOGISTICS', returnDepotName: null },
    'the factory snapshot must not take the HẠ label on an import',
  );
  assert.deepEqual(
    resolveDeliveryStage('NEWEB-1', 'Bãi Đồng Nhất', null, 'IMPORT'),
    { deliveryName: 'Bãi Đồng Nhất', returnDepotName: null },
    'no structured port → the dispatcher free text still carries the drop',
  );
  assert.deepEqual(
    resolveDeliveryStage('NEWEB-1', null, null, 'IMPORT'),
    { deliveryName: null, returnDepotName: null },
    'no port at all → report missing rather than borrow the factory',
  );
});

test('unknown direction renders port-safely under the same rule (no factory fallback)', () => {
  assert.deepEqual(
    resolveDeliveryStage('Kho Snapshot', 'Điểm điều vận', 'Bãi Port'),
    { deliveryName: 'Bãi Port', returnDepotName: null },
    'port beats the dispatcher free text and the snapshot',
  );
  assert.deepEqual(
    resolveDeliveryStage('Kho Snapshot', null, 'Bãi Port'),
    { deliveryName: 'Bãi Port', returnDepotName: null },
  );
  assert.deepEqual(
    resolveDeliveryStage('Kho Snapshot', 'Bãi Đồng Nhất', null),
    { deliveryName: 'Bãi Đồng Nhất', returnDepotName: null },
    'no port → free text carries; snapshot still excluded',
  );
  assert.deepEqual(
    resolveDeliveryStage('Kho Snapshot', null, null),
    { deliveryName: null, returnDepotName: null },
    'no port or free text → missing label, never the factory',
  );
});

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

test('snapshot deliverySite name extraction trusts only an object with a non-blank string name', () => {
  assert.equal(readSnapshotDeliverySiteName({ deliverySite: { name: 'Kho NEWEB-1' } }), 'Kho NEWEB-1');
  assert.equal(readSnapshotDeliverySiteName({ deliverySite: { name: '  Trimmed  ' } }), 'Trimmed');
  assert.equal(readSnapshotDeliverySiteName({ deliverySite: { name: '' } }), null, 'blank name is missing');
  assert.equal(readSnapshotDeliverySiteName({ deliverySite: 'Kho NEWEB-1' }), null, 'string site is not an object');
  assert.equal(readSnapshotDeliverySiteName({}), null);
  assert.equal(readSnapshotDeliverySiteName(null), null);
  assert.equal(readSnapshotDeliverySiteName(undefined), null);
});
