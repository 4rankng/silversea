import { describe, expect, it } from 'vitest';
import { driverDeliveryDestination, driverLocationLabels, driverTripCodeLabel } from './driver-display';

// Card 091026190530 (FB-082): since the 2026-09-18 delivery-stage ruling the
// return-depot stage is dead BE-side (returnDepotName is always null) and the
// drop chain — the container's dropoff port, else the dispatcher's deliberate
// free-text override — IS the Hạ point in every direction. The mapper must
// not leave an IMPORT drop empty while the same value rides the delivery
// label: that dead "Cảng hạ" row next to "Địa chỉ giao hàng: <bãi hạ>" is
// exactly what the driver reported.
describe('driverLocationLabels — Cảng hạ carries the drop point in every direction', () => {
  it('IMPORT with no distinct return depot shows the drop point as drop, and the delivery stage is destination-owned (FB-082 retest)', () => {
    const labels = driverLocationLabels('IMPORT', 'Bãi ICD Mỹ Đình', null);

    expect(labels.drop).toBe('Bãi ICD Mỹ Đình');
    expect(labels.returnDepot).toBeNull();
    // The mapper no longer emits `delivery` — the delivery row names the
    // factory destination (driverDeliveryDestination), never the drop chain.
    expect('delivery' in labels).toBe(false);
  });

  it('IMPORT keeps a distinct return depot ahead of the delivery point (KP-063 legacy data)', () => {
    const labels = driverLocationLabels('IMPORT', 'Nhà máy Samsung', 'Bãi JJ LOGISTICS');

    expect(labels.drop).toBe('Bãi JJ LOGISTICS');
    expect(labels.returnDepot).toBeNull();
  });

  it('EXPORT and unknown directions are unchanged: drop is the drop point, a distinct depot renders separately', () => {
    const labels = driverLocationLabels(null, 'Sóng Thần', 'Bãi JJ LOGISTICS');

    expect(labels.drop).toBe('Sóng Thần');
    expect(labels.returnDepot).toBe('Bãi JJ LOGISTICS');
  });

  it('trims blank strings to null so the UI named fallback can fire', () => {
    const labels = driverLocationLabels('IMPORT', '   ', '');

    expect(labels.drop).toBeNull();
    expect(labels.returnDepot).toBeNull();
  });
});


// Card 121026141020 (FB-082 retest): the delivery row names the DESTINATION —
// the factory the goods are handed over to — full name + street. Null when
// no destination data exists so callers hide the row instead of echoing the
// discharge yard.
describe('driverDeliveryDestination — the delivery row is destination-owned', () => {
  it('joins the canonical full name and the street address', () => {
    expect(driverDeliveryDestination({
      fullName: 'CÔNG TY TNHH NEWEB VIỆT NAM',
      name: 'NEWEB-1',
      address: 'Lô đất CN01, KCN Đồng Văn III, Phường Đồng Văn, Tỉnh Ninh Bình',
    })).toBe('CÔNG TY TNHH NEWEB VIỆT NAM, Lô đất CN01, KCN Đồng Văn III, Phường Đồng Văn, Tỉnh Ninh Bình');
  });

  it('falls back name-first, then address-only, and hides (null) when nothing exists', () => {
    expect(driverDeliveryDestination({ name: 'Nhà máy Free Text', address: null })).toBe('Nhà máy Free Text');
    expect(driverDeliveryDestination({ name: null, address: 'KCN Đồng Văn III' })).toBe('KCN Đồng Văn III');
    expect(driverDeliveryDestination({ fullName: null, name: '   ', address: '' })).toBeNull();
  });
});

// REQ-07 (client doc, dispatch-approved): the driver app reads the trip code
// in ONE spaced shape — "TRP <year>-<month> · <seq>" — instead of the raw
// generator string. The DB also carries legacy generator shapes (audit
// 2026-10-21: "TRP-C12-53-…", "CN-…", "BULK-TR-…"), which must pass through
// untouched: a real code is never hidden, and a missing one is null so the
// caller hides the row instead of rendering a dash-shaped error.
describe('driverTripCodeLabel — REQ-07 unified trip-code display', () => {
  it('formats a canonical generator code into the spaced driver shape', () => {
    expect(driverTripCodeLabel('TRP-202610-0007')).toBe('TRP 2026-10 · 0007');
  });

  it('trims surrounding whitespace before formatting', () => {
    expect(driverTripCodeLabel('  TRP-202608-7037  ')).toBe('TRP 2026-08 · 7037');
  });

  it('normalizes a short legacy sequence to the 4-digit display width', () => {
    expect(driverTripCodeLabel('TRP-202606-12')).toBe('TRP 2026-06 · 0012');
  });

  it('keeps every digit of a long sequence (never truncates the counter)', () => {
    expect(driverTripCodeLabel('TRP-202608-12345')).toBe('TRP 2026-08 · 12345');
  });

  it('passes legacy generator shapes through untouched (audit rows: TRP-C12-…)', () => {
    expect(driverTripCodeLabel('TRP-C12-53-1791212851260-gvr4vb')).toBe('TRP-C12-53-1791212851260-gvr4vb');
    expect(driverTripCodeLabel('BULK-TR-0001')).toBe('BULK-TR-0001');
    expect(driverTripCodeLabel('CN-MSCU1234561-1')).toBe('CN-MSCU1234561-1');
  });

  it('returns null for a missing code so callers hide the row', () => {
    expect(driverTripCodeLabel(null)).toBeNull();
    expect(driverTripCodeLabel(undefined)).toBeNull();
    expect(driverTripCodeLabel('')).toBeNull();
    expect(driverTripCodeLabel('   ')).toBeNull();
  });
});
