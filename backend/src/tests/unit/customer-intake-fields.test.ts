/**
 * Customer Intake Field Stripping — CUS-SHIP-04, TC-RBAC-014
 *
 * CUS and DISPATCHER may create customers inline from the shipment intake
 * flow, but they must NOT be able to set financial/material fields
 * (creditLimit, paymentTermDays, debitNoteMode, etc.).  The intake
 * service strips those keys before the DB insert.
 *
 * Admin/MANAGER/ACCOUNTANT keep all fields — they are full customer
 * administrators.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '@tingting/shared';
import {
  restrictCustomerCreateForIntake,
  restrictCustomerUpdateForIntake,
  intakeCreatedBy,
} from '../../services/customer-intake.service';

const RESTRICTED_KEYS = [
  'creditLimit',
  'creditWarningThreshold',
  'paymentTermDays',
  'paymentDatePolicy',
  'fuelSurchargeSharePct',
  'debitNoteMode',
  'debitNoteTemplateId',
  'linkedSupplierId',
  'status',
  'isCarrier',
] as const;

/** A full customer-create payload with every field populated. */
const FULL_PAYLOAD: Record<string, unknown> = {
  name: 'Công ty ABC',
  shortName: 'ABC',
  taxCode: '0123456789',
  contactPerson: 'Nguyễn Văn A',
  phone: '0901234567',
  email: 'a@abc.vn',
  address: '123 Nguyễn Huệ',
  creditLimit: 500_000_000,
  creditWarningThreshold: 0.8,
  paymentTermDays: 30,
  paymentDatePolicy: 'END_OF_MONTH',
  fuelSurchargeSharePct: 50,
  debitNoteMode: 'PER_SHIPMENT',
  debitNoteTemplateId: 7,
  linkedSupplierId: 42,
  status: 'ACTIVE',
  isCarrier: false,
};

describe('restrictCustomerCreateForIntake', () => {
  for (const role of [Role.CUS, Role.DISPATCHER]) {
    test(`${role}: strips all 10 financial/material keys`, () => {
      const result = restrictCustomerCreateForIntake(
        FULL_PAYLOAD as any,
        role,
      );
      for (const key of RESTRICTED_KEYS) {
        assert.equal(
          (result as any)[key],
          undefined,
          `${role} must not see "${key}" in intake output`,
        );
      }
    });

    test(`${role}: preserves identity fields (name, taxCode, phone, etc.)`, () => {
      const result = restrictCustomerCreateForIntake(
        FULL_PAYLOAD as any,
        role,
      );
      assert.equal((result as any).name, 'Công ty ABC');
      assert.equal((result as any).taxCode, '0123456789');
      assert.equal((result as any).phone, '0901234567');
      assert.equal((result as any).email, 'a@abc.vn');
      assert.equal((result as any).address, '123 Nguyễn Huệ');
    });
  }

  for (const role of [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]) {
    test(`${role}: passes all fields through unchanged`, () => {
      const result = restrictCustomerCreateForIntake(
        FULL_PAYLOAD as any,
        role,
      );
      for (const key of RESTRICTED_KEYS) {
        assert.deepEqual(
          (result as any)[key],
          (FULL_PAYLOAD as any)[key],
          `${role} should retain "${key}"`,
        );
      }
    });
  }
});

describe('restrictCustomerUpdateForIntake', () => {
  for (const role of [Role.CUS, Role.DISPATCHER]) {
    test(`${role}: strips financial keys from partial update`, () => {
      const partial = {
        name: 'Tên mới',
        creditLimit: 999_999_999,
        paymentTermDays: 60,
        debitNoteMode: 'PER_SHIPMENT',
      };
      const result = restrictCustomerUpdateForIntake(partial as any, role);
      assert.equal((result as any).name, 'Tên mới');
      assert.equal((result as any).creditLimit, undefined);
      assert.equal((result as any).paymentTermDays, undefined);
      assert.equal((result as any).debitNoteMode, undefined);
    });

    test(`${role}: strips status and isCarrier from update`, () => {
      const partial = { status: 'INACTIVE', isCarrier: true, shortName: 'NEW' };
      const result = restrictCustomerUpdateForIntake(partial as any, role);
      assert.equal((result as any).status, undefined);
      assert.equal((result as any).isCarrier, undefined);
      assert.equal((result as any).shortName, 'NEW');
    });
  }

  for (const role of [Role.ADMIN, Role.MANAGER]) {
    test(`${role}: passes all update fields through`, () => {
      const partial = { creditLimit: 1_000_000, status: 'ACTIVE' };
      const result = restrictCustomerUpdateForIntake(partial as any, role);
      assert.deepEqual(result, partial);
    });
  }
});

describe('intakeCreatedBy', () => {
  test('CUS stamps the acting user id', () => {
    assert.equal(intakeCreatedBy(Role.CUS, 42), 42);
  });

  test('DISPATCHER stamps the acting user id', () => {
    assert.equal(intakeCreatedBy(Role.DISPATCHER, 99), 99);
  });

  test('ADMIN does not stamp (null)', () => {
    assert.equal(intakeCreatedBy(Role.ADMIN, 1), null);
  });

  test('MANAGER does not stamp (null)', () => {
    assert.equal(intakeCreatedBy(Role.MANAGER, 1), null);
  });
});
