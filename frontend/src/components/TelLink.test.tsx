import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TelLink, telHref } from './TelLink';

/**
 * REQ-14 — SĐT kho/nhà máy trong chi tiết nhận lệnh là điều khiển chạm-gọi.
 * The tel: URI must survive the number formats sites actually store: space
 * groups, dot groups (VN landline style "028.3822.1234") and the +84 country
 * prefix, while the VISIBLE text keeps the stored digits.
 */
describe('telHref (REQ-14 số hóa)', () => {
  it('strips inner and outer whitespace', () => {
    expect(telHref(' 0989 130 345 ')).toBe('tel:0989130345');
  });

  it('strips dot separators (landline style)', () => {
    expect(telHref('028.3822.1234')).toBe('tel:02838221234');
  });

  it('keeps the +84 country prefix', () => {
    expect(telHref('+84 901 234 567')).toBe('tel:+84901234567');
  });

  it('strips spaces AND dots together, + prefix intact', () => {
    expect(telHref(' +84.901.234.567 ')).toBe('tel:+84901234567');
  });

  it('passes an already-plain number through unchanged', () => {
    expect(telHref('0901234567')).toBe('tel:0901234567');
  });
});

describe('TelLink', () => {
  it('renders the stored number as a tel: anchor with the visible digits intact', () => {
    render(<TelLink phone="028.3822.1234" className="tel" />);
    const link = screen.getByRole('link', { name: '028.3822.1234' });
    expect(link).toHaveAttribute('href', 'tel:02838221234');
    expect(link).toHaveClass('tel');
  });

  it('forwards an aria-label to the anchor', () => {
    render(<TelLink phone="0901234567" aria-label="Gọi điện thoại kho" />);
    expect(screen.getByRole('link', { name: 'Gọi điện thoại kho' })).toHaveAttribute('href', 'tel:0901234567');
  });
});
