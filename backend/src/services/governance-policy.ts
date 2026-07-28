import {
  type GovernanceActionKind,
  type GovernanceAllowedAction,
  type GovernanceCapability,
  type GovernanceSubjectType,
  Role,
} from '@tingting/shared';
import { ApiError } from '../errors';

export interface GovernancePolicy {
  actionKind: GovernanceActionKind;
  subjectType: GovernanceSubjectType;
  makerCapability: GovernanceCapability;
  checkerCapability: GovernanceCapability;
  approverCapability: GovernanceCapability;
  makerRoles?: readonly Role[];
  checkerRoles?: readonly Role[];
  approverRoles?: readonly Role[];
  directorApproverCapability?: GovernanceCapability;
  amountThreshold?: number;
  requiresReason: boolean;
  requiresEvidence: boolean;
  evidenceFields: readonly string[];
  requiresExpectedVersion: boolean;
}

const ROLE_CAPABILITIES: Readonly<Record<Role, ReadonlySet<GovernanceCapability>>> = {
  [Role.ADMIN]: new Set([
    'GOVERNANCE_CREATE',
    'FINANCE_CHECK',
    'FINANCE_APPROVE_STANDARD',
    'FINANCE_APPROVE_DIRECTOR',
    'PRICE_APPROVE',
    'PERIOD_CLOSE_APPROVE',
  ]),
  [Role.MANAGER]: new Set([
    'GOVERNANCE_CREATE',
    'FINANCE_CHECK',
    'FINANCE_APPROVE_STANDARD',
    'FINANCE_APPROVE_DIRECTOR',
    'PRICE_APPROVE',
    'PERIOD_CLOSE_APPROVE',
  ]),
  [Role.ACCOUNTANT]: new Set([
    'GOVERNANCE_CREATE',
    'FINANCE_CHECK',
    'FINANCE_APPROVE_STANDARD',
  ]),
  [Role.DRIVER]: new Set(),
  [Role.FORWARDER]: new Set(),
  [Role.CUSTOMER]: new Set(),
  [Role.CLERK]: new Set(),
};

export const GOVERNANCE_POLICY_CATALOG: Readonly<
  Partial<Record<GovernanceActionKind, GovernancePolicy>>
