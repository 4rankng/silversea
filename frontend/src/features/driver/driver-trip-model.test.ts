import { describe, expect, it } from 'vitest';
import { TripStatus } from '@tingting/shared';
import {
  PAIR_LOCKED_MESSAGE,
  completeCtaLabel,
  isTripPairLocked,
  milestoneActionState,
  podCompleteCtaLabel,
  tagLabelFor,
  valueOrDash,
} from './driver-trip-model';

describe('driver-trip-model', () => {
  describe('isTripPairLocked', () => {
    it('returns true when card pairLocked is true', () => {
      expect(isTripPairLocked({ pairLocked: true })).toBe(true);
    });

    it('returns false when card pairLocked is false or missing or card is null/undefined', () => {
      expect(isTripPairLocked({ pairLocked: false })).toBe(false);
      expect(isTripPairLocked({})).toBe(false);
      expect(isTripPairLocked(null)).toBe(false);
      expect(isTripPairLocked(undefined)).toBe(false);
    });

    it('has the exact lock message matching TC8/SIL-652 spec', () => {
      expect(PAIR_LOCKED_MESSAGE).toBe('Cần hoàn thành trả hàng lệnh trước để mở khóa');
    });
  });

  describe('completeCtaLabel', () => {
    it('returns "Hoàn tất" when status is IN_TRANSIT', () => {
      expect(completeCtaLabel(TripStatus.IN_TRANSIT)).toBe('Hoàn tất');
    });

    it('returns "Đã hoàn thành chuyến" when status is COMPLETED', () => {
      expect(completeCtaLabel(TripStatus.COMPLETED)).toBe('Đã hoàn thành chuyến');
    });

    it('returns "Chưa thể hoàn thành chuyến" for other statuses', () => {
      expect(completeCtaLabel(TripStatus.CREATED)).toBe('Chưa thể hoàn thành chuyến');
      expect(completeCtaLabel(TripStatus.CANCELED)).toBe('Chưa thể hoàn thành chuyến');
    });
  });

  describe('podCompleteCtaLabel', () => {
    it('returns "HOÀN THÀNH CHUYẾN" for IN_TRANSIT', () => {
      expect(podCompleteCtaLabel(TripStatus.IN_TRANSIT)).toBe('HOÀN THÀNH CHUYẾN');
    });
  });

  describe('milestoneActionState', () => {
    it('returns done when event is found', () => {
      expect(milestoneActionState(true, 0, 0)).toBe('done');
    });

    it('returns available when index equals nextMilestoneIndex', () => {
      expect(milestoneActionState(false, 0, 0)).toBe('available');
    });

    it('returns locked when index does not equal nextMilestoneIndex', () => {
      expect(milestoneActionState(false, 1, 0)).toBe('locked');
    });
  });

  describe('valueOrDash', () => {
    it('returns value when present and trimmed', () => {
      expect(valueOrDash('abc')).toBe('abc');
    });

    it('returns dash when empty or null/undefined', () => {
      expect(valueOrDash('')).toBe('—');
      expect(valueOrDash('   ')).toBe('—');
      expect(valueOrDash(null)).toBe('—');
      expect(valueOrDash(undefined)).toBe('—');
    });
  });

  describe('tagLabelFor — SIL-847 kẹp-shape law (badge ĐƠN→KẸP on 2-cont trips)', () => {
    const cont = (n: string) => ({ containerNumber: n, containerTypeName: "20'DC", sealNumber: null, cargoWeightKg: null });

    it('a SINGLE trip carrying 2 own containers reads KẸP (the R3P-677-R repro)', () => {
      expect(tagLabelFor({
        pairKind: null, classification: 'SINGLE', linked: false,
        containers: [cont('RTAU4011047'), cont('RTAU4011052')],
      })).toBe('KẸP');
    });

    it('an unlinked SINGLE with one container stays ĐƠN', () => {
      expect(tagLabelFor({
        pairKind: null, classification: 'SINGLE', linked: false,
        containers: [cont('MSCU1234561')],
      })).toBe('ĐƠN');
    });

    it('the legacy wire without the containers field keeps the linked/ĐƠN fallbacks', () => {
      expect(tagLabelFor({ pairKind: null, classification: 'SINGLE', linked: true })).toBe('KẸP');
      expect(tagLabelFor({ pairKind: null, classification: 'SINGLE', linked: false })).toBe('ĐƠN');
      expect(tagLabelFor(undefined)).toBe('ĐƠN');
    });

    it('explicit pairKind and classification stay authoritative over the 2-cont shape', () => {
      const two = [cont('A'), cont('B')];
      expect(tagLabelFor({ pairKind: 'KET_HOP', classification: 'SINGLE', linked: false, containers: two })).toBe('KẾT HỢP');
      expect(tagLabelFor({ pairKind: null, classification: 'COMBINED', linked: false, containers: two })).toBe('KẾT HỢP');
    });

    it('LCL rows are never kẹp members — 2 conts still read LẺ / LẤY LẺ', () => {
      const two = [cont('A'), cont('B')];
      expect(tagLabelFor({ pairKind: null, classification: 'LCL', linked: false, containers: two })).toBe('LẺ');
      expect(tagLabelFor({ pairKind: null, classification: 'LCL_PICKUP', linked: true, containers: two })).toBe('LẤY LẺ');
    });
  });
});
