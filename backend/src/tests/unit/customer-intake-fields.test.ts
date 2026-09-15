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
import type { CustomerCreateInput } from '../../services/customer-intake.service';

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
] as const;

/** A full customer-create payload with every field populated. */
const FULL_PAYLOAD: CustomerCreateInput = {
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

/** Read stripped financial keys off intake results — the Omit<> return type
 * deliberately hides them; asserting on that stripping is the test's point. */
const asRecord = (row: object): Record<string, unknown> => row as Record<string, unknown>;

describe('restrictCustomerCreateForIntake', () => {
  for (const role of [Role.CUS, Role.DISPATCHER]) {
    test(`${role}: strips all 9 financial/material keys`, () => {
      const result = restrictCustomerCreateForIntake(
        FULL_PAYLOAD,
        role,
      );
      for (const key of RESTRICTED_KEYS) {
        assert.equal(
          asRecord(result)[key],
          undefined,
          `${role} must not see "${key}" in intake output`,
        );
      }
    });

    test(`${role}: preserves identity fields (name, taxCode, phone, etc.)`, () => {
      const result = restrictCustomerCreateForIntake(
        FULL_PAYLOAD,
        role,
      );
      assert.equal(asRecord(result).name, 'Công ty ABC');
      assert.equal(asRecord(result).taxCode, '0123456789');
      assert.equal(asRecord(result).phone, '0901234567');
      assert.equal(asRecord(result).email, 'a@abc.vn');
      assert.equal(asRecord(result).address, '123 Nguyễn Huệ');
    });
  }

  for (const role of [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]) {
    test(`${role}: passes all fields through unchanged`, () => {
      const result = restrictCustomerCreateForIntake(
        FULL_PAYLOAD,
        role,
      );
      for (const key of RESTRICTED_KEYS) {
        assert.deepEqual(
          asRecord(result)[key],
          asRecord(FULL_PAYLOAD)[key],
          `${role} should retain "${key}"`,
        );
      }
    });
  }
});

describe('restrictCustomerUpdateForIntake', () => {
  for (const role of [Role.CUS, Role.DISPATCHER]) {
    test(`${role}: strips financial keys from partial update`, () => {
      const partial: Partial<CustomerCreateInput> = {
        name: 'Tên mới',
        creditLimit: 999_999_999,
        paymentTermDays: 60,
        debitNoteMode: 'PER_SHIPMENT',
      };
      const result = restrictCustomerUpdateForIntake(partial, role);
      assert.equal(asRecord(result).name, 'Tên mới');
      assert.equal(asRecord(result).creditLimit, undefined);
      assert.equal(asRecord(result).paymentTermDays, undefined);
      assert.equal(asRecord(result).debitNoteMode, undefined);
    });

    test(`${role}: preserves isCarrier on update for carrier intake`, () => {
      const partial: Partial<CustomerCreateInput> = { status: 'INACTIVE', isCarrier: true, shortName: 'NEW' };
      const result = restrictCustomerUpdateForIntake(partial, role);
      assert.equal(asRecord(result).status, undefined);
      assert.equal(asRecord(result).isCarrier, true);
      assert.equal(asRecord(result).shortName, 'NEW');
    });
  }

  for (const role of [Role.ADMIN, Role.MANAGER]) {
    test(`${role}: passes all update fields through`, () => {
      const partial: Partial<CustomerCreateInput> = { creditLimit: 1_000_000, status: 'ACTIVE' };
      const result = restrictCustomerUpdateForIntake(partial, role);
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