> = {
  PAYMENT_RECEIPT: {
    actionKind: 'PAYMENT_RECEIPT',
    subjectType: 'PAYMENT_RECEIPT',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  PAYMENT_REFUND: {
    actionKind: 'PAYMENT_REFUND',
    subjectType: 'PAYMENT_REFUND',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  VENDOR_PAYMENT: {
    actionKind: 'VENDOR_PAYMENT',
    subjectType: 'VENDOR_PAYMENT',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  CARRIER_PAYMENT: {
    actionKind: 'CARRIER_PAYMENT',
    subjectType: 'CARRIER_PAYMENT',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  DRIVER_PAYOUT: {
    actionKind: 'DRIVER_PAYOUT',
    subjectType: 'DRIVER_PAYOUT',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  COMMISSION: {
    actionKind: 'COMMISSION',
    subjectType: 'COMMISSION',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  PENALTY_CREATE: {
    actionKind: 'PENALTY_CREATE',
    subjectType: 'PENALTY',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  PENALTY_CANCEL: {
    actionKind: 'PENALTY_CANCEL',
    subjectType: 'PENALTY',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  TRIP_AR_ADJUSTMENT: {
    actionKind: 'TRIP_AR_ADJUSTMENT',
    subjectType: 'TRIP',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: true,
    evidenceFields: ['signedAgreementRef'],
    requiresExpectedVersion: true,
  },
  TRIP_REOPEN: {
    actionKind: 'TRIP_REOPEN',
    subjectType: 'TRIP',
    makerCapability: 'FINANCE_APPROVE_DIRECTOR',
    checkerCapability: 'FINANCE_APPROVE_DIRECTOR',
    approverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  TRIP_EXPENSE_APPROVAL: {
    actionKind: 'TRIP_EXPENSE_APPROVAL',
    subjectType: 'TRIP_EXPENSE',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: true,
    evidenceFields: ['evidence'],
    requiresExpectedVersion: true,
  },
  FUEL_INVOICE_CORRECTION: {
    actionKind: 'FUEL_INVOICE_CORRECTION',
    subjectType: 'FUEL_INVOICE',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  FUEL_INVOICE_APPROVAL: {
    actionKind: 'FUEL_INVOICE_APPROVAL',
    subjectType: 'FUEL_INVOICE',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  CREDIT_OVERRIDE_APPROVAL: {
    actionKind: 'CREDIT_OVERRIDE_APPROVAL',
    subjectType: 'CREDIT_OVERRIDE',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  DEBT_OFFSET_APPROVAL: {
    actionKind: 'DEBT_OFFSET_APPROVAL',
    subjectType: 'DEBT_OFFSET',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: true,
    evidenceFields: ['minutesReference'],
    requiresExpectedVersion: true,
  },
  DEBT_OFFSET_CANCEL: {
    actionKind: 'DEBT_OFFSET_CANCEL',
    subjectType: 'DEBT_OFFSET',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  ADVANCE_REQUEST_APPROVAL: {
    actionKind: 'ADVANCE_REQUEST_APPROVAL',
    subjectType: 'ADVANCE_REQUEST',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  ADVANCE_REQUEST_REJECTION: {
    actionKind: 'ADVANCE_REQUEST_REJECTION',
    subjectType: 'ADVANCE_REQUEST',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  ADVANCE_SETTLEMENT_CORRECTION: {
    actionKind: 'ADVANCE_SETTLEMENT_CORRECTION',
    subjectType: 'ADVANCE_SETTLEMENT',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  ADVANCE_SETTLEMENT_REVERSAL: {
    actionKind: 'ADVANCE_SETTLEMENT_REVERSAL',
    subjectType: 'ADVANCE_SETTLEMENT',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  DEBIT_NOTE_ADJUSTMENT: {
    actionKind: 'DEBIT_NOTE_ADJUSTMENT',
    subjectType: 'BILLING_DOCUMENT',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: true,
    evidenceFields: ['originalDocumentId', 'sourceDiffs'],
    requiresExpectedVersion: true,
  },
  DEBIT_NOTE_ISSUE: {
    actionKind: 'DEBIT_NOTE_ISSUE',
    subjectType: 'BILLING_DOCUMENT',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  PRICE_CONFIG_CHANGE: {
    actionKind: 'PRICE_CONFIG_CHANGE',
    subjectType: 'PRICE_CONFIG',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'PRICE_APPROVE',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  SALARY_CONFIRMATION: {
    actionKind: 'SALARY_CONFIRMATION',
    subjectType: 'SALARY_CONFIRMATION',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  SALARY_REOPEN: {
    actionKind: 'SALARY_REOPEN',
    subjectType: 'SALARY_CONFIRMATION',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  SALARY_PERIOD_CLOSE: {
    actionKind: 'SALARY_PERIOD_CLOSE',
    subjectType: 'SALARY_PERIOD',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'PERIOD_CLOSE_APPROVE',
    makerRoles: [Role.ACCOUNTANT],
    checkerRoles: [Role.MANAGER, Role.ADMIN],
    approverRoles: [Role.MANAGER, Role.ADMIN],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: false,
  },
  SALARY_PERIOD_REOPEN: {
    actionKind: 'SALARY_PERIOD_REOPEN',
    subjectType: 'SALARY_PERIOD',
    makerCapability: 'PERIOD_CLOSE_APPROVE',
    checkerCapability: 'PERIOD_CLOSE_APPROVE',
    approverCapability: 'PERIOD_CLOSE_APPROVE',
    makerRoles: [Role.MANAGER, Role.ADMIN],
    checkerRoles: [Role.MANAGER, Role.ADMIN],
    approverRoles: [Role.MANAGER, Role.ADMIN],
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  SALARY_PERIOD_ADJUSTMENT: {
    actionKind: 'SALARY_PERIOD_ADJUSTMENT',
    subjectType: 'SALARY_PERIOD',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  COMPANY_EXPENSE: {
    actionKind: 'COMPANY_EXPENSE',
    subjectType: 'COMPANY_EXPENSE',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  PROFIT_DISTRIBUTION: {
    actionKind: 'PROFIT_DISTRIBUTION',
    subjectType: 'PROFIT_DISTRIBUTION',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  TRIP_FINANCIAL_CHANGE: {
    actionKind: 'TRIP_FINANCIAL_CHANGE',
    subjectType: 'TRIP',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_STANDARD',
    directorApproverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  TRIP_FINANCIAL_CLOSE: {
    actionKind: 'TRIP_FINANCIAL_CLOSE',
    subjectType: 'TRIP',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  ANCILLARY_REVENUE_CHANGE: {
    actionKind: 'ANCILLARY_REVENUE_CHANGE',
    subjectType: 'ANCILLARY_REVENUE',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'PRICE_APPROVE',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
  FINANCIAL_EXCEPTION: {
    actionKind: 'FINANCIAL_EXCEPTION',
    subjectType: 'SALARY_PERIOD',
    makerCapability: 'GOVERNANCE_CREATE',
    checkerCapability: 'FINANCE_CHECK',
    approverCapability: 'FINANCE_APPROVE_DIRECTOR',
    requiresReason: true,
    requiresEvidence: false,
    evidenceFields: [],
    requiresExpectedVersion: true,
  },
};

export interface GovernanceActor {
  actorId: number;
  actorRole: string;
}

export interface GovernanceActionActors {
  actionKind: string;
  status: string;
  makerId: number;
  checkerId: number | null;
}

function capabilitiesForRole(role: string): ReadonlySet<GovernanceCapability> {
  return ROLE_CAPABILITIES[role as Role] ?? new Set();
}

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

function assertCapability(
  actionKind: string,
  role: string,
  stage: 'maker' | 'checker' | 'approver',
): void {
  const policy = policyForAction(actionKind);
  const required = stage === 'maker'
    ? policy.makerCapability
    : stage === 'checker'
      ? policy.checkerCapability
      : policy.approverCapability;
  const allowedRoles = stage === 'maker'
    ? policy.makerRoles
    : stage === 'checker'
      ? policy.checkerRoles
      : policy.approverRoles;
  if (
    !capabilitiesForRole(role).has(required)
    || (allowedRoles && !allowedRoles.includes(role as Role))
  ) {
    throw new ApiError(403, 'Bạn không có quyền thực hiện bước phê duyệt này');
  }
}

export function assertCanMakeGovernanceAction(actionKind: string, role: string): void {
  assertCapability(actionKind, role, 'maker');
}

export function assertCanCheckGovernanceAction(
  action: GovernanceActionActors,
  actor: GovernanceActor,
): void {
  assertCapability(action.actionKind, actor.actorRole, 'checker');
  if (action.makerId === actor.actorId) {
    throw new ApiError(403, 'Người tạo không được tự kiểm tra yêu cầu');
  }
}

export function assertCanApproveGovernanceAction(
  action: GovernanceActionActors,
  actor: GovernanceActor,
): void {
  assertCapability(action.actionKind, actor.actorRole, 'approver');
  if (action.makerId === actor.actorId || action.checkerId === actor.actorId) {
    throw new ApiError(403, 'Người phê duyệt phải khác người tạo và người kiểm tra');
  }
}

export function canViewGovernanceAction(role: string): boolean {
  return capabilitiesForRole(role).size > 0;
}

export function getGovernanceAllowedActions(
  action: GovernanceActionActors,
  actor: GovernanceActor,
): GovernanceAllowedAction[] {
  if (!canViewGovernanceAction(actor.actorRole)) return [];

  const allowed: GovernanceAllowedAction[] = [];
  if (
    actor.actorId === action.makerId
    && ['PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE'].includes(action.status)
  ) {
    allowed.push('CANCEL');
  }

  if (action.status === 'PENDING_CHECK' && actor.actorId !== action.makerId) {
    try {
      assertCanCheckGovernanceAction(action, actor);
      allowed.push('CHECK', 'REJECT', 'RETURN_FOR_EVIDENCE');
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 403) throw error;
    }
  }

  if (
    action.status === 'PENDING_APPROVAL'
    && actor.actorId !== action.makerId
    && actor.actorId !== action.checkerId
  ) {
    try {
      assertCanApproveGovernanceAction(action, actor);
      allowed.push('APPROVE', 'REJECT', 'RETURN_FOR_EVIDENCE');
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 403) throw error;
    }
  }

  return allowed;
}
