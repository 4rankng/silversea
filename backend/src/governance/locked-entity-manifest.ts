import type { GovernanceActionKind } from '@tingting/shared';

/**
 * A binding is intentionally made to a named TypeScript declaration rather
 * than to a whole file. The exhaustive Q18 test resolves the declaration with
 * the TypeScript AST and checks every required fragment inside that declaration.
 */
export interface SourceDeclarationBinding {
  file: string;
  symbol: string;
  requiredFragments: readonly string[];
}

/**
 * Proofs are bound to one named node:test/Vitest block. This prevents an
 * unrelated assertion elsewhere in the file from satisfying the inventory.
 */
export interface ExecutableProofBinding {
  file: string;
  testName: string;
  requiredFragments: readonly string[];
}

export interface GovernedActionBinding {
  actionKind: GovernanceActionKind;
  requestBoundary: SourceDeclarationBinding;
  actionKindAuthority?: SourceDeclarationBinding;
  proof: ExecutableProofBinding;
}

export interface LockedEntityBoundary {
  entity: string;
  terminalStates: readonly string[];
  stateAuthority: SourceDeclarationBinding;
  directMutationBoundary: SourceDeclarationBinding;
  directMutationProof: ExecutableProofBinding;
  governedActions: readonly GovernedActionBinding[];
  reopenPolicy: 'NEVER' | 'PRE_IRREVERSIBLE_MILESTONE_ONLY';
}

const source = (
  file: string,
  symbol: string,
  ...requiredFragments: string[]
): SourceDeclarationBinding => ({ file, symbol, requiredFragments });

const proof = (
  file: string,
  testName: string,
  ...requiredFragments: string[]
): ExecutableProofBinding => ({ file, testName, requiredFragments });

const action = (
  actionKind: GovernanceActionKind,
  requestBoundary: SourceDeclarationBinding,
  executableProof: ExecutableProofBinding,
): GovernedActionBinding => ({ actionKind, requestBoundary, proof: executableProof });

const tripArAdjustment = action(
  'TRIP_AR_ADJUSTMENT',
  source(
    'services/adjustment-governance.service.ts',
    'requestTripArAdjustment',
    "actionKind: 'TRIP_AR_ADJUSTMENT'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q18-adjustment-governance.test.ts',
    'persists exact authority and posts only after three distinct actors',
    'requestTripArAdjustment',
    'beforeSnapshot',
    'makerId',
    'checkerId',
    'approverId',
    'applicationResult',
    'ledgerEntryId',
  ),
);

const tripFinancialChange = action(
  'TRIP_FINANCIAL_CHANGE',
  source(
    'services/adjustment-governance.service.ts',
    'requestCompletedTripCancellation',
    "actionKind: 'TRIP_FINANCIAL_CHANGE'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/trip-ledger-completion.test.ts',
    'approved cancel wins against a stale direct completed-trip edit without financial resurrection',
    'checkedCompletedTripCancellation',
    'updateTripFigures',
    'Promise.allSettled',
    "status, 'fulfilled'",
    "status, 'rejected'",
  ),
);

const tripReopen = action(
  'TRIP_REOPEN',
  source(
    'services/adjustment-governance.service.ts',
    'requestTripReopen',
    "actionKind: 'TRIP_REOPEN'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q18-adjustment-governance.test.ts',
    'blocks direct reopen and applies exceptional reopen only after approval',
    'requestTripReopen',
    'checkGovernanceAction',
    'approveGovernanceAction',
    "assert.equal(reopened.status, 'IN_TRANSIT')",
  ),
);

const debitNoteAdjustment = action(
  'DEBIT_NOTE_ADJUSTMENT',
  source(
    'services/billing-document-governance.service.ts',
    'requestBillingDocumentAdjustment',
    "actionKind: 'DEBIT_NOTE_ADJUSTMENT'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q22-source-authority.test.ts',
    'keeps issued debit notes immutable and routes source drift through governance adjustments',
    'requestBillingDocumentAdjustment',
    'checkGovernanceAction',
    'approveGovernanceAction',
    'corrections',
  ),
);

