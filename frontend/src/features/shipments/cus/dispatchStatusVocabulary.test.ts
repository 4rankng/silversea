import { describe, expect, it } from 'vitest';
import { SHIPMENT_CUS_DISPATCH_STATUSES } from '@tingting/shared';
import { dispatchStatusLabel } from './cusUtils';
import { DISPATCH_STATUS } from '../detail/ShipmentContainerLedger';

// Customer decision 2026-09-08, revised the same evening; 2026-09-18 user
// ruling on 20260917_5: the vehicle-allocated state reads "Đã điều xe" (not
// "Đã phân xe"). The container dispatch chip keeps five states — "Đã tạo
// chuyến" while a CREATED trip still misses its ngày đóng/trả; "Chờ phân xe"
// once the date is set (or nothing scheduled yet) but no vehicle is on the
// line; "Đã điều xe" once a vehicle is allocated (the same plate the Phân xe
// column shows); then "Đang chạy" / "Hoàn thành". Only "Chưa điều xe"
// (UNASSIGNED) stays retired as chip wording.
describe('container dispatch status vocabulary', () => {
  it('labels every shared status with the agreed wording', () => {
    expect(dispatchStatusLabel('AWAITING_VEHICLE')).toBe('Chờ phân xe');
    expect(dispatchStatusLabel('PLANNED')).toBe('Đã điều xe');
    expect(dispatchStatusLabel('CREATED')).toBe('Đã tạo chuyến');
    expect(dispatchStatusLabel('IN_TRANSIT')).toBe('Đang chạy');
    expect(dispatchStatusLabel('COMPLETED')).toBe('Hoàn thành');
  });

  it('covers the shared status union exactly', () => {
    expect(Object.keys(DISPATCH_STATUS).sort()).toEqual([...SHIPMENT_CUS_DISPATCH_STATUSES].sort());
  });

  it('keeps the workboard badge map and the ledger chip label in agreement', () => {
    for (const status of SHIPMENT_CUS_DISPATCH_STATUSES) {
      expect(DISPATCH_STATUS[status].label).toBe(dispatchStatusLabel(status));
    }
  });

  it('never revives the retired pre-trip wording', () => {
    const retired = ['Chưa điều xe'];
    for (const status of SHIPMENT_CUS_DISPATCH_STATUSES) {
      expect(retired).not.toContain(dispatchStatusLabel(status));
      expect(retired).not.toContain(DISPATCH_STATUS[status].label);
    }
  });
});
