import { describe, expect, it } from 'vitest';
import { TripStatus } from '@tingting/shared';
import {
  PAIR_LOCKED_MESSAGE,
  completeCtaLabel,
  isTripPairLocked,
  milestoneActionState,
  podCompleteCtaLabel,
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
});
