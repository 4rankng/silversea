/**
 * Executable source-authority vocabulary for the Q22 business chain.
 *
 * This catalog describes which persisted domain owns a fact and how changes
 * may propagate across a lock/issue milestone. It deliberately does not
 * calculate money, post ledger entries, or mutate dependent records.
 */

export const SOURCE_AUTHORITY_KINDS = [
  'SHIPMENT',
  'TRIP',
  'APPROVED_EXPENSE',
  'ISSUED_DEBIT_NOTE',
  'RECEIPT_ALLOCATION',
] as const;

export type SourceAuthorityKind = (typeof SOURCE_AUTHORITY_KINDS)[number];

export const DEPENDENT_AUTHORITY_KINDS = [
  'TRIP_PLAN_SNAPSHOT',
  'DRAFT_DEBIT_NOTE',
  'COST_REPORTING',
  'ACCOUNTS_RECEIVABLE',
  'PAID_OUTSTANDING',
] as const;

export type DependentAuthorityKind = (typeof DEPENDENT_AUTHORITY_KINDS)[number];

export const AUTHORITY_FIELD_FAMILIES = [
  'SHIPMENT_CUSTOMER',
  'SHIPMENT_CARGO',
  'SHIPMENT_CONTAINERS',
  'TRIP_ACTUAL_ASSIGNMENT',
  'TRIP_ACTUAL_TIME',
  'TRIP_STATUS',
  'TRIP_REVENUE',
  'EXPENSE_APPROVAL_STATUS',
  'EXPENSE_AMOUNT',
  'DEBIT_NOTE_RECEIVABLE_DUE',
  'RECEIPT_AMOUNT',
  'PAYMENT_ALLOCATION',
] as const;

export type AuthorityFieldFamily = (typeof AUTHORITY_FIELD_FAMILIES)[number];

export const AUTHORITY_MILESTONES = [
  'SHIPMENT_DISPATCHED',
  'TRIP_LOCKED_OR_DEBIT_NOTE_ISSUED',
  'DEBIT_NOTE_ISSUED',
  'RECEIPT_OR_ALLOCATION_RECORDED',
] as const;

export type AuthorityMilestone = (typeof AUTHORITY_MILESTONES)[number];

export const SOURCE_AUTHORITY_ACTIONS = [
  'RECOMPUTE',
  'VERSION',
  'ADJUST',
  'REVERSE',
] as const;

export type SourceAuthorityAction = (typeof SOURCE_AUTHORITY_ACTIONS)[number];

export const SOURCE_AUTHORITY_PAIR_IDS = [
  'SHIPMENT_TO_TRIP',
  'TRIP_TO_DRAFT_DEBIT_NOTE',
  'TRIP_TO_ACCOUNTS_RECEIVABLE',
  'EXPENSE_TO_COST_REPORTING',
  'EXPENSE_TO_DRAFT_DEBIT_NOTE',
  'ISSUED_DEBIT_NOTE_TO_ACCOUNTS_RECEIVABLE',
  'RECEIPT_ALLOCATION_TO_PAID_OUTSTANDING',
] as const;

export type SourceAuthorityPairId = (typeof SOURCE_AUTHORITY_PAIR_IDS)[number];

export type AuthorityPhase = 'PRE_MILESTONE' | 'POST_MILESTONE';

interface SourceAuthorityPolicyBase {
  readonly id: SourceAuthorityPairId;
  readonly dependent: DependentAuthorityKind;
  readonly authoritativeFields: readonly AuthorityFieldFamily[];
  readonly milestone: AuthorityMilestone;
  readonly preMilestoneActions: readonly SourceAuthorityAction[];
  readonly postMilestoneActions: readonly SourceAuthorityAction[];
  readonly immutableAfterMilestone: boolean;
}

export interface ApprovedExpenseSourceAuthorityPolicy
  extends SourceAuthorityPolicyBase {
  readonly source: 'APPROVED_EXPENSE';
  /**
   * Only approved expenses enter the authority chain. Pending and rejected
   * expenses remain non-authoritative and therefore trigger no policy action.
   */
  readonly expenseAuthority: 'APPROVED_ONLY';
}

export interface NonExpenseSourceAuthorityPolicy
  extends SourceAuthorityPolicyBase {
  readonly source: Exclude<SourceAuthorityKind, 'APPROVED_EXPENSE'>;
  readonly expenseAuthority?: never;
}

export type SourceAuthorityPolicy =
  | ApprovedExpenseSourceAuthorityPolicy
  | NonExpenseSourceAuthorityPolicy;

