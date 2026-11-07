// SIL-717 (id 837) — the copy-minus-two law of the CUS Tổng quan add-container.
//
// SIL-180's card (221026173728) is the source: "khi thêm dòng container mới,
// tự động copy toàn bộ nội dung dòng trên liền kề, TRỪ thông tin số cont và
// loại cont". The law itself lives in `../containerCopyLaw` (the ONE shared
// owner — this suite pins it); this file pins the CUS adapter over it.
//
// The SIL-180 defect is exactly what this suite guards: the row above's cargo
// metrics never rode, and the lot's type silently re-appeared on the new row.

import { describe, expect, it } from 'vitest';
import type { ShipmentCusWorkspaceContainerLine } from '@tingting/shared';
import {
  CONTAINER_ADD_COPY_KEYS,
  CONTAINER_ADD_EXCLUDED_FIELDS,
  containerAddCopy,
  containerAddSource,
} from '../containerCopyLaw';
import { cusContainerAddCopy, cusContainerAddPayload } from './cusContainerAdd';

function line(over: Partial<ShipmentCusWorkspaceContainerLine> = {}): ShipmentCusWorkspaceContainerLine {
  return {
    id: 11,
    ordinal: 2,
    operationalSiteId: 7,
    containerNumber: 'MSKU1234567',
    declarationNumber: 'TK-01',
    containerTypeId: 4,
    containerTypeLabel: '20DC',
    routeId: 9,
    routeName: 'Hà Nội → Hải Phòng',
    dispatchStatus: 'AWAITING_VEHICLE',
    tripId: null,
    tripStatus: null,
    tripDepartureDate: null,
    carrierType: 'OWN',
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    carrierName: null,
    plateNumber: null,
    liftSiteId: 21,
    liftSite: 'Cảng nâng Hà Nội',
    dropoffSiteId: 22,
    dropoffSite: 'Cảng hạ Hải Phòng',
    customerAppointmentAt: '2026-11-01T07:30:00.000Z',
    raw: {
      containerNumber: 'MSKU1234567',
      containerTypeId: 4,
      cargoWeightKg: '5000.00',
      cargoVolumeCbm: '12.500',
      routeId: 9,
    },
    fieldAccess: {} as ShipmentCusWorkspaceContainerLine['fieldAccess'],
    permissions: {} as ShipmentCusWorkspaceContainerLine['permissions'],
    shipmentVersion: 3,
    relatedTripVersion: null,
    ...over,
  };
}

describe('SIL-717 — the shared copy law (containerCopyLaw)', () => {
  it('the law names the TWO excluded identifiers and the copied field set', () => {
    expect(CONTAINER_ADD_EXCLUDED_FIELDS).toEqual(['containerNumber', 'containerTypeId']);
    expect(CONTAINER_ADD_COPY_KEYS).toEqual([
      'cargoWeightKg',
      'cargoVolumeCbm',
      'routeId',
      'operationalSiteId',
      'liftSiteId',
      'dropoffSiteId',
      'customerAppointmentAt',
    ]);
    // The excluded pair can never ride the copy — the law strips it even when
    // a caller names it.
    const copy = containerAddCopy({
      cargoWeightKg: '5000.00',
      containerNumber: 'MSKU1234567',
      containerTypeId: 4,
    } as never);
    expect(copy).not.toHaveProperty('containerNumber');
    expect(copy).not.toHaveProperty('containerTypeId');
    expect(copy.cargoWeightKg).toBe('5000.00');
  });

  it('the source row is the row DIRECTLY ABOVE — the sheet\'s LAST row', () => {
    const first = line({ id: 1, ordinal: 1, containerNumber: 'AAAA0000001' });
    const second = line({ id: 2, ordinal: 2, containerNumber: 'BBBB0000002' });
    const third = line({ id: 3, ordinal: 3, containerNumber: 'CCCC0000003' });

    expect(containerAddSource([first, second, third])).toBe(third);
    expect(containerAddSource([first, second])).toBe(second);
    expect(containerAddSource([])).toBeNull();
    expect(containerAddSource(null)).toBeNull();
  });
});

describe('SIL-717 — the CUS adapter over the law', () => {
  it('the copy seed carries EVERY field of the row above except the two identifiers', () => {
    const copy = cusContainerAddCopy(line());

    expect(copy).toEqual({
      cargoWeightKg: '5000.00',
      cargoVolumeCbm: '12.500',
      routeId: 9,
      operationalSiteId: 7,
      liftSiteId: 21,
      dropoffSiteId: 22,
      customerAppointmentAt: '2026-11-01T07:30:00.000Z',
    });
    // The excluded pair never reaches the seed — số cont + loại cont are the
    // operator's own entry.
    expect(Object.keys(copy)).not.toContain('containerNumber');
    expect(Object.keys(copy)).not.toContain('containerTypeId');
  });

  it('the wire body sends the copied fields explicitly and the type as an EXPLICIT null', () => {
    const payload = cusContainerAddPayload(cusContainerAddCopy(line()), {
      containerNumber: ' TLLU7654321 ',
      containerTypeId: '',
      cargoWeightKg: '5000.00',
    }, 7);

    // The row above's values ride explicitly (tuyến / nhà máy / cảng / giờ).
    expect(payload).toEqual({
      expectedShipmentVersion: 7,
      containerNumber: 'TLLU7654321',
      // EXPLICIT null — the server must NOT re-copy the lot's loại cont.
      containerTypeId: null,
      cargoWeightKg: '5000.00',
      cargoVolumeCbm: '12.500',
      routeId: 9,
      operationalSiteId: 7,
      liftSiteId: 21,
      dropoffSiteId: 22,
      customerAppointmentAt: '2026-11-01T07:30:00.000Z',
    });
  });

  it('the operator\'s own loại cont rides when they pick one', () => {
    const payload = cusContainerAddPayload(cusContainerAddCopy(line()), {
      containerNumber: 'TLLU7654321',
      containerTypeId: '4',
      cargoWeightKg: '5000.00',
    }, 7);

    expect(payload.containerTypeId).toBe(4);
  });

  it('a lot with no row above yet copies nothing — the new row starts empty', () => {
    expect(cusContainerAddCopy(null)).toEqual({
      cargoWeightKg: null,
      cargoVolumeCbm: null,
      routeId: null,
      operationalSiteId: null,
      liftSiteId: null,
      dropoffSiteId: null,
      customerAppointmentAt: null,
    });

    const payload = cusContainerAddPayload(cusContainerAddCopy(null), {
      containerNumber: 'TLLU7654321',
      containerTypeId: '',
      cargoWeightKg: '',
    }, 1);
    expect(payload.cargoWeightKg).toBeNull();
    expect(payload.customerAppointmentAt).toBeNull();
    expect(payload.containerTypeId).toBeNull();
  });
});
