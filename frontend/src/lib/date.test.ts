import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './date';

/** Card 2026-10-05_1628 — the bell and the notifications page each carried their
 *  own near-identical `timeAgo`, which had drifted from the shared formatter
 *  (no "Hôm qua", and a long locale date instead of a compact one past 30 days).
 *  A reporter read the result as an ambiguous "3:11". Both surfaces now read
 *  this one function; these cases pin the wording they both depend on. */
describe('formatRelativeTime — the one relative-time wording', () => {
  const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  it('reads as Vietnamese prose, not a bare number', () => {
    expect(formatRelativeTime(at(5_000))).toBe('Vừa xong');
    expect(formatRelativeTime(at(5 * 60_000))).toBe('5 phút trước');
    expect(formatRelativeTime(at(3 * 3_600_000))).toBe('3 giờ trước');
  });

  it('says "Hôm qua" rather than "1 ngày trước"', () => {
    expect(formatRelativeTime(at(26 * 3_600_000))).toBe('Hôm qua');
  });

  it('keeps counting days after that', () => {
    expect(formatRelativeTime(at(3 * 86_400_000))).toBe('3 ngày trước');
  });

  it('falls back to an unambiguous compact date, never a long or empty one', () => {
    // Past a month there is no relative wording, so the date must stand alone.
    // A bare "18/09" or "—"; NOT the bare digit a reader can misread as a count.
    const old = formatRelativeTime(at(90 * 86_400_000));
    expect(old).toMatch(/^\d{2}\/\d{2}$/);
    expect(old).not.toMatch(/\d{3}/);
  });

  it('degrades to an em dash for missing or unparsable input', () => {
    expect(formatRelativeTime(null)).toBe('—');
    expect(formatRelativeTime(undefined)).toBe('—');
    expect(formatRelativeTime('')).toBe('—');
    expect(formatRelativeTime('không phải ngày')).toBe('—');
  });
});