const settlementCorrection = action(
  'ADVANCE_SETTLEMENT_CORRECTION',
  source(
    'services/advance-settlement-reversal.service.ts',
    'adjustSettlementExpense',
    "actionKind: 'ADVANCE_SETTLEMENT_CORRECTION'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/forwarder-settlement-workflow.test.ts',
    'approved settlement correction and reversal require three actors and have no effect before approval',
    'adjustSettlementExpense',
    'checkGovernanceAction',
    'approveGovernanceAction',
    'makerId',
    'checkerId',
    'approverId',
  ),
);

const settlementReversal = action(
  'ADVANCE_SETTLEMENT_REVERSAL',
  source(
    'services/advance-settlement-reversal.service.ts',
    'requestAdvanceSettlementReversal',
    "actionKind: 'ADVANCE_SETTLEMENT_REVERSAL'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/forwarder-settlement-workflow.test.ts',
    'approved settlement correction and reversal require three actors and have no effect before approval',
    'requestAdvanceSettlementReversal',
    'checkGovernanceAction',
    'approveGovernanceAction',
    'reversal',
  ),
);

const companyExpense = action(
  'COMPANY_EXPENSE',
  source(
    'services/expense.service.ts',
    'requestCompanyExpenseGovernance',
    "actionKind: 'COMPANY_EXPENSE'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q23-expense-idempotency.test.ts',
    'routes material unpaid changes through governance with replay and one approval winner',
    '/governance-actions/',
    "actionKind, 'COMPANY_EXPENSE'",
    'approvedLeft',
    'approvedRight',
    'assert.deepEqual',
  ),
);

const debtOffsetCancel = action(
  'DEBT_OFFSET_CANCEL',
  source(
    'services/debtOffset.service.ts',
    'requestDebtOffsetCancelGovernance',
    "actionKind: 'DEBT_OFFSET_CANCEL'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q23-approved-financial-idempotency.test.ts',
    'debt offset approval and cancel use governed replay and single-winner application',
    'cancelRequested',
    'cancelChecked',
    'canceled',
    "canceledOffset?.status, 'CANCELED'",
  ),
);

const paymentRefund = action(
  'PAYMENT_REFUND',
  source(
    'services/payment-allocation.service.ts',
    'requestPaymentRefundGovernance',
    "actionKind: 'PAYMENT_REFUND'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q22-source-authority.test.ts',
    'post-issue allocation and refund races leave one winner and immutable receipt-allocation history',
    'requestPaymentRefundGovernance',
    'Promise.allSettled',
    'paymentRefunds',
    'paymentReceipts',
  ),
);

const penaltyCancel = action(
  'PENALTY_CANCEL',
  source(
    'services/financial.service.ts',
    'requestPenaltyCancelGovernance',
    "actionKind: 'PENALTY_CANCEL'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q23-direct-money-idempotency.test.ts',
    'penalty cancel replays exactly once, rejects changed payload, and posts one reversal only',
    'PENALTY_CANCEL',
    'replayed',
    'assert.equal',
    'reversalRows',
  ),
);

const salaryReopen = action(
  'SALARY_REOPEN',
  source(
    'services/salary-confirmation-governance.service.ts',
    'requestSalaryReopen',
    'SALARY_REOPEN_ACTION_KIND',
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q15-salary-confirmation-governance.test.ts',
    'keeps reopen append-only and restores draft only after distinct check and approval',
    'requestSalaryReopen',
    'checkSalaryReopen',
    'approveSalaryReopen',
    "confirmation?.status, 'DRAFT'",
  ),
);

