import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readSnapshotDeliverySiteName,
  resolveDeliveryStage,
} from '../../services/delivery-stage';

// Ruling 2026-09-18 (MasterDataNhaMay §2.2): the HẠ label on a driver card is
// ALWAYS a port/drop point — the factory has its own card block and never
// takes this label, in ANY direction. The dispatcher's free-text drop
// override still carries when no port is recorded. Port and free text
// agree → single row; the distinct-place Trả-rỗng row is dead (when HẠ is
// the port, a second row naming the same place is the redundancy the user
// already rejected).
//
// Card 171026205400 (FB-020, R21 verify-fail 2026-10-17) amends the terminal
// case: when neither port nor dispatcher override is recorded, the
// fulfillment snapshot's deliverySite — the job's own delivery-point record
// (dữ liệu điều vận), not a borrowed catalog factory — closes the chain
// ("khi hai điểm là cùng một nơi thì hai hàng cùng tên", PRD ManHinhLaiXe
// §2.3). It never outranks a recorded port/free-text, and EXPORT stays
// port-only (an export drops at the port, never the stuffing factory).
test('import: the drop label is the port, never a snapshot that outranks it', () => {
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
});

test('FB-020 (card 171026205400): a portless import closes the chain with the delivery-site record', () => {
  assert.deepEqual(
    resolveDeliveryStage('LM Võ Cường', null, null, 'IMPORT'),
    { deliveryName: 'LM Võ Cường', returnDepotName: null },
    'no port, no override → the job\'s delivery-site record IS the discharge point (PRD §2.3 same-name clause), never "Chưa có cảng hạ" beside a delivery row naming the same place',
  );
  assert.deepEqual(
    resolveDeliveryStage('  LM Võ Cường  ', null, null, 'IMPORT'),
    { deliveryName: 'LM Võ Cường', returnDepotName: null },
    'the closing name is trimmed like every other link',
  );
  assert.deepEqual(
    resolveDeliveryStage('   ', null, null, 'IMPORT'),
    { deliveryName: null, returnDepotName: null },
    'a blank snapshot is missing data → the named empty state, not a phantom drop',
  );
});

test('unknown direction renders port-safely under the same rule', () => {
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
    'no port → free text carries; snapshot still never outranks it',
  );
  assert.deepEqual(
    resolveDeliveryStage('Kho Snapshot', null, null),
    { deliveryName: 'Kho Snapshot', returnDepotName: null },
    'no port or free text → the delivery-site record closes (FB-020), matching the IMPORT branch',
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