export const SOURCE_AUTHORITY_CATALOG = {
  SHIPMENT_TO_TRIP: {
    id: 'SHIPMENT_TO_TRIP',
    source: 'SHIPMENT',
    dependent: 'TRIP_PLAN_SNAPSHOT',
    authoritativeFields: [
      'SHIPMENT_CUSTOMER',
      'SHIPMENT_CARGO',
      'SHIPMENT_CONTAINERS',
    ],
    milestone: 'SHIPMENT_DISPATCHED',
    preMilestoneActions: ['RECOMPUTE'],
    postMilestoneActions: ['VERSION'],
    immutableAfterMilestone: true,
  },
  TRIP_TO_DRAFT_DEBIT_NOTE: {
    id: 'TRIP_TO_DRAFT_DEBIT_NOTE',
    source: 'TRIP',
    dependent: 'DRAFT_DEBIT_NOTE',
    authoritativeFields: [
      'TRIP_ACTUAL_ASSIGNMENT',
      'TRIP_ACTUAL_TIME',
      'TRIP_STATUS',
      'TRIP_REVENUE',
    ],
    milestone: 'DEBIT_NOTE_ISSUED',
    preMilestoneActions: ['RECOMPUTE'],
    postMilestoneActions: ['ADJUST'],
    immutableAfterMilestone: true,
  },
  TRIP_TO_ACCOUNTS_RECEIVABLE: {
    id: 'TRIP_TO_ACCOUNTS_RECEIVABLE',
    source: 'TRIP',
    dependent: 'ACCOUNTS_RECEIVABLE',
    authoritativeFields: ['TRIP_REVENUE'],
    milestone: 'DEBIT_NOTE_ISSUED',
    preMilestoneActions: ['RECOMPUTE'],
    postMilestoneActions: ['ADJUST'],
    immutableAfterMilestone: true,
  },
  EXPENSE_TO_COST_REPORTING: {
    id: 'EXPENSE_TO_COST_REPORTING',
    source: 'APPROVED_EXPENSE',
    dependent: 'COST_REPORTING',
    authoritativeFields: ['EXPENSE_APPROVAL_STATUS', 'EXPENSE_AMOUNT'],
    milestone: 'TRIP_LOCKED_OR_DEBIT_NOTE_ISSUED',
    preMilestoneActions: ['RECOMPUTE'],
    postMilestoneActions: ['ADJUST'],
    immutableAfterMilestone: true,
    expenseAuthority: 'APPROVED_ONLY',
  },
  EXPENSE_TO_DRAFT_DEBIT_NOTE: {
    id: 'EXPENSE_TO_DRAFT_DEBIT_NOTE',
    source: 'APPROVED_EXPENSE',
    dependent: 'DRAFT_DEBIT_NOTE',
    authoritativeFields: ['EXPENSE_APPROVAL_STATUS', 'EXPENSE_AMOUNT'],
    milestone: 'DEBIT_NOTE_ISSUED',
    preMilestoneActions: ['RECOMPUTE'],
    postMilestoneActions: ['ADJUST'],
    immutableAfterMilestone: true,
    expenseAuthority: 'APPROVED_ONLY',
  },
  ISSUED_DEBIT_NOTE_TO_ACCOUNTS_RECEIVABLE: {
    id: 'ISSUED_DEBIT_NOTE_TO_ACCOUNTS_RECEIVABLE',
    source: 'ISSUED_DEBIT_NOTE',
    dependent: 'ACCOUNTS_RECEIVABLE',
    authoritativeFields: ['DEBIT_NOTE_RECEIVABLE_DUE'],
    milestone: 'DEBIT_NOTE_ISSUED',
    preMilestoneActions: [],
    postMilestoneActions: ['ADJUST', 'REVERSE'],
    immutableAfterMilestone: true,
  },
  RECEIPT_ALLOCATION_TO_PAID_OUTSTANDING: {
    id: 'RECEIPT_ALLOCATION_TO_PAID_OUTSTANDING',
    source: 'RECEIPT_ALLOCATION',
    dependent: 'PAID_OUTSTANDING',
    authoritativeFields: ['RECEIPT_AMOUNT', 'PAYMENT_ALLOCATION'],
    milestone: 'RECEIPT_OR_ALLOCATION_RECORDED',
    preMilestoneActions: [],
    postMilestoneActions: ['ADJUST', 'REVERSE'],
    immutableAfterMilestone: true,
  },
} as const satisfies Record<SourceAuthorityPairId, SourceAuthorityPolicy>;

export const SOURCE_AUTHORITY_POLICIES: readonly SourceAuthorityPolicy[] =
  SOURCE_AUTHORITY_PAIR_IDS.map((id) => SOURCE_AUTHORITY_CATALOG[id]);

/**
 * Returns the one policy for a source/dependent pair, or null when the pair is
 * outside the approved Q22 vocabulary. Callers must treat null as denied.
 */
export function findSourceAuthorityPolicy(
  source: string,
  dependent: string,
): SourceAuthorityPolicy | null {
  return (
    SOURCE_AUTHORITY_POLICIES.find(
      (policy) => policy.source === source && policy.dependent === dependent,
    ) ?? null
  );
}

/**
 * Resolves permitted actions for a lifecycle phase. Unknown pairs fail closed
 * with an empty action set.
 */
export function getSourceAuthorityActions(
  source: string,
  dependent: string,
  phase: string,
): readonly SourceAuthorityAction[] {
  const policy = findSourceAuthorityPolicy(source, dependent);
  if (!policy) return [];
  if (phase === 'PRE_MILESTONE') return policy.preMilestoneActions;
  if (phase === 'POST_MILESTONE') return policy.postMilestoneActions;
  return [];
}

/**
 * Authorization-style predicate for propagation orchestration. Unknown pairs
 * and unknown action strings always fail closed.
 */
export function isSourceAuthorityActionAllowed(
  source: string,
  dependent: string,
  phase: string,
  action: string,
): action is SourceAuthorityAction {
  return getSourceAuthorityActions(source, dependent, phase).some(
    (allowedAction) => allowedAction === action,
  );
}
