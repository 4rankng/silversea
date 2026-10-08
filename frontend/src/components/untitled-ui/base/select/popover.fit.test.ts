import { describe, expect, it } from 'vitest';
import { fitBelowMaxHeight } from './popover';

/** Card 061026172802 (FB-025/FB-044): the fit-to-space cap must keep the
 *  dropdown below its trigger whenever the leftover space is usable, and hand
 *  the decision back to react-aria's flip only below the usability floor. */
describe('fitBelowMaxHeight', () => {
  const CAP = 256;
  const PAD = 16;
  const OFFSET = 4;

  it('caps at the size cap when the space below is generous', () => {
    expect(fitBelowMaxHeight(900, 400, CAP, PAD, OFFSET)).toBe(256);
  });

  it('shrinks to the usable space below instead of forcing a flip', () => {
    expect(fitBelowMaxHeight(900, 738, CAP, PAD, OFFSET)).toBe(142);
  });

  it('returns null below the floor so the flip takes over', () => {
    expect(fitBelowMaxHeight(900, 824, CAP, PAD, OFFSET)).toBeNull();
    expect(fitBelowMaxHeight(900, 784, CAP, PAD, OFFSET)).toBe(96);
  });
});
