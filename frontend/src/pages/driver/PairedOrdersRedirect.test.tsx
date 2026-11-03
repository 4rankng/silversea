// SIL-664 — the retired /my-trips/two-orders path must never 404: it forwards
// to /my-trips/paired-orders carrying the original ?date= query along.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import PairedOrdersRedirect from './PairedOrdersRedirect';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}{location.search}</div>;
}

function renderAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/my-trips/two-orders" element={<PairedOrdersRedirect />} />
        <Route path="/my-trips/paired-orders" element={<LocationProbe />} />
        <Route path="*" element={<div>404</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PairedOrdersRedirect — old route keeps working (SIL-664)', () => {
  it('forwards /my-trips/two-orders?date=X to /my-trips/paired-orders?date=X', () => {
    renderAt('/my-trips/two-orders?date=2026-11-04');
    expect(screen.getByTestId('location-probe').textContent).toBe('/my-trips/paired-orders?date=2026-11-04');
  });

  it('forwards the bare old path without appending a query string', () => {
    renderAt('/my-trips/two-orders');
    expect(screen.getByTestId('location-probe').textContent).toBe('/my-trips/paired-orders');
  });
});
