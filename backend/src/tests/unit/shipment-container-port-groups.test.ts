import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupShipmentAppointmentGroups,
  groupShipmentContainerPortGroups,
} from '../../services/shipment-queries.service';

test('groups lift and drop locations by the container pair instead of shipment fields', () => {
  const groups = groupShipmentContainerPortGroups([
    { shipmentId: 41, pickupPortName: 'TC - HICT', dropoffPortName: 'Nhà máy Bắc Giang', containerTypeCode: '40DC', containerTypeName: null },
    { shipmentId: 41, pickupPortName: 'Cảng Hải Phòng', dropoffPortName: 'Kho Long Biên', containerTypeCode: '20DC', containerTypeName: null },
    { shipmentId: 41, pickupPortName: 'TC - HICT', dropoffPortName: 'Nhà máy Bắc Giang', containerTypeCode: '40DC', containerTypeName: null },
  ]);

  assert.deepEqual(groups.get(41), [
    { pickupPortName: 'TC - HICT', dropoffPortName: 'Nhà máy Bắc Giang', containerSummary: '2 x 40DC' },
    { pickupPortName: 'Cảng Hải Phòng', dropoffPortName: 'Kho Long Biên', containerSummary: '1 x 20DC' },
  ]);
});

test('groups appointments only after their effective factory has been resolved', () => {
  const groups = groupShipmentAppointmentGroups([
    { shipmentId: 41, at: new Date('2026-08-24T18:30:00.000Z'), factoryName: 'Nhà máy Bắc Giang', containerTypeCode: '40DC', containerTypeName: null },
    { shipmentId: 41, at: new Date('2026-08-24T18:30:00.000Z'), factoryName: 'Nhà máy Bắc Giang', containerTypeCode: '20DC', containerTypeName: null },
  ]);

  assert.deepEqual(groups.get(41), [{
    at: '2026-08-24T18:30:00.000Z',
    localDate: '2026-08-25',
    factoryName: 'Nhà máy Bắc Giang',
    containerSummary: '1 x 20DC + 1 x 40DC',
  }]);
});
