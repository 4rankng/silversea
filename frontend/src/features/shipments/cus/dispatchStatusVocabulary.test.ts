import { describe, expect, it } from 'vitest';
import { SHIPMENT_CUS_DISPATCH_STATUSES } from '@tingting/shared';
import { dispatchStatusLabel } from './cusUtils';
import { DISPATCH_STATUS } from '../detail/ShipmentContainerLedger';

// Customer decision 2026-09-08: the container dispatch chip has exactly four
// states — "Chờ phân xe" until dispatch assigns a vehicle (no trip yet, or a
// CREATED trip that already has its ngày đóng/trả), "Đã tạo chuyến" only
// while that date is still missing, then "Đang chạy" / "Hoàn thành". The
// retired pre-trip statuses ("Chưa điều xe" / "Đã phân xe" as dispatch chip
// wording) must not reappear on any label surface.
describe('container dispatch status vocabulary', () => {
  it('labels every shared status with the agreed wording', () => {
    expect(dispatchStatusLabel('AWAITING_VEHICLE')).toBe('Chờ phân xe');
    expect(dispatchStatusLabel('CREATED')).toBe('Đã tạo chuyến');
    expect(dispatchStatusLabel('IN_TRANSIT')).toBe('Đang chạy');
    expect(dispatchStatusLabel('COMPLETED')).toBe('Hoàn thành');
  });

  it('covers the shared status union exactly — no retired values survive', () => {
    expect(Object.keys(DISPATCH_STATUS).sort()).toEqual([...SHIPMENT_CUS_DISPATCH_STATUSES].sort());
  });

  it('keeps the workboard badge map and the ledger chip label in agreement', () => {
    for (const status of SHIPMENT_CUS_DISPATCH_STATUSES) {
      expect(DISPATCH_STATUS[status].label).toBe(dispatchStatusLabel(status));
    }
  });

  it('never revives the retired pre-trip wording', () => {
    const retired = ['Chưa điều xe', 'Đã phân xe'];
    for (const status of SHIPMENT_CUS_DISPATCH_STATUSES) {
      expect(retired).not.toContain(dispatchStatusLabel(status));
      expect(retired).not.toContain(DISPATCH_STATUS[status].label);
    }
  });
});
