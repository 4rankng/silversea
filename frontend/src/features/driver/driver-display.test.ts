import { describe, expect, it } from 'vitest';
import { driverLocationLabels } from './driver-display';

// Card 091026190530 (FB-082): since the 2026-09-18 delivery-stage ruling the
// return-depot stage is dead BE-side (returnDepotName is always null) and the
// drop chain — the container's dropoff port, else the dispatcher's deliberate
// free-text override — IS the Hạ point in every direction. The mapper must
// not leave an IMPORT drop empty while the same value rides the delivery
// label: that dead "Cảng hạ" row next to "Địa chỉ giao hàng: <bãi hạ>" is
// exactly what the driver reported.
describe('driverLocationLabels — Cảng hạ carries the drop point in every direction', () => {
  it('IMPORT with no distinct return depot shows the drop point as drop (FB-082)', () => {
    const labels = driverLocationLabels('IMPORT', 'Bãi ICD Mỹ Đình', null);

    expect(labels.drop).toBe('Bãi ICD Mỹ Đình');
    expect(labels.delivery).toBe('Bãi ICD Mỹ Đình');
    expect(labels.returnDepot).toBeNull();
  });

  it('IMPORT keeps a distinct return depot ahead of the delivery point (KP-063 legacy data)', () => {
    const labels = driverLocationLabels('IMPORT', 'Nhà máy Samsung', 'Bãi JJ LOGISTICS');

    expect(labels.drop).toBe('Bãi JJ LOGISTICS');
    expect(labels.delivery).toBe('Nhà máy Samsung');
    expect(labels.returnDepot).toBeNull();
  });

  it('EXPORT and unknown directions are unchanged: drop is the drop point, a distinct depot renders separately', () => {
    const labels = driverLocationLabels(null, 'Sóng Thần', 'Bãi JJ LOGISTICS');

    expect(labels.drop).toBe('Sóng Thần');
    expect(labels.delivery).toBeNull();
    expect(labels.returnDepot).toBe('Bãi JJ LOGISTICS');
  });

  it('trims blank strings to null so the UI named fallback can fire', () => {
    const labels = driverLocationLabels('IMPORT', '   ', '');

    expect(labels.drop).toBeNull();
    expect(labels.delivery).toBeNull();
    expect(labels.returnDepot).toBeNull();
  });
});
