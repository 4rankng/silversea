import { describe, expect, it } from 'vitest';
import { fitBelowMaxHeight, fitAboveMaxHeight } from './popover';

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

/** SIL-707 r2 (QA 07/11): the top-placement twin obeys the same floor/cap law
 *  mirrored across the trigger — the allocation dialog's carrier picker opens
 *  upward and must never trust the below-side leftover space. */
describe('fitAboveMaxHeight', () => {
  const CAP = 256;
  const PAD = 16;
  const OFFSET = 4;

  it('caps at the size cap when the space above is generous', () => {
    expect(fitAboveMaxHeight(900, 500, CAP, PAD, OFFSET)).toBe(256);
  });

  it('shrinks to the usable space above instead of forcing a flip', () => {
    expect(fitAboveMaxHeight(900, 162, CAP, PAD, OFFSET)).toBe(142);
  });

  it('returns null below the floor so the flip takes over', () => {
    expect(fitAboveMaxHeight(900, 76, CAP, PAD, OFFSET)).toBeNull();
    expect(fitAboveMaxHeight(900, 116, CAP, PAD, OFFSET)).toBe(96);
  });

  it('mirrors the below law for the same trigger geometry', () => {
    // trigger centered at 450 in a 900 viewport: both sides see the same space.
    expect(fitAboveMaxHeight(900, 450, CAP, PAD, OFFSET))
      .toBe(fitBelowMaxHeight(900, 450, CAP, PAD, OFFSET));
  });
});
