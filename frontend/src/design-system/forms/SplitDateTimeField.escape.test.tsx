import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SplitDateTimeField } from './SplitDateTimeField';

// Regression lock for the 2026-09-19 Escape hunt (_13): Escape is the
// standard dismiss key on every dialog and picker. These pins assert it only
// closes the open surface and NEVER moves the router path — the reported
// /help jumps were traced to a degraded automation session, not app code,
// and this file keeps that verdict honest if the shell ever changes.
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="escape-path-probe">{location.pathname}</span>;
}

function Harness() {
  const [value, setValue] = useState('');
  return (
    <MemoryRouter initialEntries={['/shipments/new']}>
      <SplitDateTimeField label="Ngày giờ đóng trả" value={value} onChange={setValue} />
      <LocationProbe />
    </MemoryRouter>
  );
}

const pathNow = () => screen.getByTestId('escape-path-probe').textContent;

describe('SplitDateTimeField Escape behavior (card _13 regression lock)', () => {
  it('closes the open time picker without navigating', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở bộ chọn giờ — Ngày giờ đóng trả' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pathNow()).toBe('/shipments/new');
  });

  it('closes the open date picker without navigating', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở lịch — Ngày giờ đóng trả' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pathNow()).toBe('/shipments/new');
  });

  it('leaves the path untouched when Escape fires on a segment with no picker open', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByLabelText('Giờ — Ngày giờ đóng trả'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pathNow()).toBe('/shipments/new');
  });
});