const salaryPeriodReopen = action(
  'SALARY_PERIOD_REOPEN',
  source(
    'services/salary-period-close-lifecycle.service.ts',
    'requestSalaryPeriodReopen',
    'SALARY_PERIOD_REOPEN_ACTION_KIND',
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q11-salary-post-close.test.ts',
    'Q15 salary period close and reopen require three distinct actors before the period state changes',
    'requestSalaryPeriodReopen',
    'checkSalaryPeriodReopen',
    'approveSalaryPeriodReopen',
    "status, 'REOPENED'",
  ),
);

const salaryPeriodAdjustment = action(
  'SALARY_PERIOD_ADJUSTMENT',
  source(
    'services/salary-period-adjustment.service.ts',
    'requestSalaryPeriodAdjustment',
    'ADJUSTMENT_ACTION_KIND',
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q11-salary-post-close.test.ts',
    'Q11 post-close issue/adjustment flow and Q20 readiness regression stay green',
    'requestSalaryPeriodAdjustment',
    'checkSalaryPeriodAdjustment',
    'approveSalaryPeriodAdjustment',
    "status, 'APPROVED'",
  ),
);

const fuelInvoiceCorrection = action(
  'FUEL_INVOICE_CORRECTION',
  source(
    'services/fuel-invoice.service.ts',
    'requestFuelInvoiceCorrection',
    "actionKind: 'FUEL_INVOICE_CORRECTION'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q06-fuel-invoice-routes.test.ts',
    'Q18 approved invoice stays immutable while governed adjustment and reversal require three distinct actors',
    'corrections',
    'makerCannotCheck',
    'checkerCannotApprove',
    'approvalResults',
    'beforeSnapshot',
    'afterSnapshot',
  ),
);

const priceConfigChange = action(
  'PRICE_CONFIG_CHANGE',
  source(
    'services/price-config-governance.service.ts',
    'requestGovernedConfigAction',
    'definition.actionKind',
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q15-price-config-governance.test.ts',
    'submits all financially material generated config resources for maker/checker/approver review before any DB effect',
    'expectPendingAction',
    'checkAction',
    'approveAction',
    'createdBefore',
    'beforeUpdate',
  ),
);

priceConfigChange.actionKindAuthority = source(
  'services/price-config-governance.service.ts',
  'registerGovernedCustomResource',
  "actionKind: 'PRICE_CONFIG_CHANGE'",
  "subjectType: 'PRICE_CONFIG'",
);

const profitDistribution = action(
  'PROFIT_DISTRIBUTION',
  source(
    'services/profit-distribution.service.ts',
    'requestProfitDistributionGovernance',
    "actionKind: 'PROFIT_DISTRIBUTION'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q15-profit-distribution-governance.test.ts',
    'enforces viewer, maker, checker, and distinct approver roles before one effect',
    'viewerRequest',
    'makerCheck',
    'checked',
    'checkerApprove',
    'outcomes',
  ),
);

const creditOverrideApproval = action(
  'CREDIT_OVERRIDE_APPROVAL',
  source(
    'services/credit-limit.service.ts',
    'createCreditOverrideRequest',
    "actionKind: 'CREDIT_OVERRIDE_APPROVAL'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q01-credit-override-routes.test.ts',
    'concurrent approve-vs-reject keeps the first valid decision',
    'Promise.all',
    'statuses',
    '[200, 409]',
    'stored',
  ),
);

const advanceRequestApproval = action(
  'ADVANCE_REQUEST_APPROVAL',
  source(
    'services/advance-request.service.ts',
    'requestAdvanceRequestApprovalGovernance',
    "actionKind: 'ADVANCE_REQUEST_APPROVAL'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q23-approved-financial-idempotency.test.ts',
    'advance request approval is first-winner under concurrent distinct keys',
    'Promise.all',
    "status, 'APPROVED'",
    'ledger',
  ),
);

