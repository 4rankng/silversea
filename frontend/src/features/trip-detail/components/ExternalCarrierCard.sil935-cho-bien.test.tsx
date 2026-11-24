// SIL-935 (KB §7.2.1 K7.20) — chi tiết chuyến (/trips/:id): the external
// carrier card's BIỂN SỐ XE row names the awaiting-plate state with the
// 'Chờ biển' chip instead of a silent dash. A present plate keeps the row
// exactly as before.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TripDerivedData } from '../types';
import { ExternalCarrierCard } from './ExternalCarrierCard';

// The chip branch reads no money field — a minimal derived cast is enough for
// this pin, and the component renders the margin row only when non-null.
const derived = { externalMargin: null } as TripDerivedData;

const base = {
  derived,
  carrierName: '4GS',
  driverName: null,
  driverPhone: null,
  freightCost: 0,
};

describe('SIL-935 — chi tiết chuyến hiển thị chip Chờ biển', () => {
  it('xe ngoài chưa có biển → chip Chờ biển trên dòng Biển số xe', () => {
    render(<ExternalCarrierCard {...base} plateNumber={null} />);
    expect(screen.getByText('Chờ biển')).toBeTruthy();
    expect(screen.getByText('Biển số xe')).toBeTruthy();
  });

  it('xe ngoài có biển → chỉ biển số, không chip', () => {
    render(<ExternalCarrierCard {...base} plateNumber="29K-777.77" />);
    expect(screen.getByText('29K-777.77')).toBeTruthy();
    expect(screen.queryByText('Chờ biển')).toBeNull();
  });
});
