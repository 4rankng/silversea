import {
  type GovernanceActionKind,
  type GovernanceSubjectType,
  Role,
} from '@tingting/shared';
import { ApiError } from '../errors';

export interface GovernancePolicy {
  actionKind: GovernanceActionKind;
  subjectType: GovernanceSubjectType;
  /** Roles allowed to construct this direct command; retained for existing callers. */
  createRoles: readonly Role[];
  /** Roles allowed to apply the command to the authoritative domain records. */
  applyRoles: readonly Role[];
  requiresReason: boolean;
  requiresEvidence: boolean;
  evidenceFields: readonly string[];
  requiresExpectedVersion: boolean;
}

export const GOVERNANCE_POLICY_CATALOG: Readonly<
  Partial<Record<GovernanceActionKind, GovernancePolicy>>
> = {
  PAYMENT_RECEIPT: {
    actionKind: 'PAYMENT_RECEIPT',
    subjectType: 'PAYMENT_RECEIPT',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  PAYMENT_REFUND: {
    actionKind: 'PAYMENT_REFUND',
    subjectType: 'PAYMENT_REFUND',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  VENDOR_PAYMENT: {
    actionKind: 'VENDOR_PAYMENT',
    subjectType: 'VENDOR_PAYMENT',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  CARRIER_PAYMENT: {
    actionKind: 'CARRIER_PAYMENT',
    subjectType: 'CARRIER_PAYMENT',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  DRIVER_PAYOUT: {
    actionKind: 'DRIVER_PAYOUT',
    subjectType: 'DRIVER_PAYOUT',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  COMMISSION: {
    actionKind: 'COMMISSION',
    subjectType: 'COMMISSION',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  PENALTY_CREATE: {
    actionKind: 'PENALTY_CREATE',
    subjectType: 'PENALTY',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  PENALTY_CANCEL: {
    actionKind: 'PENALTY_CANCEL',
    subjectType: 'PENALTY',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  TRIP_AR_ADJUSTMENT: {
    actionKind: 'TRIP_AR_ADJUSTMENT',
    subjectType: 'TRIP',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: true,
    evidenceFields: ['signedAgreementRef'],
    requiresExpectedVersion: true,
  },
  TRIP_REOPEN: {
    actionKind: 'TRIP_REOPEN',
    subjectType: 'TRIP',
    createRoles: [Role.ADMIN, Role.MANAGER],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  SHIPMENT_COST_CONFIRMATION: {
    actionKind: 'SHIPMENT_COST_CONFIRMATION',
    subjectType: 'SHIPMENT',
    createRoles: [Role.ACCOUNTANT],
    applyRoles: [Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  FUEL_INVOICE_CORRECTION: {
    actionKind: 'FUEL_INVOICE_CORRECTION',
    subjectType: 'FUEL_INVOICE',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  DEBT_OFFSET_CANCEL: {
    actionKind: 'DEBT_OFFSET_CANCEL',
    subjectType: 'DEBT_OFFSET',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  ADVANCE_SETTLEMENT_CORRECTION: {
    actionKind: 'ADVANCE_SETTLEMENT_CORRECTION',
    subjectType: 'ADVANCE_SETTLEMENT',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  ADVANCE_SETTLEMENT_REVERSAL: {
    actionKind: 'ADVANCE_SETTLEMENT_REVERSAL',
    subjectType: 'ADVANCE_SETTLEMENT',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  DEBIT_NOTE_ADJUSTMENT: {
    actionKind: 'DEBIT_NOTE_ADJUSTMENT',
    subjectType: 'BILLING_DOCUMENT',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: true,
    evidenceFields: ['originalDocumentId', 'sourceDiffs'],
    requiresExpectedVersion: true,
  },
  DEBIT_NOTE_ISSUE: {
    actionKind: 'DEBIT_NOTE_ISSUE',
    subjectType: 'BILLING_DOCUMENT',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  PRICE_CONFIG_CHANGE: {
    actionKind: 'PRICE_CONFIG_CHANGE',
    subjectType: 'PRICE_CONFIG',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  SALARY_CONFIRMATION: {
    actionKind: 'SALARY_CONFIRMATION',
    subjectType: 'SALARY_CONFIRMATION',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  SALARY_REOPEN: {
    actionKind: 'SALARY_REOPEN',
    subjectType: 'SALARY_CONFIRMATION',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  SALARY_PERIOD_CLOSE: {
    actionKind: 'SALARY_PERIOD_CLOSE',
    subjectType: 'SALARY_PERIOD',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  SALARY_PERIOD_REOPEN: {
    actionKind: 'SALARY_PERIOD_REOPEN',
    subjectType: 'SALARY_PERIOD',
    createRoles: [Role.ADMIN, Role.MANAGER],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  SALARY_PERIOD_ADJUSTMENT: {
    actionKind: 'SALARY_PERIOD_ADJUSTMENT',
    subjectType: 'SALARY_PERIOD',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  COMPANY_EXPENSE: {
    actionKind: 'COMPANY_EXPENSE',
    subjectType: 'COMPANY_EXPENSE',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  PROFIT_DISTRIBUTION: {
    actionKind: 'PROFIT_DISTRIBUTION',
    subjectType: 'PROFIT_DISTRIBUTION',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  TRIP_FINANCIAL_CHANGE: {
    actionKind: 'TRIP_FINANCIAL_CHANGE',
    subjectType: 'TRIP',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  TRIP_FINANCIAL_CLOSE: {
    actionKind: 'TRIP_FINANCIAL_CLOSE',
    subjectType: 'TRIP',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  ANCILLARY_REVENUE_CHANGE: {
    actionKind: 'ANCILLARY_REVENUE_CHANGE',
    subjectType: 'ANCILLARY_REVENUE',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  FINANCIAL_EXCEPTION: {
    actionKind: 'FINANCIAL_EXCEPTION',
    subjectType: 'SALARY_PERIOD',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  TREASURY_ACCOUNT_SETUP: {
    actionKind: 'TREASURY_ACCOUNT_SETUP',
    subjectType: 'TREASURY_ACCOUNT',
    createRoles: [Role.ADMIN, Role.MANAGER],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: true,
    evidenceFields: ['openingBalanceEvidence'],
    requiresExpectedVersion: false,
  },
  TREASURY_CUTOVER: {
    actionKind: 'TREASURY_CUTOVER',
    subjectType: 'TREASURY_ACCOUNT',
    createRoles: [Role.ADMIN, Role.MANAGER],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: true,
    evidenceFields: ['cutoverEvidence'],
    requiresExpectedVersion: true,
  },
  TREASURY_MOVEMENT_REVERSAL: {
    actionKind: 'TREASURY_MOVEMENT_REVERSAL',
    subjectType: 'TREASURY_MOVEMENT',
    createRoles: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
    applyRoles: [Role.ADMIN, Role.MANAGER],
    requiresReason: true,
    requiresEvidence: true,
    evidenceFields: ['reversalEvidence'],
    requiresExpectedVersion: true,
  },
};

function policyForAction(actionKind: string): GovernancePolicy {
  const policy = GOVERNANCE_POLICY_CATALOG[actionKind as GovernanceActionKind];
  if (!policy) {
    throw new ApiError(409, 'Loại yêu cầu chưa có chính sách quản trị');
  }
  return policy;
}

export function getGovernancePolicy(actionKind: string): GovernancePolicy {
  return policyForAction(actionKind);
}

export function getMissingGovernanceEvidence(
  actionKind: string,
  evidence: Record<string, unknown> | null,
): string[] {
  const policy = policyForAction(actionKind);
  if (!policy.requiresEvidence) return [];
  return policy.evidenceFields.filter((field) => {
    const value = evidence?.[field];
    return value == null || (typeof value === 'string' && value.trim() === '');
  });
}

function assertRole(role: string, allowedRoles: readonly Role[]): void {
  if (!allowedRoles.includes(role as Role)) {
    throw new ApiError(403, 'Bạn không có quyền thực hiện thao tác này');
  }
}

export function assertCanMakeGovernanceAction(actionKind: string, role: string): void {
  assertRole(role, policyForAction(actionKind).createRoles);
}

/** Direct command authorization. There are no check/approve stages or actor handoffs. */
export function assertCanApplyGovernanceAction(actionKind: string, role: string): void {
  assertRole(role, policyForAction(actionKind).applyRoles);
}
