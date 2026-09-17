import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Role } from '@tingting/shared';
import { ApiError } from '../../errors';
import { assertCanApplyGovernanceAction, getMissingGovernanceEvidence } from '../../services/governance-policy';

function assertDenied(actionKind: string, role: string) {
  assert.throws(
    () => assertCanApplyGovernanceAction(actionKind, role),
    (error: unknown) => error instanceof ApiError
      && error.statusCode === 403
      && !error.message.includes('phê duyệt'),
  );
}

describe('NO-APP-15: direct action permissions without approval stages', () => {
  it('allows accounting cash operations while denying nonfinancial staff', () => {
    for (const actionKind of ['PAYMENT_RECEIPT', 'PAYMENT_REFUND', 'VENDOR_PAYMENT', 'CARRIER_PAYMENT', 'DRIVER_PAYOUT', 'COMMISSION']) {
      for (const role of [Role.ACCOUNTANT, Role.ADMIN, Role.MANAGER]) {
        assert.doesNotThrow(() => assertCanApplyGovernanceAction(actionKind, role));
      }
      for (const role of [Role.CUS, Role.OPS, Role.DISPATCHER, Role.DRIVER, Role.CUSTOMER]) {
        assertDenied(actionKind, role);
      }
    }
  });

  it('retains management-only close, reopen, treasury and price configuration actions', () => {
    for (const actionKind of ['SALARY_PERIOD_CLOSE', 'SALARY_PERIOD_REOPEN', 'TRIP_FINANCIAL_CLOSE', 'TRIP_REOPEN', 'TREASURY_ACCOUNT_SETUP', 'TREASURY_MOVEMENT_REVERSAL', 'PRICE_CONFIG_CHANGE']) {
      for (const role of [Role.ADMIN, Role.MANAGER]) {
        assert.doesNotThrow(() => assertCanApplyGovernanceAction(actionKind, role));
      }
      assertDenied(actionKind, Role.ACCOUNTANT);
      assertDenied(actionKind, Role.CUS);
    }
  });

  it('retains the accountant-only shipment cost confirmation boundary', () => {
    assert.doesNotThrow(() => assertCanApplyGovernanceAction('SHIPMENT_COST_CONFIRMATION', Role.ACCOUNTANT));
    for (const role of [Role.ADMIN, Role.MANAGER, Role.CUS, Role.DRIVER]) {
      assertDenied('SHIPMENT_COST_CONFIRMATION', role);
    }
  });

  it('fails closed for an unknown role or command', () => {
    assertDenied('PAYMENT_RECEIPT', 'UNKNOWN');
    assert.throws(
      () => assertCanApplyGovernanceAction('UNKNOWN', Role.ADMIN),
      (error: unknown) => error instanceof ApiError && error.statusCode === 409,
    );
  });

  it('does not expose the retired trip, credit or debt approval commands', () => {
    for (const actionKind of ['TRIP_EXPENSE_APPROVAL', 'CREDIT_OVERRIDE_APPROVAL', 'DEBT_OFFSET_APPROVAL',
      'SHIPMENT_REOPEN_REQUEST', 'SHIPMENT_DELETE_REQUEST', 'CONTAINER_EDIT_REQUEST',
      'FUEL_INVOICE_APPROVAL', 'ADVANCE_REQUEST_APPROVAL', 'ADVANCE_REQUEST_REJECTION']) {
      assert.throws(
        () => assertCanApplyGovernanceAction(actionKind, Role.ADMIN),
        (error: unknown) => error instanceof ApiError && error.statusCode === 409,
      );
    }
  });

  it('still requires actual evidence for direct financial adjustments', () => {
    assert.deepEqual(getMissingGovernanceEvidence('TRIP_AR_ADJUSTMENT', null), ['signedAgreementRef']);
    assert.deepEqual(getMissingGovernanceEvidence('TRIP_AR_ADJUSTMENT', { signedAgreementRef: '  ' }), ['signedAgreementRef']);
    assert.deepEqual(getMissingGovernanceEvidence('TRIP_AR_ADJUSTMENT', { signedAgreementRef: 'Agreement 12' }), []);
  });
});
