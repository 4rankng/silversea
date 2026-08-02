import { z } from 'zod';

export const GOVERNANCE_SUBJECT_TYPES = [
  'TRIP',
  'PAYMENT_RECEIPT',
  'PAYMENT_REFUND',
  'VENDOR_PAYMENT',
  'CARRIER_PAYMENT',
  'DRIVER_PAYOUT',
  'COMMISSION',
  'PENALTY',
  'DEBT_OFFSET',
  'ADVANCE_REQUEST',
  'ADVANCE_SETTLEMENT',
  'TRIP_EXPENSE',
  'FUEL_INVOICE',
  'CREDIT_OVERRIDE',
  'COMPANY_EXPENSE',
  'BILLING_DOCUMENT',
  'SALARY_CONFIRMATION',
  'SALARY_PERIOD',
  'PROFIT_DISTRIBUTION',
  'PRICE_CONFIG',
  'ANCILLARY_REVENUE',
  'EXCEPTION',
  'TREASURY_ACCOUNT',
  'TREASURY_MOVEMENT',
] as const;

export const GOVERNANCE_ACTION_KINDS = [
  'TRIP_AR_ADJUSTMENT',
  'TRIP_REOPEN',
  'TRIP_EXPENSE_APPROVAL',
  'FUEL_INVOICE_CORRECTION',
  'FUEL_INVOICE_APPROVAL',
  'CREDIT_OVERRIDE_APPROVAL',
  'DEBT_OFFSET_APPROVAL',
  'DEBT_OFFSET_CANCEL',
  'ADVANCE_REQUEST_APPROVAL',
  'ADVANCE_REQUEST_REJECTION',
  'ADVANCE_SETTLEMENT_CORRECTION',
  'ADVANCE_SETTLEMENT_REVERSAL',
  'PAYMENT_RECEIPT',
  'PAYMENT_REFUND',
  'VENDOR_PAYMENT',
  'CARRIER_PAYMENT',
  'DRIVER_PAYOUT',
  'COMMISSION',
  'PENALTY_CREATE',
  'PENALTY_CANCEL',
  'COMPANY_EXPENSE',
  'PROFIT_DISTRIBUTION',
  'TRIP_FINANCIAL_CHANGE',
  'TRIP_FINANCIAL_CLOSE',
  'DEBIT_NOTE_ISSUE',
  'DEBIT_NOTE_ADJUSTMENT',
  'SALARY_CONFIRMATION',
  'SALARY_REOPEN',
  'SALARY_PERIOD_CLOSE',
  'SALARY_PERIOD_REOPEN',
  'SALARY_PERIOD_ADJUSTMENT',
  'PRICE_CONFIG_CHANGE',
  'ANCILLARY_REVENUE_CHANGE',
  'FINANCIAL_EXCEPTION',
  'TREASURY_ACCOUNT_SETUP',
  'TREASURY_CUTOVER',
  'TREASURY_MOVEMENT_REVERSAL',
] as const;

export const GOVERNANCE_ACTION_STATUSES = [
  'PENDING_CHECK',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'RETURNED_FOR_EVIDENCE',
  'CANCELED',
  'SUPERSEDED',
] as const;

export const GOVERNANCE_CAPABILITIES = [
  'GOVERNANCE_CREATE',
  'FINANCE_CHECK',
  'FINANCE_APPROVE_STANDARD',
  'FINANCE_APPROVE_DIRECTOR',
  'PRICE_APPROVE',
  'PERIOD_CLOSE_APPROVE',
  'RECOVERABLE_COST_REQUEST',
  'TRIP_CLOSE_REQUEST',
  'TREASURY_OPERATE',
  'TREASURY_ADMIN',
] as const;

export const GOVERNANCE_ALLOWED_ACTIONS = [
  'CHECK',
  'APPROVE',
  'REJECT',
  'RETURN_FOR_EVIDENCE',
  'CANCEL',
] as const;

export type GovernanceSubjectType = typeof GOVERNANCE_SUBJECT_TYPES[number];
export type GovernanceActionKind = typeof GOVERNANCE_ACTION_KINDS[number];
export type GovernanceActionStatus = typeof GOVERNANCE_ACTION_STATUSES[number];
export type GovernanceCapability = typeof GOVERNANCE_CAPABILITIES[number];
export type GovernanceAllowedAction = typeof GOVERNANCE_ALLOWED_ACTIONS[number];

export const governanceActionVersionSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
});

export const governanceActionDecisionSchema = governanceActionVersionSchema.extend({
  reason: z.string().trim().min(1, 'Lý do là bắt buộc').max(1000),
});

export const governanceActionListQuerySchema = z.object({
  status: z.enum(GOVERNANCE_ACTION_STATUSES).optional(),
  actionKind: z.enum(GOVERNANCE_ACTION_KINDS).optional(),
  subjectType: z.enum(GOVERNANCE_SUBJECT_TYPES).optional(),
  subjectId: z.coerce.number().int().positive().optional(),
  subjectKey: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type GovernanceActionVersionInput = z.infer<typeof governanceActionVersionSchema>;
export type GovernanceActionDecisionInput = z.infer<typeof governanceActionDecisionSchema>;
export type GovernanceActionListQuery = z.infer<typeof governanceActionListQuerySchema>;
