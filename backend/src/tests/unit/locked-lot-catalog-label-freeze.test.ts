// Locked-lot catalog label freeze — a catalog rename (Cảng/Bãi, Nhà máy)
// must never relabel a lot that already carries the point: an
// accounting-locked lot is a final historical record, and a running lot is
// only ever relabeled explicitly. Mechanism under test: the label frozen on
// the row when the port/factory was set leads every display resolution; the
// live catalog join is only the fallback for rows the freeze never filled
// (those follow the catalog, exactly as new work does).
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { factoryLabelFromSnapshot } from '../../services/shipment-lifecycle-shared.service';
import { resolveLiftSite, resolveDropoffSite } from '../../services/cus-workspace-builders.service';
import type { WorkspaceSupport } from '../../services/cus-shipment-workspace-reads.service';

const buildersSource = readFileSync(
  new URL('../../services/cus-workspace-builders.service.ts', import.meta.url),
  'utf8',
);
const lotViewSource = readFileSync(
  new URL('../../../../frontend/src/features/shipments/cus/CusLotView.tsx', import.meta.url),
  'utf8',
);

/** The catalog as it reads AFTER the rename: the masters row now says the
 *  new name; only the frozen labels still know the old one. */
function renamedCatalogSupport(): WorkspaceSupport {
  return {
    factoryNameBySiteId: new Map([[7, { shortName: 'Tên mới', fullName: 'Tên mới đầy đủ' }]]),
    portsById: new Map([[11, { id: 11, code: 'DVU', name: 'Cảng đã đổi tên' }]]),
  } as unknown as WorkspaceSupport;
}

const frozenPortContainer = { pickupPortId: 11, dropoffPortId: 11, pickupPortNameSnapshot: 'Cảng Đình Vũ', dropoffPortNameSnapshot: 'Cảng Đình Vũ' };
const unfrozenPortContainer = { pickupPortId: 11, dropoffPortId: 11, pickupPortNameSnapshot: null, dropoffPortNameSnapshot: null };

test('Nhà máy: nhãn đóng băng dẫn joining danh mục — đổi tên danh mục không đổi nhãn lô', () => {
  // The row froze "Tên cũ" when the factory was set; the catalog now says
  // "Tên mới". Every lot display must keep the frozen label.
  assert.equal(
    factoryLabelFromSnapshot('Tên cũ', 7, 'Tên mới'),
    'Tên cũ',
  );
});

test('Nhà máy: dòng chưa từng đóng băng nhãn theo danh mục hiện tại', () => {
  // No snapshot (pre-freeze row): the live join supplies the label — the
  // same name new work picks, so the catalog stays the authority for rows
  // that never carried a frozen name.
  assert.equal(
    factoryLabelFromSnapshot(null, 7, 'Tên mới'),
    'Tên mới',
  );
  assert.equal(factoryLabelFromSnapshot(null, null, 'Tên mới'), null);
});

test('Nhà máy: nhãn trắng coi như chưa đóng băng', () => {
  assert.equal(factoryLabelFromSnapshot('   ', 7, 'Tên mới'), 'Tên mới');
});

test('Cảng nâng/hạ: tên chốt lúc gán dẫn tên danh mục sau khi danh mục đổi', () => {
  const support = renamedCatalogSupport();
  // Locked or running, the line resolves the SAME way: the frozen name wins.
  assert.equal(resolveLiftSite(support, frozenPortContainer, null)?.name, 'Cảng Đình Vũ');
  assert.equal(resolveDropoffSite(support, frozenPortContainer, null)?.name, 'Cảng Đình Vũ');
});

test('Cảng nâng/hạ: dòng không có nhãn đóng băng hiển thị tên danh mục hiện tại', () => {
  const support = renamedCatalogSupport();
  assert.equal(resolveLiftSite(support, unfrozenPortContainer, null)?.name, 'Cảng đã đổi tên');
  assert.equal(resolveDropoffSite(support, unfrozenPortContainer, null)?.name, 'Cảng đã đổi tên');
});

test('Cảng nâng/hạ: lô thuần ad-hoc (không catalog id) vẫn đọc snapshot lệnh cũ', () => {
  const support = renamedCatalogSupport();
  const noCatalogPort = { pickupPortId: null, dropoffPortId: null, pickupPortNameSnapshot: null, dropoffPortNameSnapshot: null };
  const assignment = {
    siteSnapshot: {
      pickupWarehouse: { siteType: 'PORT', name: 'Cảng nhập tay' },
      deliverySite: { siteType: 'PORT', name: 'Cảng trả nhập tay' },
    },
  } as never;
  assert.equal(resolveLiftSite(support, noCatalogPort, assignment)?.name, 'Cảng nhập tay');
  assert.equal(resolveDropoffSite(support, noCatalogPort, assignment)?.name, 'Cảng trả nhập tay');
});

test('Dòng container của drawer phát nhãn nhà máy theo đúng bậc đóng băng (cont → lô → text cũ)', () => {
  assert.ok(
    buildersSource.includes('factoryName: containerFactoryName ?? shipmentFactoryName ?? trimOrNull(row.shipment.factoryName)'),
    'buildContainerLine phải phát factoryName theo bậc: snapshot cont → snapshot lô → text cũ',
  );
  // Both tiers resolve through the shared frozen-first helper, live join
  // only as the fallback inside its own tier.
  const tierCount = buildersSource.split('factoryLabelFromSnapshot(').length - 1;
  assert.ok(tierCount >= 2, 'mỗi bậc (cont, lô) phải chạy qua helper đóng băng trước joining sống');
});

test('Drawer Chi tiết lô: ô Nhà máy đọc nhãn server, không tra danh mục sống', () => {
  assert.ok(
    lotViewSource.includes('<td>{line.factoryName ?? dash}</td>'),
    'ô Nhà máy phải hiển thị nhãn đóng băng từ server',
  );
  assert.ok(
    !lotViewSource.includes('selectors.operationalSites.find'),
    'drawer không được tra nhãn nhà máy qua danh mục sống — rename danh mục sẽ trượt vào lô đã khóa',
  );
});
