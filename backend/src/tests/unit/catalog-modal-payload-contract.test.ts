import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truckSchema, routeSchema, driverSchema } from '@tingting/shared';

/**
 * Contract guard: every field the catalog edit modals send must survive zod
 * parsing. The CRUD factory SETs only schema-parsed keys, so a field missing
 * from the schema is silently dropped on create/update — the modal "saves",
 * returns 200, and the edit silently reverts (bug class found on staging
 * 2026-09-06: truck spec-sheet fields, route code/loadPoint/note, driver
 * identity/bank fields). Payloads below mirror the frontend modals verbatim,
 * including how blanks travel: `x.trim() || undefined` (key absent after
 * JSON) vs `x !== '' ? x : null` (key present as null).
 */

test('truckSchema keeps every TruckFormModal field', () => {
  // Full create payload (FleetVehiclesView / truck-card → POST /trucks).
  const created = truckSchema.parse({
    licensePlate: '15E-016.26',
    vehicleClass: '2 CẦU 3 DÀN',
    brand: 'Hyundai',
    towCapacityTons: 40,
    fuelLPer100kmLoaded: 28.5,
    fuelLPer100kmEmpty: 22,
    nextInspectionDate: null,
    insuranceExpiryDate: null,
    note: 'ghi chú',
  });
  assert.equal(created.vehicleClass, '2 CẦU 3 DÀN');
  assert.equal(created.brand, 'Hyundai');
  assert.equal(created.towCapacityTons, 40);
  assert.equal(created.fuelLPer100kmLoaded, 28.5);
  assert.equal(created.fuelLPer100kmEmpty, 22);
  assert.equal(created.note, 'ghi chú');

  // Update path: crud-factory parses createSchema.partial(); a numeric field
  // cleared in the modal arrives as null and must stay null (not dropped,
  // otherwise the column keeps its old value instead of clearing).
  const updated = truckSchema.partial().parse({
    brand: 'Volvo',
    towCapacityTons: null,
  });
  assert.equal(updated.brand, 'Volvo');
  assert.equal('towCapacityTons' in updated && updated.towCapacityTons, null);
});

test('routeSchema keeps every RouteFormModal field', () => {
  const created = routeSchema.parse({
    name: 'KCN Đồng Văn, Ninh Bình',
    shortName: 'KCN ĐỒNG VĂN',
    code: 'T01',
    distanceKm: 120,
    loadPoint: 'KCN Đồng Văn → Yên Phong',
    note: 'tuyến nặng',
  });
  assert.equal(created.code, 'T01');
  assert.equal(created.loadPoint, 'KCN Đồng Văn → Yên Phong');
  assert.equal(created.note, 'tuyến nặng');

  // Modal sends `x.trim() || null` for these when blank — null must survive.
  const cleared = routeSchema.partial().parse({ code: null, loadPoint: null, note: null });
  assert.equal('code' in cleared && cleared.code, null);
  assert.equal('loadPoint' in cleared && cleared.loadPoint, null);
  assert.equal('note' in cleared && cleared.note, null);
});

test('driverSchema keeps every DriverFormModal field', () => {
  const created = driverSchema.parse({
    code: 'TX001',
    name: 'Nguyễn Văn A',
    idNumber: '0123456789',
    licenseNumber: 'B2',
    licenseExpiryDate: '2027-05-01',
    phone: '0912000000',
    bankName: 'VCB',
    bankAccount: '0123456789',
    salaryType: 'LUONG CUNG',
  });
  assert.equal(created.code, 'TX001');
  assert.equal(created.idNumber, '0123456789');
  assert.equal(created.licenseNumber, 'B2');
  assert.equal(created.licenseExpiryDate, '2027-05-01');
  assert.equal(created.bankName, 'VCB');
  assert.equal(created.bankAccount, '0123456789');
  assert.equal(created.salaryType, 'LUONG CUNG');

  // Cleared date arrives as null and must survive as null.
  const updated = driverSchema.partial().parse({ licenseExpiryDate: null });
  assert.equal('licenseExpiryDate' in updated && updated.licenseExpiryDate, null);
});