const advanceRequestRejection = action(
  'ADVANCE_REQUEST_REJECTION',
  source(
    'services/advance-request.service.ts',
    'requestAdvanceRequestRejectionGovernance',
    "actionKind: 'ADVANCE_REQUEST_REJECTION'",
    'reason',
    'beforeSnapshot',
    'afterSnapshot',
    'makerId',
  ),
  proof(
    'tests/q23-approved-financial-idempotency.test.ts',
    'advance request rejection is governed by three actors and has no ledger effect',
    '/governance-actions/',
    'approvedDecision',
    "status, 'REJECTED'",
    'ledgerBefore',
    'ledgerAfter',
  ),
);

/**
 * Q18's versioned inventory. Every row names:
 *  - the declaration that establishes the terminal state authority,
 *  - the concrete mutation guard,
 *  - the exact executable test block that exercises that guard, and
 *  - every governed action that may change financial meaning afterwards.
 */
export const LOCKED_ENTITY_BOUNDARIES: readonly LockedEntityBoundary[] = [
  {
    entity: 'TRIP',
    // O2C reconciliation (01/08/2026): LOCKED dropped — COMPLETED is the single
    // terminal/posting state. CANCELED remains a terminal sink.
    terminalStates: ['COMPLETED', 'CANCELED'],
    stateAuthority: source(
      'db/schema/_enums.ts',
      'tripStatusEnum', "'COMPLETED'", "'CANCELED'"),
    directMutationBoundary: source(
      'services/trip-figure-updates.service.ts',
      'updateTripFigures',
      'TripStatus.COMPLETED',
      'throw new ApiError',
      'không thể sửa',
    ),
    directMutationProof: proof(
      'tests/trip-ledger-completion.test.ts',
      'a posted completed trip can be reopened through governance and its ledger is reversed',
      'assert.rejects',
      'requestTripReopen',
      'approveGovernanceAction',
      'TripStatus.IN_TRANSIT',
      'ledgerRowsForTrip',
    ),
    governedActions: [tripArAdjustment, tripFinancialChange, tripReopen],
    reopenPolicy: 'PRE_IRREVERSIBLE_MILESTONE_ONLY',
  },
  {
    entity: 'BILLING_DOCUMENT',
    terminalStates: ['SENT', 'CONFIRMED', 'PAID', 'CANCELED'],
    stateAuthority: source(
      'db/schema/_enums.ts',
      'debitNoteStatusEnum',
      "'SENT'",
      "'CONFIRMED'",
      "'PAID'",
      "'CANCELED'",
    ),
    directMutationBoundary: source(
      'services/billing-document.service.ts',
      'updateDocument',
      'assertDraftDocumentLinesEditable',
      "eq(s.billingDocuments.debitNoteStatus, 'DRAFT')",
      'throw new ApiError',
    ),
    directMutationProof: proof(
      'tests/billing-document-lock.test.ts',
      'canonical update rejects a confirmed debit note',
      'updateDocument',
      'assert.rejects',
      'totalInclVat',
      'lockedError',
    ),
    governedActions: [debitNoteAdjustment],
    reopenPolicy: 'NEVER',
  },
  {
    entity: 'TRIP_EXPENSE',
    terminalStates: ['APPROVED'],
    stateAuthority: source(
      'db/schema/costs.ts',
      'tripExpenses', 'approvalStatus', "'APPROVED'"),
    directMutationBoundary: source(
      'services/forwarder.service.ts',
      'updateTripExpense',
      "existing.approvalStatus === 'APPROVED'",
      'throw new ApiError',
      'không được sửa trực tiếp',
    ),
    directMutationProof: proof(
      'tests/q18-adjustment-governance.test.ts',
      'captures the trip-expense maker and prevents self-approval or approved rewrites',
      'updateTripExpense',
      'deleteTripExpenseGuarded',
      'expectApiError',
      "approvalStatus, 'APPROVED'",
    ),
    governedActions: [settlementCorrection],
    reopenPolicy: 'NEVER',
  },
  {
    entity: 'FUEL_INVOICE',
    terminalStates: ['APPROVED', 'REJECTED'],
    stateAuthority: source(
      'routes/financial/fuel-invoices.routes.ts',
      'listSchema',
      "'PENDING'",
      "'APPROVED'",
      "'REJECTED'",
    ),
    directMutationBoundary: source(
      'services/fuel-invoice.service.ts',
      'updateFuelInvoice',
      "existing.approvalStatus !== 'PENDING'",
      'throw new ApiError',
      'Chỉ được sửa',
    ),
    directMutationProof: proof(
      'tests/q06-fuel-invoice-routes.test.ts',
      'Q18 approved invoice stays immutable while governed adjustment and reversal require three distinct actors',
      "method: 'PUT'",
      'directUpdate.status, 409',
      'corrections',
    ),
    governedActions: [fuelInvoiceCorrection],
    reopenPolicy: 'NEVER',
  },
  {
    entity: 'ADVANCE_SETTLEMENT',
    terminalStates: ['APPROVED', 'REJECTED', 'REVERSED'],
    stateAuthority: source(
      'db/schema/_enums.ts',
      'advanceSettlementStatusEnum',
      "'APPROVED'",
      "'REJECTED'",
      "'REVERSED'",
    ),
    directMutationBoundary: source(
      'services/advance-settlement.service.ts',
      'updateAdvanceSettlement',
      "settlement.status !== 'PENDING'",
      "settlement.status !== 'CHECKED_BY_ACCOUNTANT'",
      'throw new AdvanceError',
    ),
    directMutationProof: proof(
      'tests/forwarder-settlement-workflow.test.ts',
      'approved settlement correction and reversal require three actors and have no effect before approval',
      'adjustSettlementExpense',
      'requestAdvanceSettlementReversal',
      'approveGovernanceAction',
      "status, 'REVERSED'",
    ),
    governedActions: [settlementCorrection, settlementReversal],
    reopenPolicy: 'NEVER',
  },
  {
    entity: 'COMPANY_EXPENSE',
    terminalStates: ['PAID'],
    stateAuthority: source(
      '../../shared/src/schemas/index.ts',
      'expenseSchema',
      "paymentStatus: z.enum(['PAID', 'UNPAID'])",
    ),
    directMutationBoundary: source(
      'services/expense.service.ts',
      'updateExpense',
      'isGovernedCompanyExpenseMutation',
      '!governanceApproved',
      'throw new ApiError',
    ),
    directMutationProof: proof(
      'tests/q23-expense-idempotency.test.ts',
      'routes material unpaid changes through governance with replay and one approval winner',
      'governed-update',
      'requested.status, 201',
      'approvedLeft',
      'approvedRight',
      'expenses',
    ),
    governedActions: [companyExpense],
    reopenPolicy: 'NEVER',
  },
  {
    entity: 'DEBT_OFFSET',
    terminalStates: ['APPROVED', 'CANCELED'],
    stateAuthority: source(
      'services/debtOffset.service.ts',
      'cancelDebtOffset',
      "'APPROVED'",
      "'CANCELED'",
    ),
    directMutationBoundary: source(
      'services/debtOffset.service.ts',
      'cancelDebtOffset',
      "offset.approvalStatus === 'CANCELED'",
      "offset.approvalStatus !== 'APPROVED'",
      'throw new ApiError',
    ),
    directMutationProof: proof(
      'tests/m64-debt-offsets.test.ts',
      'second approve on the same offset throws (status no longer PENDING)',
      'assert.rejects',
      'APPROVED',
      'statusCode',
    ),
    governedActions: [debtOffsetCancel],
    reopenPolicy: 'NEVER',
  },
  {
    entity: 'PAYMENT_RECEIPT',
    terminalStates: ['PAYMENT_RECEIPT'],
    stateAuthority: source(
      'services/payment-allocation.service.ts',
      'requestPaymentReceiptGovernance',
      "actionKind: 'PAYMENT_RECEIPT'",
      'receiptId',
      'requestHash',
    ),
    directMutationBoundary: source(
      'services/payment-allocation.service.ts',
      'applyPaymentRefundGovernanceAction',
      'receipt.version !== action.originalVersion',
      'throw new ApiError',
      'paymentRefunds',
    ),
    directMutationProof: proof(
      'tests/q22-source-authority.test.ts',
      'post-issue allocation and refund races leave one winner and immutable receipt-allocation history',
      'Promise.allSettled',
      'paymentReceipts',
      'paymentRefunds',
      'assert.equal',
    ),
    governedActions: [paymentRefund],
    reopenPolicy: 'NEVER',
  },
  {
    entity: 'PENALTY',
    terminalStates: ['CANCELED'],
    stateAuthority: source(
      'db/schema/_enums.ts',
      'penaltyStatusEnum', "'CANCELED'"),
    directMutationBoundary: source(
      'services/financial.service.ts',
      'cancelPenaltyTx',
      "penalty.status === 'CANCELED'",
      'throw new ApiError',
      "status: 'CANCELED'",
    ),
    directMutationProof: proof(
      'tests/q23-penalty-cancel-race.test.ts',
      'second sequential cancel returns 409 and posts no extra reversal',
      'assert.rejects',
      'statusCode === 409',
      'TxnType.ADJUSTMENT',
    ),
    governedActions: [penaltyCancel],
    reopenPolicy: 'NEVER',
  },
  {
    entity: 'SALARY_CONFIRMATION',
    terminalStates: ['CONFIRMED'],
    stateAuthority: source(
      'db/schema/_enums.ts',
      'salaryConfirmationStatusEnum', "'CONFIRMED'"),
    directMutationBoundary: source(
      'services/salary-confirmation-governance.service.ts',
      'requestSalaryReopen',
      "snapshot.confirmation?.status !== 'CONFIRMED'",
      'SALARY_REOPEN_ACTION_KIND',
      'beforeSnapshot',
      'afterSnapshot',
    ),
    directMutationProof: proof(
      'tests/q15-salary-confirmation-governance.test.ts',
      'keeps reopen append-only and restores draft only after distinct check and approval',
      'requestSalaryReopen',
      'approveSalaryReopen',
      "confirmation?.status, 'DRAFT'",
      'history',
    ),
    governedActions: [salaryReopen],
    reopenPolicy: 'PRE_IRREVERSIBLE_MILESTONE_ONLY',
  },
  {
    entity: 'SALARY_PERIOD',
    terminalStates: ['CLOSED'],
    stateAuthority: source(
      'db/schema/financial.ts',
      'salaryPeriodCloses', "'CLOSED'"),
    directMutationBoundary: source(
      'services/salary-period-close-lifecycle.service.ts',
      'requestSalaryPeriodReopen',
      "existingClose.status !== 'CLOSED'",
      'throw new ApiError',
      'không thể đề nghị mở lại',
    ),
    directMutationProof: proof(
      'tests/q11-salary-post-close.test.ts',
      'Q15 salary period close and reopen require three distinct actors before the period state changes',
      'requestSalaryPeriodReopen',
      'checkSalaryPeriodReopen',
      'approveSalaryPeriodReopen',
      "status, 'CLOSED'",
    ),
    governedActions: [salaryPeriodReopen, salaryPeriodAdjustment],
    reopenPolicy: 'PRE_IRREVERSIBLE_MILESTONE_ONLY',
  },
  {
    entity: 'PERIOD_LOCK',
    terminalStates: ['CLOSED'],
    stateAuthority: source(
      'services/period-lock.service.ts',
      'PERIOD_LOCK_STATUS',
      "'CLOSED'",
      "'REOPENED'",
    ),
    directMutationBoundary: source(
      'services/period-lock.service.ts',
      'reopenPeriodLock',
      'existing.status === PERIOD_LOCK_STATUS.REOPENED',
      'assertDebitNotePeriodCanReopen',
      'throw new ApiError',
    ),
    directMutationProof: proof(
      'tests/q21-period-authority.test.ts',
      'debit-note reopen is blocked once the period has been issued or paid',
      'reopenPeriodLock',
      'assert.rejects',
      'phát hành|khóa',
    ),
    governedActions: [salaryPeriodReopen, salaryPeriodAdjustment, debitNoteAdjustment],
    reopenPolicy: 'PRE_IRREVERSIBLE_MILESTONE_ONLY',
  },
  {
    entity: 'CREDIT_OVERRIDE',
    terminalStates: ['APPROVED', 'REJECTED', 'CANCELED'],
    stateAuthority: source(
      'db/schema/_enums.ts',
      'creditOverrideStatusEnum',
      "'APPROVED'",
      "'REJECTED'",
      "'CANCELED'",
    ),
    directMutationBoundary: source(
      'services/credit-limit.service.ts',
      'rejectCreditOverrideRequest',
      "request.status !== 'PENDING'",
      'throw new ApiError',
      'đã được xử lý',
    ),
    directMutationProof: proof(
      'tests/q01-credit-override-routes.test.ts',
      'decision replay is exact and stale versions lose after the first outcome',
      'approve',
      'reject',
      'directReject.status, 409',
      'staleApprove.status, 409',
      'version',
    ),
    governedActions: [creditOverrideApproval],
    reopenPolicy: 'NEVER',
  },
  {
    entity: 'PRICE_CONFIG',
    terminalStates: ['APPROVED'],
    stateAuthority: source(
      'services/governance-action-core.service.ts',
      'approveGovernanceActionWithAdapter',
      "status: 'APPROVED'",
      'appliedAt',
      'applicationResult',
    ),
    directMutationBoundary: source(
      'services/price-config-governance.service.ts',
      'requestGovernedConfigAction',
      'definition.actionKind',
      'originalVersion',
      'beforeSnapshot',
      'afterSnapshot',
    ),
    directMutationProof: proof(
      'tests/q15-price-config-governance.test.ts',
      'submits all financially material generated config resources for maker/checker/approver review before any DB effect',
      'assert.equal',
      'expectPendingAction',
      'approveAction',
      'createdBefore',
    ),
    governedActions: [priceConfigChange],
    reopenPolicy: 'NEVER',
  },
  {
    entity: 'PROFIT_DISTRIBUTION',
    terminalStates: ['existing'],
    stateAuthority: source(
      'services/profit-distribution.service.ts',
      'assertDistributionDoesNotExist',
      'existing',
      'throw new ApiError',
      'đã tồn tại',
    ),
    directMutationBoundary: source(
      'services/profit-distribution.service.ts',
      'requestProfitDistributionGovernance',
      "actionKind: 'PROFIT_DISTRIBUTION'",
      'assertDistributionDoesNotExist',
      'beforeSnapshot',
      'afterSnapshot',
    ),
    directMutationProof: proof(
      'tests/q15-profit-distribution-governance.test.ts',
      'does not expose a direct distribution writer',
      'assert.equal',
      "'distributeProfit' in module",
      'module.applyProfitDistributionGovernanceAction',
    ),
    governedActions: [profitDistribution],
    reopenPolicy: 'NEVER',
  },
  {
    entity: 'ADVANCE_REQUEST',
    terminalStates: ['APPROVED', 'REJECTED'],
    stateAuthority: source(
      'db/schema/_enums.ts',
      'advanceRequestStatusEnum',
      "'APPROVED'",
      "'REJECTED'",
    ),
    directMutationBoundary: source(
      'services/advance-request.service.ts',
      'approveAdvanceRequest',
      "request.status !== 'PENDING'",
      'throw new AdvanceError',
      'Cannot approve request',
    ),
    directMutationProof: proof(
      'tests/q23-approved-financial-idempotency.test.ts',
      'advance request approval is first-winner under concurrent distinct keys',
      'Promise.all',
      "status, 'APPROVED'",
      'assert.equal',
      'ledger',
    ),
    governedActions: [advanceRequestApproval, advanceRequestRejection],
    reopenPolicy: 'NEVER',
  },
] as const;
