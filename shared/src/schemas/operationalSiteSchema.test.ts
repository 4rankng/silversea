// ERD anchor (MasterDataNhaMay §1/§2): Khách hàng 1-N Nhà máy, route + vị trí
// live ON the factory record — FACTORY requires a route link, WAREHOUSE must
// not take one (route inference for LCL stays at the lot level).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationalSiteSchema } from './index';
import { OperationalSiteType } from '../constants';

const validBase = {
  customerId: 1,
  code: 'NM-001',
  name: 'Nhà máy thử nghiệm',
  siteType: OperationalSiteType.FACTORY,
  routeId: 7,
  address: 'Khu công nghiệp thử nghiệm',
};

test('FACTORY requires a routeId (Nhà máy 1-1 tuyến đường cố định)', () => {
  const missingRoute = operationalSiteSchema.safeParse({ ...validBase, routeId: null });
  assert.equal(missingRoute.success, false);
  if (!missingRoute.success) {
    assert.match(JSON.stringify(missingRoute.error.issues), /Nhà máy cần được liên kết với một tuyến đường/);
  }

  const withRoute = operationalSiteSchema.safeParse(validBase);
  assert.equal(withRoute.success, true);
});

test('WAREHOUSE must not carry a factory route (kho không dùng tuyến nhà máy)', () => {
  const withRoute = operationalSiteSchema.safeParse({ ...validBase, siteType: OperationalSiteType.WAREHOUSE });
  assert.equal(withRoute.success, false);
  if (!withRoute.success) {
    assert.match(JSON.stringify(withRoute.error.issues), /Kho lấy hàng không dùng tuyến đường của nhà máy/);
  }

  const withoutRoute = operationalSiteSchema.safeParse({
    ...validBase,
    siteType: OperationalSiteType.WAREHOUSE,
    routeId: null,
  });
  assert.equal(withoutRoute.success, true);
});

test('address is mandatory on the factory record (vị trí đóng/trả 1-1)', () => {
  const noAddress = operationalSiteSchema.safeParse({ ...validBase, address: '' });
  assert.equal(noAddress.success, false);
  if (!noAddress.success) {
    assert.match(JSON.stringify(noAddress.error.issues), /Địa chỉ là bắt buộc/);
  }
});
